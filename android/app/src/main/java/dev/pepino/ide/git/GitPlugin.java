package dev.pepino.ide.git;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import dev.pepino.ide.github.GitHubPlugin;
import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.eclipse.jgit.transport.CredentialsProvider;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;
import org.json.JSONArray;

/**
 * The `Git` Capacitor plugin (ADR-006): JGit on the project space
 * (`filesDir/projects`), the same folder the explorer and the editor use.
 * Every call runs on one git thread, never on the bridge's, one after another,
 * and returns a summary rather than raw repository data.
 */
@CapacitorPlugin(name = "Git")
public class GitPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    // Set by cancelRemote, outside the git thread (the clone, fetch, pull or push holds it)
    private volatile boolean remoteCancelled;

    private interface Work {
        JSObject run() throws Exception;
    }

    private File projectSpace() {
        return new File(getContext().getFilesDir(), "projects");
    }

    /** The app's own git config (the home folder is the app's files dir, see MainActivity). */
    private File configFile() {
        return new File(getContext().getFilesDir(), ".gitconfig");
    }

    private File folder(PluginCall call) throws Exception {
        return GitOps.resolve(projectSpace(), call.getString("path"));
    }

    private void run(PluginCall call, Work work) {
        executor.execute(() -> {
            try {
                call.resolve(work.run());
            } catch (GitOps.ConflictException e) {
                JSObject data = new JSObject();
                data.put("paths", new JSArray(e.paths));
                call.reject(e.getMessage(), "CONFLICT", e, data);
            } catch (GitOps.MergeConflictException e) {
                JSObject data = new JSObject();
                data.put("paths", new JSArray(e.paths));
                call.reject(e.getMessage(), "MERGE_CONFLICT", e, data);
            } catch (GitOps.NotMergedBranchException e) {
                call.reject(e.getMessage(), "NOT_MERGED", e);
            } catch (GitOps.RemoteException e) {
                call.reject(e.getMessage(), e.code, e);
            } catch (GitOps.StaleSelectionException e) {
                JSObject data = new JSObject();
                data.put("paths", new JSArray(e.paths));
                call.reject(e.getMessage(), "STALE", e, data);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
        });
    }

    private static JSObject toJson(GitOps.RepoInfo info) {
        JSObject json = new JSObject();
        json.put("branch", info.branch());
        json.put("hasCommits", info.hasCommits());
        return json;
    }

    @PluginMethod
    public void isRepository(PluginCall call) {
        run(call, () -> {
            JSObject result = new JSObject();
            result.put("repository", GitOps.isRepository(folder(call)));
            return result;
        });
    }

    @PluginMethod
    public void init(PluginCall call) {
        run(call, () -> toJson(GitOps.init(folder(call))));
    }

    /**
     * The credentials for [url]: the signed-in user's token from the
     * Keystore, only ever towards GitHub (none elsewhere, nor signed out).
     * It never comes from, or goes to, the WebView.
     */
    private CredentialsProvider credentials(String url) {
        if (url == null || !url.startsWith("https://github.com/")) return null;
        String token = GitHubPlugin.token(getContext());
        return token == null ? null : new UsernamePasswordCredentialsProvider("x-access-token", token);
    }

    /** A remote operation's progress, out as `remoteProgress` events ({ task, done, total }); [cancelRemote] stops it. */
    private GitOps.Progress remoteProgress() {
        remoteCancelled = false;
        return new GitOps.Progress() {
            @Override
            public void update(String task, int done, int total) {
                JSObject event = new JSObject();
                event.put("task", task);
                event.put("done", done);
                event.put("total", total);
                notifyListeners("remoteProgress", event);
            }

            @Override
            public boolean cancelled() {
                return remoteCancelled;
            }
        };
    }

    /** Clones a GitHub repository (#32) into `path`. */
    @PluginMethod
    public void clone(PluginCall call) {
        String url = call.getString("url", "");
        run(call, () -> {
            if (!url.startsWith("https://github.com/")) throw new IllegalArgumentException("Only GitHub repositories can be cloned");
            return toJson(GitOps.clone(folder(call), url, credentials(url), remoteProgress()));
        });
    }

    /** Stops the clone, fetch, pull or push in progress; it rejects with CANCELLED. */
    @PluginMethod
    public void cancelRemote(PluginCall call) {
        remoteCancelled = true;
        call.resolve();
    }

    private static JSObject toJson(GitOps.SyncState state) {
        JSObject json = new JSObject();
        json.put("remote", state.remote());
        json.put("upstream", state.upstream() == null ? JSObject.NULL : state.upstream());
        json.put("ahead", state.ahead());
        json.put("behind", state.behind());
        return json;
    }

    /** The URL of the repository's origin (GitHub's, for a clone), or null. */
    @PluginMethod
    public void originUrl(PluginCall call) {
        run(call, () -> {
            String url = GitOps.originUrl(folder(call));
            JSObject result = new JSObject();
            result.put("url", url == null ? JSObject.NULL : url);
            return result;
        });
    }

    /** Where the current branch stands against GitHub's (#33), as of the last fetch: no network. */
    @PluginMethod
    public void sync(PluginCall call) {
        run(call, () -> toJson(GitOps.syncState(folder(call))));
    }

    @PluginMethod
    public void fetch(PluginCall call) {
        run(call, () -> {
            File folder = folder(call);
            return toJson(GitOps.fetch(folder, credentials(GitOps.originUrl(folder)), remoteProgress()));
        });
    }

    @PluginMethod
    public void pull(PluginCall call) {
        run(call, () -> {
            File folder = folder(call);
            GitOps.Pulled pulled = GitOps.pull(
                folder,
                credentials(GitOps.originUrl(folder)),
                remoteProgress(),
                GitOps.identity(configFile())
            );
            JSObject result = new JSObject();
            result.put("state", toJson(pulled.state()));
            result.put("written", new JSArray(pulled.written()));
            result.put("removed", new JSArray(pulled.removed()));
            return result;
        });
    }

    @PluginMethod
    public void push(PluginCall call) {
        run(call, () -> {
            File folder = folder(call);
            return toJson(GitOps.push(folder, credentials(GitOps.originUrl(folder)), remoteProgress()));
        });
    }

    @PluginMethod
    public void info(PluginCall call) {
        run(call, () -> {
            GitOps.RepoInfo info = GitOps.info(folder(call));
            JSObject result = new JSObject();
            result.put("info", info == null ? JSObject.NULL : toJson(info));
            return result;
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        run(call, () -> {
            JSArray changes = new JSArray();
            for (GitOps.FileChange change : GitOps.status(folder(call))) {
                JSObject json = new JSObject();
                json.put("path", change.path());
                json.put("kind", change.kind());
                changes.put(json);
            }
            JSObject result = new JSObject();
            result.put("changes", changes);
            return result;
        });
    }

    @PluginMethod
    public void commit(PluginCall call) {
        run(call, () -> {
            GitOps.Identity who = GitOps.identity(configFile());
            if (who == null) throw new IllegalStateException("Set your name and email for commits first");
            JSArray rawPaths = call.getArray("paths", new JSArray());
            List<String> paths = new ArrayList<>();
            for (int i = 0; i < rawPaths.length(); i++) paths.add(rawPaths.getString(i));
            GitOps.CommitResult commit = GitOps.commit(folder(call), call.getString("message"), paths, exclusions(call), who);
            JSObject result = new JSObject();
            result.put("id", commit.id());
            result.put("summary", commit.summary());
            return result;
        });
    }

    /** `excluded`: { [path]: { version, lines: number[] } }. */
    private static Map<String, GitOps.LineExclusion> exclusions(PluginCall call) throws Exception {
        JSObject raw = call.getObject("excluded", new JSObject());
        Map<String, GitOps.LineExclusion> exclusions = new HashMap<>();
        for (Iterator<String> paths = raw.keys(); paths.hasNext(); ) {
            String path = paths.next();
            JSObject exclusion = raw.getJSObject(path);
            if (exclusion == null) continue;
            JSONArray rawLines = exclusion.optJSONArray("lines");
            Set<Integer> lines = new HashSet<>();
            for (int i = 0; rawLines != null && i < rawLines.length(); i++) lines.add(rawLines.getInt(i));
            exclusions.put(path, new GitOps.LineExclusion(exclusion.getString("version", ""), lines));
        }
        return exclusions;
    }

    @PluginMethod
    public void diff(PluginCall call) {
        run(call, () -> toJson(GitOps.diff(folder(call), call.getString("file"))));
    }

    private static JSObject toJson(GitOps.FileDiff diff) {
        JSArray hunks = new JSArray();
        for (GitOps.Hunk hunk : diff.hunks()) {
            JSArray lines = new JSArray();
            for (GitOps.DiffLine line : hunk.lines()) {
                JSObject json = new JSObject();
                json.put("kind", line.kind());
                json.put("text", line.text());
                json.put("oldLine", line.oldLine() > 0 ? line.oldLine() : JSObject.NULL);
                json.put("newLine", line.newLine() > 0 ? line.newLine() : JSObject.NULL);
                json.put("index", line.index() >= 0 ? line.index() : JSObject.NULL);
                if (line.noNewline()) json.put("noNewline", true);
                if (line.endOfFile()) json.put("endOfFile", true);
                lines.put(json);
            }
            JSObject json = new JSObject();
            json.put("oldStart", hunk.oldStart());
            json.put("oldLines", hunk.oldLines());
            json.put("newStart", hunk.newStart());
            json.put("newLines", hunk.newLines());
            json.put("lines", lines);
            hunks.put(json);
        }
        JSObject result = new JSObject();
        result.put("version", diff.version());
        result.put("binary", diff.binary());
        result.put("tooLarge", diff.tooLarge());
        result.put("hunks", hunks);
        return result;
    }

    @PluginMethod
    public void log(PluginCall call) {
        run(call, () -> {
            JSArray commits = new JSArray();
            for (GitOps.LogEntry entry : GitOps.log(folder(call), call.getInt("skip", 0), call.getInt("limit", 50))) {
                JSObject json = new JSObject();
                json.put("id", entry.id());
                json.put("summary", entry.summary());
                json.put("description", entry.description());
                json.put("author", entry.author());
                json.put("email", entry.email());
                json.put("time", entry.time());
                commits.put(json);
            }
            JSObject result = new JSObject();
            result.put("commits", commits);
            return result;
        });
    }

    @PluginMethod
    public void commitChanges(PluginCall call) {
        run(call, () -> {
            JSArray changes = new JSArray();
            for (GitOps.FileChange change : GitOps.commitChanges(folder(call), call.getString("commit"))) {
                JSObject json = new JSObject();
                json.put("path", change.path());
                json.put("kind", change.kind());
                changes.put(json);
            }
            JSObject result = new JSObject();
            result.put("changes", changes);
            return result;
        });
    }

    @PluginMethod
    public void commitDiff(PluginCall call) {
        run(call, () -> toJson(GitOps.commitDiff(folder(call), call.getString("commit"), call.getString("file"))));
    }

    @PluginMethod
    public void snapshot(PluginCall call) {
        run(call, () -> {
            JSObject result = new JSObject();
            result.put("id", GitOps.snapshot(folder(call), call.getString("reason")));
            return result;
        });
    }

    @PluginMethod
    public void snapshotVersions(PluginCall call) {
        run(call, () -> {
            JSArray versions = new JSArray();
            for (GitOps.SnapshotVersion version : GitOps.snapshotVersions(folder(call), call.getString("file"), call.getInt("limit", 50))) {
                JSObject json = new JSObject();
                json.put("id", version.id());
                json.put("reason", version.reason());
                json.put("time", version.time());
                versions.put(json);
            }
            JSObject result = new JSObject();
            result.put("versions", versions);
            return result;
        });
    }

    @PluginMethod
    public void snapshotFile(PluginCall call) {
        run(call, () -> {
            String text = GitOps.snapshotFile(folder(call), call.getString("id"), call.getString("file"));
            JSObject result = new JSObject();
            result.put("text", text == null ? JSObject.NULL : text);
            return result;
        });
    }

    @PluginMethod
    public void identity(PluginCall call) {
        run(call, () -> {
            GitOps.Identity identity = GitOps.identity(configFile());
            JSObject result = new JSObject();
            if (identity == null) {
                result.put("identity", JSObject.NULL);
            } else {
                JSObject json = new JSObject();
                json.put("name", identity.name());
                json.put("email", identity.email());
                result.put("identity", json);
            }
            return result;
        });
    }

    @PluginMethod
    public void setIdentity(PluginCall call) {
        run(call, () -> {
            GitOps.setIdentity(configFile(), new GitOps.Identity(call.getString("name", ""), call.getString("email", "")));
            return new JSObject();
        });
    }

    @PluginMethod
    public void branches(PluginCall call) {
        run(call, () -> {
            JSArray branches = new JSArray();
            for (GitOps.Branch branch : GitOps.branches(folder(call))) {
                JSObject json = new JSObject();
                json.put("name", branch.name());
                json.put("current", branch.current());
                if (branch.remote()) json.put("remote", true);
                branches.put(json);
            }
            JSObject result = new JSObject();
            result.put("branches", branches);
            return result;
        });
    }

    @PluginMethod
    public void createBranch(PluginCall call) {
        run(call, () -> toJson(GitOps.createBranch(folder(call), call.getString("name"))));
    }

    @PluginMethod
    public void checkout(PluginCall call) {
        run(call, () -> {
            GitOps.Switched switched = GitOps.checkout(folder(call), call.getString("name"));
            JSObject result = new JSObject();
            result.put("info", toJson(switched.info()));
            result.put("written", new JSArray(switched.written()));
            result.put("removed", new JSArray(switched.removed()));
            return result;
        });
    }

    @PluginMethod
    public void deleteBranch(PluginCall call) {
        run(call, () -> {
            GitOps.deleteBranch(folder(call), call.getString("name"), call.getBoolean("force", false));
            return new JSObject();
        });
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
    }
}
