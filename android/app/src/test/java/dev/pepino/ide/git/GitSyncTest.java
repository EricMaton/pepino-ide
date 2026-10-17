package dev.pepino.ide.git;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.revwalk.RevCommit;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Fetch, pull and push (#33) against a repository on disk standing in for
 * GitHub, with a teammate pushing to it from a clone of their own.
 */
public class GitSyncTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    private static final GitOps.Identity ME = new GitOps.Identity("Pepino", "me@pepino.dev");
    private static final PersonIdent MATE = new PersonIdent("Mate", "mate@pepino.dev");

    private String origin;
    private File mine;
    private File mate;

    private static final GitOps.Progress QUIET = new GitOps.Progress() {
        @Override
        public void update(String task, int done, int total) {}

        @Override
        public boolean cancelled() {
            return false;
        }
    };

    private static void write(File folder, String name, String text) throws Exception {
        File file = new File(folder, name);
        file.getParentFile().mkdirs();
        Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    private static String read(File folder, String name) throws Exception {
        return new String(Files.readAllBytes(new File(folder, name).toPath()), StandardCharsets.UTF_8);
    }

    /** The teammate commits [text] to [name] and pushes it to GitHub. */
    private void matePushes(String name, String text) throws Exception {
        try (Git git = Git.open(mate)) {
            git.pull().call();
            write(mate, name, text);
            git.add().addFilepattern(name).call();
            git.commit().setMessage("Mate edits " + name).setAuthor(MATE).setCommitter(MATE).call();
            git.push().call();
        }
    }

    private void commit(String name, String text) throws Exception {
        write(mine, name, text);
        GitOps.commit(mine, "Edit " + name, List.of(name), ME);
    }

    @Before
    public void setUp() throws Exception {
        System.setProperty("user.home", temp.newFolder("home").getAbsolutePath());
        File bare = temp.newFolder("github.git");
        Git.init().setBare(true).setDirectory(bare).setInitialBranch("main").call().close();
        origin = bare.toURI().toString();
        // GitHub's first commit, on main (a clone of an empty repository would start on master)
        File seed = temp.newFolder("seed");
        try (Git git = Git.init().setDirectory(seed).setInitialBranch("main").call()) {
            write(seed, "a.txt", "one\ntwo\nthree\n");
            write(seed, "b.txt", "bee\n");
            git.add().addFilepattern(".").call();
            git.commit().setMessage("First").setAuthor(MATE).setCommitter(MATE).call();
            git.push().setRemote(origin).add("main").call();
        }
        mate = temp.newFolder("mate");
        Git.cloneRepository().setURI(origin).setDirectory(mate).call().close();
        mine = new File(temp.newFolder("projects"), "repo");
        GitOps.clone(mine, origin, null, QUIET);
    }

    @Test
    public void aCloneFollowsGitHubsBranchAndIsUpToDate() throws Exception {
        assertEquals(new GitOps.SyncState(true, "origin/main", 0, 0), GitOps.syncState(mine));

        // A repository made here has no GitHub
        File local = new File(mine.getParentFile(), "local");
        assertTrue(local.mkdirs());
        GitOps.init(local);
        assertEquals(new GitOps.SyncState(false, null, 0, 0), GitOps.syncState(local));
        assertThrows(IllegalStateException.class, () -> GitOps.fetch(local, null, QUIET));
        assertThrows(IllegalStateException.class, () -> GitOps.push(local, null, QUIET));
    }

    @Test
    public void pushSendsTheBranchsCommits() throws Exception {
        commit("a.txt", "one\nTWO\nthree\n");
        assertEquals(new GitOps.SyncState(true, "origin/main", 1, 0), GitOps.syncState(mine));

        assertEquals(new GitOps.SyncState(true, "origin/main", 0, 0), GitOps.push(mine, null, QUIET));
        try (Git git = Git.open(mate)) {
            git.pull().call();
        }
        assertEquals("one\nTWO\nthree\n", read(mate, "a.txt"));
    }

    @Test
    public void aNewBranchIsPublishedAndFollowsGitHubsFromThen() throws Exception {
        GitOps.createBranch(mine, "feature");
        commit("c.txt", "sea\n");
        assertEquals(new GitOps.SyncState(true, null, 0, 0), GitOps.syncState(mine));

        assertEquals(new GitOps.SyncState(true, "origin/feature", 0, 0), GitOps.push(mine, null, QUIET));
        try (Git git = Git.open(mate)) {
            git.fetch().call();
            assertNotNull(git.getRepository().exactRef("refs/remotes/origin/feature"));
        }
        commit("c.txt", "sea and more\n");
        assertEquals(new GitOps.SyncState(true, "origin/feature", 1, 0), GitOps.syncState(mine));
    }

    @Test
    public void fetchCountsGitHubsNewCommitsAndPullFastForwards() throws Exception {
        matePushes("b.txt", "bee\nbuzz\n");
        assertEquals(0, GitOps.syncState(mine).behind()); // not fetched yet
        assertEquals(new GitOps.SyncState(true, "origin/main", 0, 1), GitOps.fetch(mine, null, QUIET));
        assertEquals("bee\n", read(mine, "b.txt")); // a fetch touches no file

        GitOps.Pulled pulled = GitOps.pull(mine, null, QUIET, ME);

        assertEquals(new GitOps.SyncState(true, "origin/main", 0, 0), pulled.state());
        assertEquals(List.of("b.txt"), pulled.written());
        assertTrue(pulled.removed().isEmpty());
        assertEquals("bee\nbuzz\n", read(mine, "b.txt"));
        assertTrue(GitOps.status(mine).isEmpty());
        // Up to date: a pull does nothing
        assertTrue(GitOps.pull(mine, null, QUIET, ME).written().isEmpty());
    }

    @Test
    public void pullMergesWhenBothSidesHaveCommitsOnDifferentLines() throws Exception {
        matePushes("a.txt", "ONE\ntwo\nthree\n");
        commit("a.txt", "one\ntwo\nTHREE\n");

        GitOps.Pulled pulled = GitOps.pull(mine, null, QUIET, ME);

        assertEquals("ONE\ntwo\nTHREE\n", read(mine, "a.txt"));
        assertEquals(0, pulled.state().behind());
        assertEquals(2, pulled.state().ahead()); // mine and the merge
        try (Git git = Git.open(mine)) {
            RevCommit merge = git.log().setMaxCount(1).call().iterator().next();
            assertEquals(2, merge.getParentCount());
            assertEquals("Merge origin/main into main", merge.getShortMessage());
            assertEquals("Pepino", merge.getAuthorIdent().getName());
        }
        assertTrue(GitOps.status(mine).isEmpty());
        // And it pushes
        assertEquals(0, GitOps.push(mine, null, QUIET).ahead());
    }

    @Test
    public void aPullThatWouldConflictChangesNothing() throws Exception {
        matePushes("a.txt", "one\nmate's two\nthree\n");
        commit("a.txt", "one\nmy two\nthree\n");
        String head;
        try (Git git = Git.open(mine)) {
            head = git.getRepository().resolve("HEAD").name();
        }

        GitOps.MergeConflictException error = assertThrows(
            GitOps.MergeConflictException.class,
            () -> GitOps.pull(mine, null, QUIET, ME)
        );

        assertEquals(List.of("a.txt"), error.paths);
        assertEquals("one\nmy two\nthree\n", read(mine, "a.txt"));
        assertTrue(GitOps.status(mine).isEmpty());
        try (Git git = Git.open(mine)) {
            assertEquals(head, git.getRepository().resolve("HEAD").name());
            assertNull(git.getRepository().readMergeHeads());
        }
        // Fetched though: it knows GitHub is ahead
        assertEquals(new GitOps.SyncState(true, "origin/main", 1, 1), GitOps.syncState(mine));
    }

    @Test
    public void uncommittedChangesInTheWayStopThePullOthersComeAlong() throws Exception {
        matePushes("b.txt", "bee\nbuzz\n");
        write(mine, "b.txt", "my uncommitted bee\n");
        GitOps.ConflictException error = assertThrows(GitOps.ConflictException.class, () -> GitOps.pull(mine, null, QUIET, ME));
        assertEquals(List.of("b.txt"), error.paths);
        assertTrue(error.getMessage().endsWith("before pulling"));
        assertEquals("my uncommitted bee\n", read(mine, "b.txt"));

        // An unrelated change is no problem
        write(mine, "b.txt", "bee\n");
        write(mine, "a.txt", "one\ntwo\nthree\nmine, uncommitted\n");
        GitOps.pull(mine, null, QUIET, ME);
        assertEquals("bee\nbuzz\n", read(mine, "b.txt"));
        assertEquals("one\ntwo\nthree\nmine, uncommitted\n", read(mine, "a.txt"));
    }

    @Test
    public void pushIsRejectedWhenGitHubHasCommitsThisBranchDoesNot() throws Exception {
        matePushes("b.txt", "bee\nbuzz\n");
        commit("a.txt", "one\nTWO\nthree\n");

        GitOps.RemoteException error = assertThrows(GitOps.RemoteException.class, () -> GitOps.push(mine, null, QUIET));

        assertEquals("REJECTED", error.code);
        try (Git git = Git.open(mate)) {
            git.pull().call();
        }
        assertEquals("one\ntwo\nthree\n", read(mate, "a.txt"));
        // Pull, then push
        GitOps.pull(mine, null, QUIET, ME);
        assertEquals(0, GitOps.push(mine, null, QUIET).ahead());
        assertFalse(GitOps.syncState(mine).behind() > 0);
    }

    @Test
    public void aMergeNeedsSomeoneToCommitIt() throws Exception {
        matePushes("a.txt", "ONE\ntwo\nthree\n");
        commit("a.txt", "one\ntwo\nTHREE\n");
        assertThrows(IllegalStateException.class, () -> GitOps.pull(mine, null, QUIET, null));
        assertEquals("one\ntwo\nTHREE\n", read(mine, "a.txt"));
    }

    @Test
    public void theLastFetchIsTheCloneOrTheLatestFetchEvenWhenItFoundNothing() throws Exception {
        File marker = new File(mine, ".git/pepino-fetched");
        long cloned = GitOps.lastFetched(mine);
        assertTrue(cloned > 0);
        assertTrue(marker.setLastModified(cloned - 60_000)); // a minute ago

        GitOps.fetch(mine, null, QUIET); // nothing new on GitHub

        assertTrue(GitOps.lastFetched(mine) > cloned - 60_000);
        File local = new File(mine.getParentFile(), "local");
        assertTrue(local.mkdirs());
        GitOps.init(local);
        assertEquals(0, GitOps.lastFetched(local));
    }

    @Test
    public void syncCommitsAreTheOnesBehindTheCounts() throws Exception {
        assertEquals(new GitOps.SyncCommits(List.of(), List.of()), GitOps.syncCommits(mine, 100));
        matePushes("b.txt", "bee\nbuzz\n");
        commit("a.txt", "one\nTWO\nthree\n");
        commit("c.txt", "sea\n");
        GitOps.fetch(mine, null, QUIET);

        GitOps.SyncCommits found = GitOps.syncCommits(mine, 100);

        assertEquals(List.of("Mate edits b.txt"), found.toPull().stream().map(GitOps.LogEntry::summary).toList());
        assertEquals("Mate", found.toPull().get(0).author());
        assertEquals(List.of("Edit c.txt", "Edit a.txt"), found.toPush().stream().map(GitOps.LogEntry::summary).toList());
        assertEquals(1, GitOps.syncCommits(mine, 1).toPush().size());

        // A branch not on GitHub yet has nothing to compare with
        GitOps.createBranch(mine, "feature");
        assertEquals(new GitOps.SyncCommits(List.of(), List.of()), GitOps.syncCommits(mine, 100));
    }
}
