package dev.pepino.ide.git;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.revwalk.RevCommit;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Resolving a pull's conflicts in Pepino (#143): the merge left with its
 * conflicts, each file resolved, then committed or aborted. GitHub is a
 * repository on disk; a teammate pushes to it from a clone of their own.
 */
public class GitMergeConflictTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    private static final GitOps.Identity ME = new GitOps.Identity("Pepino", "me@pepino.dev");
    private static final PersonIdent MATE = new PersonIdent("Mate", "mate@pepino.dev");

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

    private List<String> changed() throws Exception {
        List<String> paths = new ArrayList<>();
        for (GitOps.FileChange change : GitOps.status(mine)) paths.add(change.path() + ":" + change.kind());
        return paths;
    }

    private String head() throws Exception {
        try (Git git = Git.open(mine)) {
            return git.getRepository().resolve("HEAD").name();
        }
    }

    @Before
    public void setUp() throws Exception {
        System.setProperty("user.home", temp.newFolder("home").getAbsolutePath());
        File bare = temp.newFolder("github.git");
        Git.init().setBare(true).setDirectory(bare).setInitialBranch("main").call().close();
        String origin = bare.toURI().toString();
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
        // Both sides change the same line, and GitHub adds a file
        matePushes("a.txt", "one\nmate's two\nthree\n");
        matePushes("c.txt", "from mate\n");
        commit("a.txt", "one\nmy two\nthree\n");
        GitOps.fetch(mine, null, QUIET);
    }

    @Test
    public void theMergeLeavesTheConflictToResolveThenItsCommitFinishesIt() throws Exception {
        assertNull(GitOps.mergeState(mine));

        GitOps.Pulled started = GitOps.startMerge(mine);

        assertEquals(new GitOps.MergeState("origin/main", "Merge origin/main into main"), GitOps.mergeState(mine));
        assertTrue(started.written().contains("a.txt"));
        assertTrue(started.written().contains("c.txt"));
        assertEquals(List.of("a.txt:conflicted", "c.txt:new"), changed());
        String text = read(mine, "a.txt");
        assertTrue(text.contains("<<<<<<< HEAD\nmy two\n=======\nmate's two\n>>>>>>> "));
        // Nothing else can happen meanwhile
        assertThrows(IllegalStateException.class, () -> GitOps.pull(mine, null, QUIET, ME));
        assertThrows(IllegalStateException.class, () -> GitOps.checkout(mine, "main"));
        assertThrows(IllegalStateException.class, () -> GitOps.undoCommit(mine));
        assertThrows(IllegalStateException.class, () -> GitOps.commit(mine, "Too soon", List.of("c.txt"), Map.of(), ME));

        // Markers still there: not resolved
        assertThrows(IllegalStateException.class, () -> GitOps.markResolved(mine, "a.txt"));
        write(mine, "a.txt", "one\nour two\nthree\n");
        GitOps.markResolved(mine, "a.txt");
        assertEquals(List.of("a.txt:modified", "c.txt:new"), changed());

        GitOps.CommitResult done = GitOps.commit(mine, "Merge origin/main into main", List.of(), Map.of(), ME);

        assertEquals("Merge origin/main into main", done.summary());
        assertNull(GitOps.mergeState(mine));
        assertEquals(List.of(), changed());
        try (Git git = Git.open(mine)) {
            RevCommit merge = git.log().setMaxCount(1).call().iterator().next();
            assertEquals(2, merge.getParentCount());
        }
        assertEquals(new GitOps.SyncState(true, "origin/main", 2, 0), GitOps.syncState(mine));
        assertEquals("one\nour two\nthree\n", read(mine, "a.txt"));
    }

    @Test
    public void abortingPutsTheBranchBackKeepingTheUsersNewFiles() throws Exception {
        String before = head();
        GitOps.startMerge(mine);
        write(mine, "notes.txt", "mine, made meanwhile\n");

        GitOps.Discarded aborted = GitOps.abortMerge(mine);

        assertNull(GitOps.mergeState(mine));
        assertEquals(before, head());
        assertEquals("one\nmy two\nthree\n", read(mine, "a.txt"));
        assertFalse(new File(mine, "c.txt").exists());
        assertTrue(aborted.removed().contains("c.txt"));
        assertEquals(List.of("notes.txt:new"), changed());
        assertThrows(IllegalStateException.class, () -> GitOps.abortMerge(mine));
    }

    @Test
    public void aMergeStartsOnlyFromABranchWithoutChanges() throws Exception {
        write(mine, "b.txt", "uncommitted\n");

        GitOps.ConflictException error = assertThrows(GitOps.ConflictException.class, () -> GitOps.startMerge(mine));

        assertEquals(List.of("b.txt"), error.paths);
        assertNull(GitOps.mergeState(mine));
    }

    @Test
    public void aFileDeletedToResolveItIsResolved() throws Exception {
        GitOps.startMerge(mine);
        assertTrue(new File(mine, "a.txt").delete());

        GitOps.markResolved(mine, "a.txt");
        GitOps.commit(mine, "Merge without a.txt", List.of(), Map.of(), ME);

        assertFalse(new File(mine, "a.txt").exists());
        assertEquals(List.of(), changed());
    }
}
