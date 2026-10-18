package dev.pepino.ide.plugins;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import dev.pepino.ide.github.TokenStore;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.SSLHandshakeException;
import org.json.JSONObject;

/**
 * The `Secrets` Capacitor plugin (#186): each user's own keys for the
 * plugins (the AI assistant's Anthropic key, #58), kept encrypted in
 * [TokenStore] with the host each one belongs to. There is no way to read
 * one back: a request that needs it is made here, over HTTPS to that host
 * only, with the key in the header the plugin declared. The WebView, and
 * the plugin in its sandbox, only ever get the answer.
 */
@CapacitorPlugin(name = "Secrets")
public class SecretsPlugin extends Plugin {

    /** An answer read whole (not streamed) stops here. */
    private static final int MAX_TEXT = 10 * 1024 * 1024;

    private final ExecutorService executor = Executors.newCachedThreadPool();
    /** The requests in flight, by the WebView's id, to cancel. */
    private final Map<String, HttpURLConnection> inFlight = new ConcurrentHashMap<>();
    private TokenStore store;

    @Override
    public void load() {
        store = new TokenStore(getContext());
    }

    private static String hostKey(String name) {
        return name + "@host";
    }

    @PluginMethod
    public void has(PluginCall call) {
        String name = call.getString("name", "");
        executor.execute(() -> {
            JSObject result = new JSObject();
            result.put("saved", store.read(name) != null && store.read(hostKey(name)) != null);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name", "");
        String value = call.getString("value", "");
        String host = call.getString("host", "");
        executor.execute(() -> {
            try {
                if (name.isEmpty() || value.isEmpty() || host.isEmpty()) throw new IllegalArgumentException("Nothing to keep");
                store.save(name, value);
                store.save(hostKey(name), host.toLowerCase());
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Cannot keep the key", "FAILED");
            }
        });
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String name = call.getString("name", "");
        executor.execute(() -> {
            store.delete(name);
            store.delete(hostKey(name));
            call.resolve();
        });
    }

    /**
     * A request with secret `name` in header `header`: `url` must be HTTPS to
     * the secret's own host. With `stream`, the answer comes as `chunk`
     * events ({ id, text }) as it arrives, and the call resolves at its end.
     */
    @PluginMethod
    public void request(PluginCall call) {
        String id = call.getString("id", "");
        String name = call.getString("name", "");
        String header = call.getString("header", "");
        String prefix = call.getString("prefix", "");
        String address = call.getString("url", "");
        String method = call.getString("method", "GET");
        JSObject headers = call.getObject("headers", new JSObject());
        String body = call.getString("body", null);
        boolean stream = Boolean.TRUE.equals(call.getBoolean("stream", false));
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                String secret = store.read(name);
                String host = store.read(hostKey(name));
                if (secret == null || host == null) {
                    call.reject("No key saved", "NO_SECRET");
                    return;
                }
                URL url = new URL(address);
                if (!"https".equals(url.getProtocol()) || !host.equalsIgnoreCase(url.getHost())) {
                    call.reject("The key only goes to https://" + host, "WRONG_HOST");
                    return;
                }
                connection = (HttpURLConnection) url.openConnection();
                inFlight.put(id, connection);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(stream ? 300_000 : 60_000);
                connection.setRequestMethod(method);
                for (Iterator<String> keys = headers.keys(); keys.hasNext(); ) {
                    String key = keys.next();
                    if (!key.equalsIgnoreCase(header)) connection.setRequestProperty(key, headers.getString(key));
                }
                connection.setRequestProperty(header, prefix + secret);
                if (body != null) {
                    connection.setDoOutput(true);
                    try (OutputStream out = connection.getOutputStream()) {
                        out.write(body.getBytes(StandardCharsets.UTF_8));
                    }
                }
                int status = connection.getResponseCode();
                InputStream in = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                StringBuilder text = new StringBuilder();
                if (in != null) {
                    try (Reader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
                        char[] buffer = new char[8192];
                        for (int read; (read = reader.read(buffer)) != -1; ) {
                            String part = new String(buffer, 0, read);
                            // An error is read whole: it is short, and the caller wants it as text
                            if (stream && status < 400) {
                                JSObject chunk = new JSObject();
                                chunk.put("id", id);
                                chunk.put("text", part);
                                notifyListeners("chunk", chunk);
                            } else if (text.length() + part.length() <= MAX_TEXT) {
                                text.append(part);
                            }
                        }
                    }
                }
                JSObject answer = new JSObject();
                answer.put("status", status);
                JSObject answerHeaders = new JSObject();
                for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                    if (entry.getKey() != null && !entry.getValue().isEmpty()) {
                        answerHeaders.put(entry.getKey().toLowerCase(), entry.getValue().get(0));
                    }
                }
                answer.put("headers", answerHeaders);
                answer.put("text", text.toString());
                call.resolve(answer);
            } catch (IOException e) {
                call.reject(describe(e, address), inFlight.containsKey(id) ? "NETWORK" : "CANCELLED");
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName(), "FAILED");
            } finally {
                inFlight.remove(id);
                if (connection != null) connection.disconnect();
            }
        });
    }

    /**
     * Signing in (#190): POSTs `body` (JSON) to `url`, HTTPS on `host`, and
     * keeps the `field` of its JSON answer as secret `name` for `host`. The
     * key the answer carries never leaves this side.
     */
    @PluginMethod
    public void exchange(PluginCall call) {
        String name = call.getString("name", "");
        String host = call.getString("host", "");
        String address = call.getString("url", "");
        String body = call.getString("body", "{}");
        String field = call.getString("field", "key");
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(address);
                if (!"https".equals(url.getProtocol()) || !host.equalsIgnoreCase(url.getHost())) {
                    call.reject("Signing in only goes to https://" + host, "WRONG_HOST");
                    return;
                }
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(30_000);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("content-type", "application/json");
                connection.setDoOutput(true);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body.getBytes(StandardCharsets.UTF_8));
                }
                int status = connection.getResponseCode();
                InputStream in = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                StringBuilder text = new StringBuilder();
                if (in != null) {
                    try (Reader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
                        char[] buffer = new char[4096];
                        for (int read; (read = reader.read(buffer)) != -1 && text.length() < 65_536; ) text.append(buffer, 0, read);
                    }
                }
                String secret = status < 400 ? new JSONObject(text.toString()).optString(field, "") : "";
                if (secret.isEmpty()) {
                    call.reject("Signing in did not work (" + status + "): try again", "SIGN_IN_FAILED");
                    return;
                }
                store.save(name, secret);
                store.save(hostKey(name), host.toLowerCase());
                call.resolve();
            } catch (IOException e) {
                call.reject(describe(e, address), "NETWORK");
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Signing in did not work", "FAILED");
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    /**
     * Keeps what is on the clipboard as secret `name` for `host` (#190): a
     * key pasted this way never passes through the WebView. It must look
     * like a key: one word, 20 to 400 characters.
     */
    @PluginMethod
    public void paste(PluginCall call) {
        String name = call.getString("name", "");
        String host = call.getString("host", "");
        ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = clipboard == null ? null : clipboard.getPrimaryClip();
        CharSequence pasted = clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).coerceToText(getContext()) : null;
        String value = pasted == null ? "" : pasted.toString().trim();
        if (!value.matches("\\S{20,400}")) {
            call.reject("The clipboard has no key: copy it first", "NOT_A_KEY");
            return;
        }
        executor.execute(() -> {
            try {
                store.save(name, value);
                store.save(hostKey(name), host.toLowerCase());
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Cannot keep the key", "FAILED");
            }
        });
    }

    /** Opens an https link in the browser: where to get a key, or to sign in. */
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

    /** Stops request `id`: it fails as CANCELLED. */
    @PluginMethod
    public void cancel(PluginCall call) {
        HttpURLConnection connection = inFlight.remove(call.getString("id", ""));
        if (connection != null) executor.execute(connection::disconnect);
        call.resolve();
    }

    private static String describe(IOException e, String address) {
        for (Throwable cause = e; cause != null; cause = cause.getCause()) {
            if (cause instanceof UnknownHostException) return "No internet connection";
            if (cause instanceof SocketTimeoutException) return "The server is taking too long to answer";
            if (cause instanceof SSLHandshakeException) return "Cannot connect securely: the Wi-Fi may need you to sign in to it first";
            if (cause.getCause() == cause) break;
        }
        try {
            return "Cannot reach " + new URL(address).getHost();
        } catch (Exception ignored) {
            return "Cannot reach the server";
        }
    }
}
