package dev.pepino.ide.git;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.errors.TransportException;
import org.eclipse.jgit.lib.PersonIdent;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Cloning (#32) from a repository on disk: the same JGit clone as from GitHub, without the network. */
public class GitCloneTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    private File space;
    private String origin;
    private final List<String> steps = new ArrayList<>();

    /** Records each step's name; [cancelAfter] updates in, says to stop (negative: never). */
    private GitOps.Progress progress(int cancelAfter) {
        return new GitOps.Progress() {
            private int updates;

            @Override
            public void update(String task, int done, int total) {
                updates++;
                if (steps.isEmpty() || !steps.get(steps.size() - 1).equals(task)) steps.add(task);
            }

            @Override
            public boolean cancelled() {
                return cancelAfter >= 0 && updates > cancelAfter;
            }
        };
    }

    @Before
    public void setUp() throws Exception {
        space = temp.newFolder("projects");
        System.setProperty("user.home", temp.newFolder("home").getAbsolutePath());
        // The remote: two commits on trunk (its default branch), one more on feature
        File remote = temp.newFolder("origin");
        PersonIdent me = new PersonIdent("Pepino", "test@pepino.dev");
        try (Git git = Git.init().setDirectory(remote).setInitialBranch("trunk").call()) {
            write(remote, "README.md", "# hello\n");
            for (int i = 0; i < 200; i++) write(remote, "src/file" + i + ".txt", "line " + i + "\n");
            git.add().addFilepattern(".").call();
            git.commit().setMessage("first").setAuthor(me).setCommitter(me).call();
            write(remote, "README.md", "# hello again\n");
            git.add().addFilepattern("README.md").call();
            git.commit().setMessage("second").setAuthor(me).setCommitter(me).call();
            git.branchCreate().setName("feature").call();
            git.checkout().setName("feature").call();
            write(remote, "feature.txt", "wip\n");
            git.add().addFilepattern("feature.txt").call();
            git.commit().setMessage("feature work").setAuthor(me).setCommitter(me).call();
            git.checkout().setName("trunk").call();
        }
        origin = remote.toURI().toString();
    }

    private static void write(File folder, String path, String text) throws IOException {
        File file = new File(folder, path);
        file.getParentFile().mkdirs();
        Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    /** The file's text, with \n line ends (on Windows, JGit honours the machine's core.autocrlf). */
    private static String read(File file) throws IOException {
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8).replace("\r\n", "\n");
    }

    @Test
    public void clonesTheDefaultBranchWithTheWholeHistoryAndEveryBranch() throws Exception {
        File hello = new File(space, "hello");

        GitOps.RepoInfo info = GitOps.clone(hello, origin, null, progress(-1));

        assertEquals(new GitOps.RepoInfo("trunk", true), info);
        assertEquals("# hello again\n", read(new File(hello, "README.md")));
        assertTrue(new File(hello, "src/file199.txt").isFile());
        assertFalse(new File(hello, "feature.txt").exists());
        assertEquals(2, GitOps.log(hello, 0, 50).size());
        try (Git git = Git.open(hello)) {
            assertNotNull(git.getRepository().findRef("refs/remotes/origin/feature"));
            // (JGit writes the URL normalized: file:///…)
            assertTrue(git.getRepository().getConfig().getString("remote", "origin", "url").endsWith("/origin/"));
        }
        // Pepino's own files stay out of git, as in a repository made here
        assertTrue(read(new File(hello, ".git/info/exclude")).contains(GitOps.PEPINO_EXCLUDE));
        assertTrue(GitOps.status(hello).isEmpty());
        assertFalse(steps.isEmpty());
    }

    @Test
    public void gitHubsOtherBranchesShowAndSwitchingMakesTheLocalOne() throws Exception {
        File hello = new File(space, "hello");
        GitOps.clone(hello, origin, null, progress(-1));

        assertEquals(
            List.of(new GitOps.Branch("trunk", true), new GitOps.Branch("feature", false, true)),
            GitOps.branches(hello)
        );

        GitOps.Switched switched = GitOps.checkout(hello, "feature");

        assertEquals(new GitOps.RepoInfo("feature", true), switched.info());
        assertEquals("wip\n", read(new File(hello, "feature.txt")));
        assertEquals(3, GitOps.log(hello, 0, 50).size());
        assertEquals(List.of(new GitOps.Branch("feature", true), new GitOps.Branch("trunk", false)), GitOps.branches(hello));
        try (Git git = Git.open(hello)) {
            // It follows GitHub's, for pull and push (#33)
            assertEquals("origin", git.getRepository().getConfig().getString("branch", "feature", "remote"));
            assertEquals("refs/heads/feature", git.getRepository().getConfig().getString("branch", "feature", "merge"));
        }

        // Back and forth, as with any local branch
        assertEquals("trunk", GitOps.checkout(hello, "trunk").info().branch());
        assertFalse(new File(hello, "feature.txt").exists());
        assertThrows(IllegalArgumentException.class, () -> GitOps.checkout(hello, "nowhere"));
    }

    @Test
    public void clonesIntoAnEmptyFolderButNeverOverAnything() throws Exception {
        File empty = new File(space, "empty");
        assertTrue(empty.mkdirs());
        assertEquals("trunk", GitOps.clone(empty, origin, null, progress(-1)).branch());

        File taken = new File(space, "taken");
        write(taken, "notes.txt", "mine\n");
        assertThrows(IOException.class, () -> GitOps.clone(taken, origin, null, progress(-1)));
        assertEquals("mine\n", read(new File(taken, "notes.txt")));
        assertFalse(new File(taken, ".git").exists());
    }

    @Test
    public void aCancelledCloneLeavesNothingBehind() throws Exception {
        File hello = new File(space, "hello");
        GitOps.RemoteException error = assertThrows(
            GitOps.RemoteException.class,
            () -> GitOps.clone(hello, origin, null, progress(0))
        );
        assertEquals("CANCELLED", error.code);
        assertFalse(hello.exists());

        // In a folder that was there (empty) before, the folder stays, empty
        File empty = new File(space, "empty");
        assertTrue(empty.mkdirs());
        assertThrows(GitOps.RemoteException.class, () -> GitOps.clone(empty, origin, null, progress(0)));
        assertTrue(empty.isDirectory());
        assertEquals(0, empty.list().length);
    }

    @Test
    public void aFailedCloneLeavesNothingBehind() {
        File missing = new File(space, "missing");
        String nowhere = new File(temp.getRoot(), "no-such-repo").toURI().toString();
        GitOps.RemoteException error = assertThrows(
            GitOps.RemoteException.class,
            () -> GitOps.clone(missing, nowhere, null, progress(-1))
        );
        assertEquals("FAILED", error.code);
        assertFalse(missing.exists());
    }

    @Test
    public void tellsARefusedSignInAndNoConnectionApart() {
        TransportException refused = new TransportException("https://github.com/a/b.git: not authorized");
        assertEquals("UNAUTHORIZED", ((GitOps.RemoteException) GitOps.remoteFailure(refused)).code);

        TransportException offline = new TransportException(
            "https://github.com/a/b.git: cannot open git-upload-pack",
            new UnknownHostException("github.com")
        );
        GitOps.RemoteException offlineFailure = (GitOps.RemoteException) GitOps.remoteFailure(offline);
        assertEquals("NETWORK", offlineFailure.code);
        assertEquals("No internet connection", offlineFailure.getMessage());

        // Each connection failure says which one it is (#36)
        TransportException slow = new TransportException("read timed out", new java.net.SocketTimeoutException("Read timed out"));
        assertEquals("NETWORK", ((GitOps.RemoteException) GitOps.remoteFailure(slow)).code);
        assertTrue(GitOps.remoteFailure(slow).getMessage().startsWith("GitHub is taking too long"));
        TransportException portal = new TransportException("handshake", new javax.net.ssl.SSLHandshakeException("bad certificate"));
        assertTrue(GitOps.remoteFailure(portal).getMessage().contains("Wi-Fi"));
        TransportException reset = new TransportException("reset", new java.net.SocketException("Connection reset"));
        assertEquals("The connection to GitHub dropped", GitOps.remoteFailure(reset).getMessage());

        TransportException other = new TransportException("https://github.com/a/b.git: Repository not found");
        assertEquals("FAILED", ((GitOps.RemoteException) GitOps.remoteFailure(other)).code);
    }
}
