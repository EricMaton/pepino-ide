package dev.pepino.ide.github;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/** The device flow against a fake GitHub (#29). */
public class GitHubAuthTest {

    private static final String TOKEN = "gho_secret123";
    /** A poll whose connection drops unanswered, as when Android cuts the network. */
    private static final String DROP = "DROP";

    private FakeHttpServer server;
    private GitHubAuth auth;
    /** Answers to the token polls, in order. */
    private final Deque<String> polls = new ArrayDeque<>();
    /** What each request sent: "METHOD path body-or-authorization". */
    private final List<String> requests = new ArrayList<>();
    private int userStatus = 200;
    /** How many /user requests drop unanswered before one is. */
    private int userDrops = 0;
    private String user = "{\"login\":\"octocat\",\"name\":null,\"avatar_url\":\"https://avatars/1\"}";
    private final List<Long> sleeps = new ArrayList<>();

    @Before
    public void setUp() throws IOException {
        server = new FakeHttpServer(request -> {
            switch (request.path()) {
                case "/login/device/code":
                    requests.add(request.method() + " " + request.path() + " " + request.body());
                    return new FakeHttpServer.Response(200, "{\"device_code\":\"dev123\",\"user_code\":\"WDJB-MJHT\",\"verification_uri\":\"https://github.com/login/device\",\"expires_in\":900,\"interval\":5}");
                case "/login/oauth/access_token":
                    requests.add(request.method() + " " + request.path() + " " + request.body());
                    String poll = polls.isEmpty() ? "{\"error\":\"authorization_pending\"}" : polls.removeFirst();
                    return poll.equals(DROP) ? null : new FakeHttpServer.Response(200, poll);
                case "/user":
                    requests.add(request.method() + " /user " + request.headers().get("authorization"));
                    if (userDrops > 0) {
                        userDrops--;
                        return null;
                    }
                    return new FakeHttpServer.Response(userStatus, userStatus == 200 ? user : "{\"message\":\"Bad credentials\"}");
                default:
                    return new FakeHttpServer.Response(404, "{}");
            }
        });
        auth = new GitHubAuth(server.url(), server.url());
    }

    @After
    public void tearDown() throws IOException {
        server.close();
    }

    private GitHubAuth.DeviceCode code(int expiresIn) {
        return new GitHubAuth.DeviceCode("dev123", "WDJB-MJHT", "https://github.com/login/device", expiresIn, 5);
    }

    private String waitForToken(GitHubAuth.DeviceCode code) throws Exception {
        return auth.waitForToken("client1", code, () -> false, sleeps::add);
    }

    @Test
    public void requestsADeviceCodeWithTheClientIdAndScopes() throws Exception {
        GitHubAuth.DeviceCode code = auth.requestDeviceCode("client1", "repo read:user");
        assertEquals("WDJB-MJHT", code.userCode());
        assertEquals("https://github.com/login/device", code.verificationUri());
        assertEquals(900, code.expiresIn());
        assertEquals("POST /login/device/code client_id=client1&scope=repo+read%3Auser", requests.get(0));
    }

    @Test
    public void pollsUntilApprovedSlowingDownWhenAsked() throws Exception {
        polls.add("{\"error\":\"authorization_pending\"}");
        polls.add("{\"error\":\"slow_down\",\"interval\":10}");
        polls.add("{\"error\":\"authorization_pending\"}");
        polls.add("{\"access_token\":\"" + TOKEN + "\",\"token_type\":\"bearer\",\"scope\":\"repo\"}");

        assertEquals(TOKEN, waitForToken(code(900)));

        assertEquals(List.of(5000L, 5000L, 10000L, 10000L), sleeps);
        assertEquals(
            "POST /login/oauth/access_token client_id=client1&device_code=dev123&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code",
            requests.get(0)
        );
    }

    @Test
    public void aSlowDownWithoutIntervalAddsFiveSeconds() throws Exception {
        polls.add("{\"error\":\"slow_down\"}");
        polls.add("{\"access_token\":\"" + TOKEN + "\"}");
        waitForToken(code(900));
        assertEquals(List.of(5000L, 10000L), sleeps);
    }

    @Test
    public void endsWhenTheUserDeniesTheCodeExpiresOrPepinoCancels() throws Exception {
        polls.add("{\"error\":\"access_denied\"}");
        assertEquals("DENIED", assertThrows(GitHubAuth.LoginException.class, () -> waitForToken(code(900))).code);

        polls.add("{\"error\":\"expired_token\"}");
        assertEquals("EXPIRED", assertThrows(GitHubAuth.LoginException.class, () -> waitForToken(code(900))).code);

        polls.add("{\"error\":\"device_flow_disabled\"}");
        assertEquals("DISABLED", assertThrows(GitHubAuth.LoginException.class, () -> waitForToken(code(900))).code);

        // Still pending when the code runs out (3 polls of 5 s for 15 s)
        assertEquals("EXPIRED", assertThrows(GitHubAuth.LoginException.class, () -> waitForToken(code(15))).code);

        int before = requests.size();
        GitHubAuth.LoginException cancelled = assertThrows(
            GitHubAuth.LoginException.class,
            () -> auth.waitForToken("client1", code(900), () -> true, sleeps::add)
        );
        assertEquals("CANCELLED", cancelled.code);
        assertEquals("a cancelled sign-in asks GitHub nothing more", before, requests.size());
    }

    @Test
    public void readsTheAccountWithTheTokenAndNeverPutsTheTokenInAnError() throws Exception {
        GitHubAuth.Account account = auth.account(TOKEN);
        assertEquals("octocat", account.login());
        assertNull(account.name());
        assertEquals("https://avatars/1", account.avatarUrl());
        assertEquals("GET /user Bearer " + TOKEN, requests.get(0));

        user = "{\"login\":\"mona\",\"name\":\"Mona Lisa\",\"avatar_url\":\"\"}";
        assertEquals("Mona Lisa", auth.account(TOKEN).name());

        userStatus = 401;
        GitHubAuth.LoginException refused = assertThrows(GitHubAuth.LoginException.class, () -> auth.account(TOKEN));
        assertEquals("UNAUTHORIZED", refused.code);
        assertFalse(refused.getMessage().contains(TOKEN));

        userStatus = 500;
        IOException broken = assertThrows(IOException.class, () -> auth.account(TOKEN));
        assertFalse(broken.getMessage().contains(TOKEN));
    }

    @Test
    public void anHttpErrorWithoutJsonIsGitHubRefusingNotTheNetwork() throws Exception {
        try (FakeHttpServer notFound = new FakeHttpServer(request -> new FakeHttpServer.Response(404, "Not Found"))) {
            GitHubAuth unknownApp = new GitHubAuth(notFound.url(), notFound.url());
            GitHubAuth.LoginException refused = assertThrows(
                GitHubAuth.LoginException.class,
                () -> unknownApp.requestDeviceCode("nope", "repo")
            );
            assertEquals("FAILED", refused.code);
        }
    }

    @Test
    public void keepsPollingWhileTheNetworkIsCut() throws Exception {
        polls.add(DROP);
        polls.add(DROP);
        polls.add("{\"access_token\":\"" + TOKEN + "\"}");
        assertEquals(TOKEN, waitForToken(code(900)));
        assertEquals(3, requests.size());
    }

    @Test
    public void aCodeThatRunsOutWhileOfflineExpires() {
        for (int i = 0; i < 3; i++) polls.add(DROP);
        GitHubAuth.LoginException error = assertThrows(GitHubAuth.LoginException.class, () -> waitForToken(code(10)));
        assertEquals("EXPIRED", error.code);
    }

    @Test
    public void readsTheAccountOnceTheNetworkIsBack() throws Exception {
        // (HttpURLConnection already retries a dropped GET once by itself)
        userDrops = 4;
        GitHubAuth.Account account = auth.accountRetrying(TOKEN, () -> false, sleeps::add);
        assertEquals("octocat", account.login());
        assertFalse(sleeps.isEmpty());
    }

    @Test
    public void givesUpOnTheAccountAfterAMinuteOffline() {
        userDrops = 100;
        assertThrows(IOException.class, () -> auth.accountRetrying(TOKEN, () -> false, sleeps::add));
        assertEquals(11, sleeps.size());
    }

    @Test
    public void noConnectionIsAnIOException() {
        GitHubAuth offline = new GitHubAuth("http://127.0.0.1:1", "http://127.0.0.1:1");
        assertThrows(IOException.class, () -> offline.requestDeviceCode("client1", "repo"));
    }
}
