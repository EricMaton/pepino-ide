package dev.pepino.ide.github;

import java.io.IOException;
import java.net.HttpURLConnection;
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
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
        int status = connection.getResponseCode();
        if (status == 200) return connection;
        if (status == 401) throw new GitHubAuth.LoginException("UNAUTHORIZED", "GitHub no longer accepts the sign-in");
        if ((status == 403 || status == 429) && "0".equals(connection.getHeaderField("X-RateLimit-Remaining"))) {
            throw new GitHubAuth.LoginException("RATE_LIMITED", "Too many requests to GitHub: try again in a few minutes");
        }
        throw new IOException("GitHub answered " + status);
    }
}
