package dev.pepino.ide.github;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * GitHub's REST API with the signed-in user's token (#31). Plain Java, like
 * [GitHubAuth], so JUnit runs it against a fake GitHub. The token goes in
 * the Authorization header and nowhere else: not in a URL, a log or an
 * exception message.
 */
public final class GitHubApi {

    /** A repository the user can clone. [description], [language] and [pushedAt] may be null. */
    public record Repo(
        String fullName,
        String name,
        String owner,
        String description,
        boolean isPrivate,
        boolean fork,
        boolean archived,
        String defaultBranch,
        String cloneUrl,
        String language,
        String pushedAt
    ) {}

    /** One page of repositories, and whether GitHub has more after it. */
    public record Page(List<Repo> repos, boolean hasMore) {}

    /** A pull request (#34): [url] is its page on github.com. */
    public record PullRequest(int number, String title, String url, boolean draft) {}

    private final String api;

    /** [api] is the REST API's base URL (another host for tests). */
    public GitHubApi(String api) {
        this.api = api;
    }

    public static GitHubApi github() {
        return new GitHubApi("https://api.github.com");
    }

    /**
     * The repositories the user owns, collaborates on or reaches through an
     * organization: [page] (from 1) of [perPage], most recently pushed first.
     */
    public Page repos(String token, int page, int perPage) throws IOException, GitHubAuth.LoginException {
        HttpURLConnection connection = get(token, "/user/repos?sort=pushed&per_page=" + perPage + "&page=" + page);
        String text = GitHubAuth.read(connection.getInputStream());
        // GitHub says there is a next page in the Link header (rel="next")
        String link = connection.getHeaderField("Link");
        boolean hasMore = link != null && link.contains("rel=\"next\"");
        try {
            JSONArray array = new JSONArray(text);
            List<Repo> repos = new ArrayList<>(array.length());
            for (int i = 0; i < array.length(); i++) repos.add(repo(array.getJSONObject(i)));
            return new Page(repos, hasMore);
        } catch (JSONException e) {
            throw new IOException("Unexpected answer from GitHub");
        }
    }

    /** The repository's default branch ("main"), what pull requests go into unless told otherwise. */
    public String defaultBranch(String token, String owner, String name) throws IOException, GitHubAuth.LoginException {
        JSONObject json = object(get(token, "/repos/" + path(owner) + "/" + path(name)));
        return json.optString("default_branch", "main");
    }

    /** The repository's branches on GitHub, by name: the bases a pull request can go into (the first 100). */
    public List<String> branches(String token, String owner, String name) throws IOException, GitHubAuth.LoginException {
        JSONArray array = array(get(token, "/repos/" + path(owner) + "/" + path(name) + "/branches?per_page=100"));
        List<String> names = new ArrayList<>(array.length());
        try {
            for (int i = 0; i < array.length(); i++) names.add(array.getJSONObject(i).getString("name"));
        } catch (JSONException e) {
            throw new IOException("Unexpected answer from GitHub");
        }
        return names;
    }

    /** The open pull request from [branch] (of this same repository), or null. */
    public PullRequest openPullRequest(String token, String owner, String name, String branch)
        throws IOException, GitHubAuth.LoginException {
        String head = URLEncoder.encode(owner + ":" + branch, "UTF-8");
        JSONArray array = array(get(token, "/repos/" + path(owner) + "/" + path(name) + "/pulls?state=open&per_page=1&head=" + head));
        try {
            return array.length() == 0 ? null : pullRequest(array.getJSONObject(0));
        } catch (JSONException e) {
            throw new IOException("Unexpected answer from GitHub");
        }
    }

    /**
     * Opens a pull request from [head] into [base]. GitHub's refusals (one
     * already open, no commits between the branches, a branch it does not
     * have) come as INVALID with GitHub's own words.
     */
    public PullRequest createPullRequest(
        String token,
        String owner,
        String name,
        String head,
        String base,
        String title,
        String body,
        boolean draft
    ) throws IOException, GitHubAuth.LoginException {
        JSONObject request = new JSONObject();
        try {
            request.put("head", head);
            request.put("base", base);
            request.put("title", title);
            request.put("body", body);
            request.put("draft", draft);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        HttpURLConnection connection = GitHubAuth.open(api + "/repos/" + path(owner) + "/" + path(name) + "/pulls");
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        authorize(connection, token);
        connection.setRequestProperty("Content-Type", "application/json");
        try (OutputStream out = connection.getOutputStream()) {
            out.write(request.toString().getBytes(StandardCharsets.UTF_8));
        }
        int status = connection.getResponseCode();
        if (status == 422) throw new GitHubAuth.LoginException("INVALID", refusal(connection));
        refuseUnless(201, status, connection);
        try {
            return pullRequest(new JSONObject(GitHubAuth.read(connection.getInputStream())));
        } catch (JSONException e) {
            throw new IOException("Unexpected answer from GitHub");
        }
    }

    private static PullRequest pullRequest(JSONObject json) throws JSONException {
        return new PullRequest(json.getInt("number"), json.getString("title"), json.getString("html_url"), json.optBoolean("draft"));
    }

    /** GitHub's own words for a refusal: the first error's message, else the message. */
    private static String refusal(HttpURLConnection connection) throws IOException {
        InputStream in = connection.getErrorStream();
        String text = in == null ? "" : GitHubAuth.read(in);
        try {
            JSONObject json = new JSONObject(text);
            JSONArray errors = json.optJSONArray("errors");
            if (errors != null && errors.length() > 0) {
                JSONObject first = errors.optJSONObject(0);
                String message = first != null ? first.optString("message", "") : errors.optString(0, "");
                if (!message.isEmpty()) return message;
            }
            return json.optString("message", "GitHub refused it");
        } catch (JSONException e) {
            return "GitHub refused it";
        }
    }

    private static String path(String part) throws IOException {
        return URLEncoder.encode(part, "UTF-8");
    }

    private static JSONObject object(HttpURLConnection connection) throws IOException {
        try {
            return new JSONObject(GitHubAuth.read(connection.getInputStream()));
        } catch (JSONException e) {
            throw new IOException("Unexpected answer from GitHub");
        }
    }

    private static JSONArray array(HttpURLConnection connection) throws IOException {
        try {
            return new JSONArray(GitHubAuth.read(connection.getInputStream()));
        } catch (JSONException e) {
            throw new IOException("Unexpected answer from GitHub");
        }
    }

    private static Repo repo(JSONObject json) throws JSONException {
        return new Repo(
            json.getString("full_name"),
            json.getString("name"),
            json.getJSONObject("owner").getString("login"),
            nullable(json, "description"),
            json.optBoolean("private"),
            json.optBoolean("fork"),
            json.optBoolean("archived"),
            json.optString("default_branch", "main"),
            json.getString("clone_url"),
            nullable(json, "language"),
            nullable(json, "pushed_at")
        );
    }

    /** A string that may be JSON null or missing (Android's optString turns null into "null"). */
    private static String nullable(JSONObject json, String key) {
        if (json.isNull(key)) return null;
        String value = json.optString(key, "");
        return value.isEmpty() ? null : value;
    }

    /** GETs [path], failing on anything but 200: a refused token, the rate limit, GitHub trouble. */
    private HttpURLConnection get(String token, String path) throws IOException, GitHubAuth.LoginException {
        HttpURLConnection connection = GitHubAuth.open(api + path);
        authorize(connection, token);
        refuseUnless(200, connection.getResponseCode(), connection);
        return connection;
    }

    private static void authorize(HttpURLConnection connection, String token) {
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
    }

    /**
     * Anything but [expected]: a refused token (UNAUTHORIZED), the rate limit
     * (RATE_LIMITED), no access (FORBIDDEN, or a repository GitHub will not
     * show: NOT_FOUND), or GitHub trouble (an IOException).
     */
    private static void refuseUnless(int expected, int status, HttpURLConnection connection)
        throws IOException, GitHubAuth.LoginException {
        if (status == expected) return;
        if (status == 401) throw new GitHubAuth.LoginException("UNAUTHORIZED", "GitHub no longer accepts the sign-in");
        if ((status == 403 || status == 429) && "0".equals(connection.getHeaderField("X-RateLimit-Remaining"))) {
            throw new GitHubAuth.LoginException("RATE_LIMITED", "Too many requests to GitHub: try again in a few minutes");
        }
        if (status == 403) throw new GitHubAuth.LoginException("FORBIDDEN", refusal(connection));
        if (status == 404) throw new GitHubAuth.LoginException("NOT_FOUND", "GitHub does not show this repository to you");
        throw new IOException("GitHub answered " + status);
    }
}
