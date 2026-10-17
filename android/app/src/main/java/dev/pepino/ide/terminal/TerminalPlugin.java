package dev.pepino.ide.terminal;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import dev.pepino.ide.git.GitOps;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The `Terminal` Capacitor plugin (#37, ADR-004): shells on PTYs. `spawn`
 * starts one in a project folder and returns its id; `write`, `resize` and
 * `kill` act on it; what it prints arrives as `data` events ({ id, data })
 * and its end as `exit` ({ id, code }). Sessions belong to the plugin, so
 * they outlive the WebView's page: `sessions` lists the running ones.
 */
@CapacitorPlugin(name = "Terminal")
public class TerminalPlugin extends Plugin {

    private final Map<Integer, TerminalSession> sessions = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger(1);
    // Typing never waits on the bridge's thread, and keeps its order
    private final ExecutorService writer = Executors.newSingleThreadExecutor();

    private final TerminalSession.Listener listener = new TerminalSession.Listener() {
        @Override
        public void onData(int id, String text, long end) {
            JSObject event = new JSObject();
            event.put("id", id);
            event.put("data", text);
            event.put("end", end);
            notifyListeners("data", event);
        }

        @Override
        public void onExit(int id, int code) {
            sessions.remove(id);
            JSObject event = new JSObject();
            event.put("id", id);
            event.put("code", code);
            notifyListeners("exit", event);
        }
    };

    private TerminalSession session(PluginCall call) {
        Integer id = call.getInt("id");
        TerminalSession session = id == null ? null : sessions.get(id);
        if (session == null) call.reject("No terminal " + id, "NOT_FOUND");
        return session;
    }

    /** Starts a shell in the project folder `cwd` (relative to the project space), `cols` x `rows`: { id }. */
    @PluginMethod
    public void spawn(PluginCall call) {
        try {
            File projects = ShellEnvironment.projects(getContext());
            File cwd = GitOps.resolve(projects, call.getString("cwd", ""));
            if (!cwd.isDirectory()) cwd = projects;
            int id = nextId.getAndIncrement();
            TerminalSession session = TerminalSession.start(
                id,
                cwd.getCanonicalPath(),
                ShellEnvironment.SHELL,
                ShellEnvironment.of(getContext()),
                call.getInt("rows", 24),
                call.getInt("cols", 80),
                listener
            );
            sessions.put(id, session);
            JSObject result = new JSObject();
            result.put("id", id);
            result.put("pid", session.pid);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
        }
    }

    /** Types `data` (text) into terminal `id`. */
    @PluginMethod
    public void write(PluginCall call) {
        TerminalSession session = session(call);
        if (session == null) return;
        byte[] data = call.getString("data", "").getBytes(StandardCharsets.UTF_8);
        writer.execute(() -> {
            try {
                session.write(data);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void resize(PluginCall call) {
        TerminalSession session = session(call);
        if (session == null) return;
        session.resize(call.getInt("rows", 24), call.getInt("cols", 80));
        call.resolve();
    }

    @PluginMethod
    public void kill(PluginCall call) {
        TerminalSession session = session(call);
        if (session == null) return;
        session.kill();
        call.resolve();
    }

    /** The running terminals: { sessions: [{ id, pid, cwd }] }, cwd relative to the projects' folder. */
    @PluginMethod
    public void sessions(PluginCall call) {
        String projects;
        try {
            projects = ShellEnvironment.projects(getContext()).getCanonicalPath();
        } catch (java.io.IOException e) {
            call.reject(e.getMessage(), e);
            return;
        }
        JSArray list = new JSArray();
        for (TerminalSession session : sessions.values()) {
            JSObject json = new JSObject();
            json.put("id", session.id);
            json.put("pid", session.pid);
            String cwd = session.cwd.startsWith(projects + "/") ? session.cwd.substring(projects.length() + 1) : "";
            json.put("cwd", cwd);
            list.put(json);
        }
        JSObject result = new JSObject();
        result.put("sessions", list);
        call.resolve(result);
    }

    /** What terminal `id` printed last, for a page attaching to it again: { data, end }. */
    @PluginMethod
    public void history(PluginCall call) {
        TerminalSession session = session(call);
        if (session == null) return;
        TerminalSession.Recent recent = session.recent();
        JSObject result = new JSObject();
        result.put("data", recent.text());
        result.put("end", recent.end());
        call.resolve(result);
    }

    @Override
    protected void handleOnDestroy() {
        for (TerminalSession session : sessions.values()) session.kill();
        sessions.clear();
        writer.shutdown();
    }
}
