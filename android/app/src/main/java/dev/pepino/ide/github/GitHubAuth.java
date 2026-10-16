package dev.pepino.ide.github;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Signing in to GitHub with the OAuth device flow (#29): no client secret
 * and no redirect, so nothing secret ships in the app. Plain Java (no
 * Android) so JUnit runs it against a fake GitHub. The token it gets is
 * handed to [TokenStore] and never leaves the native side: not to the
 * WebView, not to a log, not into an exception message.
 */
public final class GitHubAuth {

    /** What the user needs to approve the sign-in on github.com. */
    public record DeviceCode(String deviceCode, String userCode, String verificationUri, int expiresIn, int interval) {}

    /** The signed-in user, as GitHub names them. [name] may be null. */
    public record Account(String login, String name, String avatarUrl) {}

    /**
     * A sign-in that did not end with a token: "EXPIRED" (the code ran out),
     * "DENIED" (the user cancelled on GitHub), "CANCELLED" (in Pepino),
     * "DISABLED" (the OAuth app has no device flow), "UNAUTHORIZED" (the
     * token was refused) or "FAILED".
     */
    public static final class LoginException extends Exception {
        public final String code;

        LoginException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    /** Waits between polls; tests skip the wait. */
    public interface Sleeper {
        void sleep(long millis) throws InterruptedException;
    }

    /** Whether the sign-in was cancelled in Pepino. */
    public interface Cancelled {
        boolean get();
    }

    private static final String GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

    private final String web;
    private final String api;

    /** [web] is github.com's base URL, [api] the REST API's (other hosts for tests). */
    public GitHubAuth(String web, String api) {
        this.web = web;
        this.api = api;
    }

    public static GitHubAuth github() {
        return new GitHubAuth("https://github.com", "https://api.github.com");
    }

    /** Step 1: a code for the user to enter at [DeviceCode.verificationUri]. */
    public DeviceCode requestDeviceCode(String clientId, String scopes) throws IOException, LoginException {
        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", clientId);
        form.put("scope", scopes);
        JSONObject json = postForm(web + "/login/device/code", form);
        try {
            if (json.has("error")) throw failure(json);
            return new DeviceCode(
                json.getString("device_code"),
                json.getString("user_code"),
                json.getString("verification_uri"),
                json.optInt("expires_in", 900),
                json.optInt("interval", 5)
            );
        } catch (JSONException e) {
            throw new IOException("Unexpected answer from GitHub");
        }
    }

    /**
     * Step 2: asks GitHub every [DeviceCode.interval] seconds (more after a
     * "slow_down") until the user approves, and returns the token. Gives up
     * when the code expires, the user denies it or [cancelled] says so.
     * A poll that cannot reach GitHub is not the end: Pepino waits in the
     * background while the user approves in the browser, and Android (One UI
     * above all) may cut the network of background apps meanwhile.
     */
    public String waitForToken(String clientId, DeviceCode code, Cancelled cancelled, Sleeper sleeper)
        throws IOException, LoginException, InterruptedException {
        long interval = code.interval() * 1000L;
        long waited = 0;
        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", clientId);
        form.put("device_code", code.deviceCode());
        form.put("grant_type", GRANT_TYPE);
        while (true) {
            sleeper.sleep(interval);
            waited += interval;
            if (cancelled.get()) throw new LoginException("CANCELLED", "Sign-in cancelled");
            JSONObject json;
            try {
                json = postForm(web + "/login/oauth/access_token", form);
            } catch (IOException offline) {
                json = null; // the next poll tries again
            }
            if (json != null) {
                String token = json.optString("access_token", "");
                if (!token.isEmpty()) return token;
                switch (json.optString("error", "")) {
                    case "authorization_pending":
                        break;
                    case "slow_down":
                        // GitHub says how long to wait now; without it, 5 more seconds
                        interval = json.has("interval") ? json.optInt("interval") * 1000L : interval + 5000;
                        break;
                    default:
                        throw failure(json);
                }
            }
            if (waited >= code.expiresIn() * 1000L) throw new LoginException("EXPIRED", "The code expired");
        }
    }

    /** Who the token belongs to. */
    public Account account(String token) throws IOException, LoginException {
        HttpURLConnection connection = open(api + "/user");
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
        int status = connection.getResponseCode();
        if (status == 401) throw new LoginException("UNAUTHORIZED", "GitHub refused the sign-in");
        if (status != 200) throw new IOException("GitHub answered " + status);
        try {
            JSONObject json = new JSONObject(read(connection.getInputStream()));
            // (Android's optString turns a JSON null into "null")
            String name = json.isNull("name") ? "" : json.optString("name", "");
            return new Account(json.getString("login"), name.isEmpty() ? null : name, json.optString("avatar_url", ""));
        } catch (JSONException e) {
            throw new IOException("Unexpected answer from GitHub");
        }
    }

    /**
     * [account] right after signing in, tried again for a minute while GitHub
     * cannot be reached (the network may still be cut, as in [waitForToken]).
     */
    public Account accountRetrying(String token, Cancelled cancelled, Sleeper sleeper)
        throws IOException, LoginException, InterruptedException {
        for (int attempt = 1; ; attempt++) {
            try {
                return account(token);
            } catch (IOException offline) {
                if (attempt >= ACCOUNT_ATTEMPTS) throw offline;
            }
            sleeper.sleep(5000);
            if (cancelled.get()) throw new LoginException("CANCELLED", "Sign-in cancelled");
        }
    }

    private static final int ACCOUNT_ATTEMPTS = 12;

    private static LoginException failure(JSONObject json) {
        String error = json.optString("error", "");
        String description = json.optString("error_description", error);
        switch (error) {
            case "expired_token":
            case "token_expired":
                return new LoginException("EXPIRED", "The code expired");
            case "access_denied":
                return new LoginException("DENIED", "The sign-in was cancelled on GitHub");
            case "device_flow_disabled":
                return new LoginException("DISABLED", "Device flow is not enabled for Pepino's GitHub app");
            default:
                return new LoginException("FAILED", description.isEmpty() ? "GitHub refused the sign-in" : description);
        }
    }

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setRequestProperty("User-Agent", "Pepino");
        return connection;
    }

    /**
     * POSTs [form] and reads the JSON answer; GitHub's OAuth endpoints answer
     * 200 even for errors. An HTTP error without JSON (an unknown client id)
     * is GitHub refusing, not a connection problem.
     */
    private static JSONObject postForm(String url, Map<String, String> form) throws IOException, LoginException {
        StringBuilder body = new StringBuilder();
        for (Map.Entry<String, String> field : form.entrySet()) {
            if (body.length() > 0) body.append('&');
            body.append(URLEncoder.encode(field.getKey(), "UTF-8")).append('=').append(URLEncoder.encode(field.getValue(), "UTF-8"));
        }
        HttpURLConnection connection = open(url);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        try (OutputStream out = connection.getOutputStream()) {
            out.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int status = connection.getResponseCode();
        InputStream in = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String text = in == null ? "" : read(in);
        try {
            return new JSONObject(text);
        } catch (JSONException e) {
            if (status >= 400) throw new LoginException("FAILED", "GitHub refused the sign-in (" + status + ")");
            throw new IOException("Unexpected answer from GitHub");
        }
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream stream = in) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int n; (n = stream.read(buffer)) != -1; ) bytes.write(buffer, 0, n);
            return bytes.toString("UTF-8");
        }
    }
}
