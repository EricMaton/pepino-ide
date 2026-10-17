package dev.pepino.ide.github;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/** Pull requests (#34) against a fake GitHub. */
public class GitHubPullRequestTest {

    private static final String TOKEN = "gho_secret123";
    private static final String PULL = "{\"number\":12,\"title\":\"Add login\",\"html_url\":\"https://github.com/octocat/hello/pull/12\",\"draft\":false}";

    private FakeHttpServer server;
    private GitHubApi api;
    private final List<FakeHttpServer.Request> requests = new ArrayList<>();
    private FakeHttpServer.Response answer;

    @Before
    public void setUp() throws IOException {
        server = new FakeHttpServer(request -> {
            requests.add(request);
            return answer;
        });
        api = new GitHubApi(server.url());
    }

    @After
    public void tearDown() throws IOException {
        server.close();
    }

    @Test
    public void readsTheDefaultBranchAndTheBranches() throws Exception {
        answer = new FakeHttpServer.Response(200, "{\"name\":\"hello\",\"default_branch\":\"trunk\"}");
        assertEquals("trunk", api.defaultBranch(TOKEN, "octocat", "hello"));
        assertEquals("/repos/octocat/hello", requests.get(0).path());
        assertEquals("Bearer " + TOKEN, requests.get(0).headers().get("authorization"));

        answer = new FakeHttpServer.Response(200, "[{\"name\":\"trunk\"},{\"name\":\"feature/login\"}]");
        assertEquals(List.of("trunk", "feature/login"), api.branches(TOKEN, "octocat", "hello"));
        assertEquals("/repos/octocat/hello/branches?per_page=100", requests.get(1).path());
    }

    @Test
    public void findsTheBranchsOpenPullRequestOrNone() throws Exception {
        answer = new FakeHttpServer.Response(200, "[" + PULL + "]");
        GitHubApi.PullRequest found = api.openPullRequest(TOKEN, "octocat", "hello", "feature/login");
        assertEquals(new GitHubApi.PullRequest(12, "Add login", "https://github.com/octocat/hello/pull/12", false), found);
        assertEquals("/repos/octocat/hello/pulls?state=open&per_page=1&head=octocat%3Afeature%2Flogin", requests.get(0).path());

        answer = new FakeHttpServer.Response(200, "[]");
        assertNull(api.openPullRequest(TOKEN, "octocat", "hello", "other"));
    }

    @Test
    public void createsAPullRequest() throws Exception {
        answer = new FakeHttpServer.Response(201, PULL.replace("false", "true"));
        GitHubApi.PullRequest created = api.createPullRequest(
            TOKEN, "octocat", "hello", "feature/login", "trunk", "Add login", "Signs in with\nthe device flow", true
        );

        assertEquals(12, created.number());
        assertTrue(created.draft());
        FakeHttpServer.Request request = requests.get(0);
        assertEquals("POST", request.method());
        assertEquals("/repos/octocat/hello/pulls", request.path());
        JSONObject sent = new JSONObject(request.body());
        assertEquals("feature/login", sent.getString("head"));
        assertEquals("trunk", sent.getString("base"));
        assertEquals("Add login", sent.getString("title"));
        assertEquals("Signs in with\nthe device flow", sent.getString("body"));
        assertTrue(sent.getBoolean("draft"));
    }

    @Test
    public void gitHubsRefusalsKeepItsWords() {
        answer = new FakeHttpServer.Response(422, "{\"message\":\"Validation Failed\",\"errors\":[{\"resource\":\"PullRequest\",\"code\":\"custom\",\"message\":\"A pull request already exists for octocat:feature.\"}]}");
        GitHubAuth.LoginException exists = assertThrows(
            GitHubAuth.LoginException.class,
            () -> api.createPullRequest(TOKEN, "octocat", "hello", "feature", "main", "t", "", false)
        );
        assertEquals("INVALID", exists.code);
        assertEquals("A pull request already exists for octocat:feature.", exists.getMessage());

        answer = new FakeHttpServer.Response(403, "{\"message\":\"Resource not accessible by integration\"}");
        GitHubAuth.LoginException forbidden = assertThrows(
            GitHubAuth.LoginException.class,
            () -> api.createPullRequest(TOKEN, "octocat", "hello", "feature", "main", "t", "", false)
        );
        assertEquals("FORBIDDEN", forbidden.code);
        assertEquals("Resource not accessible by integration", forbidden.getMessage());

        answer = new FakeHttpServer.Response(404, "{\"message\":\"Not Found\"}");
        assertEquals(
            "NOT_FOUND",
            assertThrows(GitHubAuth.LoginException.class, () -> api.defaultBranch(TOKEN, "octocat", "secret")).code
        );
        answer = new FakeHttpServer.Response(401, "{}");
        GitHubAuth.LoginException refused = assertThrows(
            GitHubAuth.LoginException.class,
            () -> api.openPullRequest(TOKEN, "octocat", "hello", "x")
        );
        assertEquals("UNAUTHORIZED", refused.code);
        assertFalse(refused.getMessage().contains(TOKEN));
    }
}
