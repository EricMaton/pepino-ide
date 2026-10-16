package dev.pepino.ide.git;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The `Git` Capacitor plugin (ADR-006): JGit on the project space
 * (`filesDir/projects`), the same folder the explorer and the editor use.
 * Every call runs on one git thread, never on the bridge's, one after another,
 * and returns a summary rather than raw repository data.
 */
@CapacitorPlugin(name = "Git")
public class GitPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private interface Work {
        JSObject run() throws Exception;
    }

    private File projectSpace() {
        return new File(getContext().getFilesDir(), "projects");
    }

    private File folder(PluginCall call) throws Exception {
        return GitOps.resolve(projectSpace(), call.getString("path"));
    }

    private void run(PluginCall call, Work work) {
        executor.execute(() -> {
            try {
                call.resolve(work.run());
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

    @PluginMethod
    public void info(PluginCall call) {
        run(call, () -> {
            GitOps.RepoInfo info = GitOps.info(folder(call));
            JSObject result = new JSObject();
            result.put("info", info == null ? JSObject.NULL : toJson(info));
            return result;
        });
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
    }
}
