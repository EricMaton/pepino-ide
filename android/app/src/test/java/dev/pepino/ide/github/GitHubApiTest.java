package dev.pepino.ide.github;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/** The user's repositories from a fake GitHub (#31). */
public class GitHubApiTest {

    private static final String TOKEN = "gho_secret123";
    private static final String HELLO = "{\"full_name\":\"octocat/hello\",\"name\":\"hello\",\"owner\":{\"login\":\"octocat\"},"
        + "\"description\":\"Hi\",\"private\":true,\"fork\":false,\"archived\":false,\"default_branch\":\"main\","
        + "\"clone_url\":\"https://github.com/octocat/hello.git\",\"language\":\"Kotlin\",\"pushed_at\":\"2026-10-01T10:00:00Z\"}";
    private static final String EMPTY = "{\"full_name\":\"acme/empty\",\"name\":\"empty\",\"owner\":{\"login\":\"acme\"},"
        + "\"description\":null,\"private\":false,\"fork\":true,\"archived\":true,\"default_branch\":\"trunk\","
        + "\"clone_url\":\"https://github.com/acme/empty.git\",\"language\":null,\"pushed_at\":null}";

    private FakeHttpServer server;
    private GitHubApi api;
    /** What each request asked for: "path authorization". */
    private final List<String> requests = new ArrayList<>();
    private FakeHttpServer.Response answer;

    @Before
    public void setUp() throws IOException {
        server = new FakeHttpServer(request -> {
            requests.add(request.path() + " " + request.headers().get("authorization"));
            return answer;
        });
        api = new GitHubApi(server.url());
    }

    @After
    public void tearDown() throws IOException {
        server.close();
    }

    @Test
    public void readsAPageOfRepositoriesWithTheToken() throws Exception {
        answer = new FakeHttpServer.Response(200, "[" + HELLO + "," + EMPTY + "]",
            Map.of("Link", "<https://api.github.com/user/repos?page=3>; rel=\"next\", <https://api.github.com/user/repos?page=9>; rel=\"last\""));
        GitHubApi.Page page = api.repos(TOKEN, 2, 50);

        assertEquals("/user/repos?sort=pushed&per_page=50&page=2 Bearer " + TOKEN, requests.get(0));
        assertTrue(page.hasMore());
        assertEquals(2, page.repos().size());
        GitHubApi.Repo hello = page.repos().get(0);
        assertEquals(
            new GitHubApi.Repo("octocat/hello", "hello", "octocat", "Hi", true, false, false, "main",
                "https://github.com/octocat/hello.git", "Kotlin", "2026-10-01T10:00:00Z"),
            hello
        );
        // JSON nulls stay null, not "null"
        GitHubApi.Repo empty = page.repos().get(1);
        assertNull(empty.description());
        assertNull(empty.language());
        assertNull(empty.pushedAt());
        assertTrue(empty.fork());
        assertTrue(empty.archived());
        assertEquals("trunk", empty.defaultBranch());
    }

    @Test
    public void theLastPageHasNoMore() throws Exception {
        answer = new FakeHttpServer.Response(200, "[" + HELLO + "]",
            Map.of("Link", "<https://api.github.com/user/repos?page=1>; rel=\"prev\", <https://api.github.com/user/repos?page=1>; rel=\"first\""));
        assertFalse(api.repos(TOKEN, 2, 50).hasMore());

        answer = new FakeHttpServer.Response(200, "[]");
        GitHubApi.Page none = api.repos(TOKEN, 1, 50);
        assertFalse(none.hasMore());
        assertTrue(none.repos().isEmpty());
    }

    @Test
    public void aRefusedTokenIsUnauthorizedAndNeverInTheMessage() {
        answer = new FakeHttpServer.Response(401, "{\"message\":\"Bad credentials\"}");
        GitHubAuth.LoginException error = assertThrows(GitHubAuth.LoginException.class, () -> api.repos(TOKEN, 1, 50));
        assertEquals("UNAUTHORIZED", error.code);
        assertFalse(error.getMessage().contains(TOKEN));
    }

    @Test
    public void theRateLimitSaysSo() {
        answer = new FakeHttpServer.Response(403, "{\"message\":\"API rate limit exceeded\"}", Map.of("X-RateLimit-Remaining", "0"));
        GitHubAuth.LoginException error = assertThrows(GitHubAuth.LoginException.class, () -> api.repos(TOKEN, 1, 50));
        assertEquals("RATE_LIMITED", error.code);
    }

    @Test
    public void gitHubTroubleOrNoConnectionIsAnIOException() {
        answer = new FakeHttpServer.Response(502, "<html>Bad gateway</html>");
        assertThrows(IOException.class, () -> api.repos(TOKEN, 1, 50));

        GitHubApi offline = new GitHubApi("http://127.0.0.1:1");
        assertThrows(IOException.class, () -> offline.repos(TOKEN, 1, 50));
    }
}
