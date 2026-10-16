package dev.pepino.ide.github;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The `GitHub` Capacitor plugin (#29, #30): signs in with the device flow
 * and keeps the token in [TokenStore]. The WebView only ever gets the code
 * to type on github.com and who signed in; the token stays on this side, for
 * the GitHub calls and git (clone, push, pull) to use.
 */
@CapacitorPlugin(name = "GitHub")
public class GitHubPlugin extends Plugin {

    static final String TOKEN = "github.token";
    private static final String ACCOUNT_PREFS = "pepino.github";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    // Waiting for the user to approve can take minutes: it never holds up the other calls.
    private final ExecutorService waiting = Executors.newSingleThreadExecutor();
    private final GitHubAuth auth = GitHubAuth.github();
    private final GitHubApi api = GitHubApi.github();
    private TokenStore tokens;
    // The sign-in in progress (one at a time), and whether Pepino cancelled it
    private volatile GitHubAuth.DeviceCode pending;
    private volatile String pendingClientId;
    private volatile boolean cancelled;

    @Override
    public void load() {
        tokens = new TokenStore(getContext());
    }

    /** The token, for other native code (git over HTTPS); null when signed out. */
    public static String token(Context context) {
        return new TokenStore(context).read(TOKEN);
    }

    private interface Work {
        JSObject run() throws Exception;
    }

    private void run(PluginCall call, Work work) {
        run(executor, call, work);
    }

    private void run(ExecutorService on, PluginCall call, Work work) {
        on.execute(() -> {
            try {
                call.resolve(work.run());
            } catch (GitHubAuth.LoginException e) {
                call.reject(e.getMessage(), e.code);
            } catch (IOException e) {
                // No connection, a timeout, an answer that is not GitHub's: never the request itself
                call.reject("Cannot reach GitHub", "NETWORK");
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName(), "FAILED");
            }
        });
    }

    private SharedPreferences accountPrefs() {
        return getContext().getSharedPreferences(ACCOUNT_PREFS, Context.MODE_PRIVATE);
    }

    private static JSObject toJson(GitHubAuth.Account account) {
        JSObject json = new JSObject();
        json.put("login", account.login());
        json.put("name", account.name() == null ? JSObject.NULL : account.name());
        json.put("avatarUrl", account.avatarUrl());
        return json;
    }

    /** Who is signed in, as last seen (no network); null when signed out. */
    @PluginMethod
    public void account(PluginCall call) {
        run(call, () -> {
            SharedPreferences prefs = accountPrefs();
            String login = prefs.getString("login", null);
            JSObject result = new JSObject();
            if (login == null || tokens.read(TOKEN) == null) {
                result.put("account", JSObject.NULL);
            } else {
                result.put("account", toJson(new GitHubAuth.Account(login, prefs.getString("name", null), prefs.getString("avatarUrl", ""))));
            }
            return result;
        });
    }

    /** Starts a sign-in: the code the user types on GitHub, and where. */
    @PluginMethod
    public void startLogin(PluginCall call) {
        String clientId = call.getString("clientId", "");
        String scopes = call.getString("scopes", "");
        run(call, () -> {
            cancelled = false;
            GitHubAuth.DeviceCode code = auth.requestDeviceCode(clientId, scopes);
            pending = code;
            pendingClientId = clientId;
            JSObject result = new JSObject();
            result.put("userCode", code.userCode());
            result.put("verificationUri", code.verificationUri());
            result.put("expiresIn", code.expiresIn());
            return result;
        });
    }

    /** Waits for the user to approve the started sign-in, keeps the token and answers who signed in. */
    @PluginMethod
    public void finishLogin(PluginCall call) {
        run(waiting, call, () -> {
            GitHubAuth.DeviceCode code = pending;
            if (code == null) throw new GitHubAuth.LoginException("FAILED", "No sign-in in progress");
            try {
                String token = auth.waitForToken(pendingClientId, code, () -> cancelled, Thread::sleep);
                GitHubAuth.Account account = auth.accountRetrying(token, () -> cancelled, Thread::sleep);
                tokens.save(TOKEN, token);
                accountPrefs()
                    .edit()
                    .putString("login", account.login())
                    .putString("name", account.name())
                    .putString("avatarUrl", account.avatarUrl())
                    .commit();
                JSObject result = new JSObject();
                result.put("account", toJson(account));
                return result;
            } finally {
                pending = null;
            }
        });
    }

    /** A page of the signed-in user's repositories (#31): { repos, hasMore }. */
    @PluginMethod
    public void repos(PluginCall call) {
        int page = call.getInt("page", 1);
        int perPage = call.getInt("perPage", 50);
        run(call, () -> {
            GitHubApi.Page found = api.repos(signedIn(), page, perPage);
            JSArray repos = new JSArray();
            for (GitHubApi.Repo repo : found.repos()) repos.put(toJson(repo));
            JSObject result = new JSObject();
            result.put("repos", repos);
            result.put("hasMore", found.hasMore());
            return result;
        });
    }

    /** The signed-in user's token; UNAUTHORIZED when signed out. */
    private String signedIn() throws GitHubAuth.LoginException {
        String token = tokens.read(TOKEN);
        if (token == null) throw new GitHubAuth.LoginException("UNAUTHORIZED", "Not signed in to GitHub");
        return token;
    }

    private static Object toJson(GitHubApi.PullRequest pull) {
        if (pull == null) return JSObject.NULL;
        JSObject json = new JSObject();
        json.put("number", pull.number());
        json.put("title", pull.title());
        json.put("url", pull.url());
        json.put("draft", pull.draft());
        return json;
    }

    /**
     * For a branch of a GitHub repository (#34): the repository's default
     * branch, and the branch's open pull request (null when there is none).
     */
    @PluginMethod
    public void pullRequestFor(PluginCall call) {
        String owner = call.getString("owner", "");
        String name = call.getString("repo", "");
        String branch = call.getString("branch", "");
        run(call, () -> {
            String token = signedIn();
            JSObject result = new JSObject();
            result.put("defaultBranch", api.defaultBranch(token, owner, name));
            result.put("pullRequest", toJson(api.openPullRequest(token, owner, name, branch)));
            return result;
        });
    }

    /** The repository's branches on GitHub: where a pull request can go. */
    @PluginMethod
    public void remoteBranches(PluginCall call) {
        String owner = call.getString("owner", "");
        String name = call.getString("repo", "");
        run(call, () -> {
            JSObject result = new JSObject();
            result.put("branches", new JSArray(api.branches(signedIn(), owner, name)));
            return result;
        });
    }

    @PluginMethod
    public void createPullRequest(PluginCall call) {
        String owner = call.getString("owner", "");
        String name = call.getString("repo", "");
        String head = call.getString("head", "");
        String base = call.getString("base", "");
        String title = call.getString("title", "");
        String body = call.getString("body", "");
        boolean draft = Boolean.TRUE.equals(call.getBoolean("draft", false));
        run(call, () -> {
            JSObject result = new JSObject();
            result.put("pullRequest", toJson(api.createPullRequest(signedIn(), owner, name, head, base, title, body, draft)));
            return result;
        });
    }

    private static JSObject toJson(GitHubApi.Repo repo) {
        JSObject json = new JSObject();
        json.put("fullName", repo.fullName());
        json.put("name", repo.name());
        json.put("owner", repo.owner());
        json.put("description", repo.description() == null ? JSObject.NULL : repo.description());
        json.put("private", repo.isPrivate());
        json.put("fork", repo.fork());
        json.put("archived", repo.archived());
        json.put("defaultBranch", repo.defaultBranch());
        json.put("cloneUrl", repo.cloneUrl());
        json.put("language", repo.language() == null ? JSObject.NULL : repo.language());
        json.put("pushedAt", repo.pushedAt() == null ? JSObject.NULL : repo.pushedAt());
        return json;
    }

    /** Stops waiting for the sign-in in progress (it ends with CANCELLED at the next poll). */
    @PluginMethod
    public void cancelLogin(PluginCall call) {
        cancelled = true;
        call.resolve();
    }

    /** Forgets the token and the account. The authorization stays on GitHub until revoked there. */
    @PluginMethod
    public void logout(PluginCall call) {
        run(call, () -> {
            tokens.delete(TOKEN);
            accountPrefs().edit().clear().commit();
            return new JSObject();
        });
    }

    /** Opens an https link (github.com/login/device) in the browser. */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://")) {
            call.reject("Only https links open", "FAILED");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
