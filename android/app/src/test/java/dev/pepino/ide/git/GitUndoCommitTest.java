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
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.Constants;
import org.eclipse.jgit.lib.RefUpdate;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Undo (#140): the last commit goes, its changes stay uncommitted, as GitHub Desktop does. */
public class GitUndoCommitTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    private static final GitOps.Identity ME = new GitOps.Identity("Pepino", "me@pepino.dev");

    private File repo;

    private void write(String name, String text) throws Exception {
        File file = new File(repo, name);
        file.getParentFile().mkdirs();
        Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    private String read(String name) throws Exception {
        return new String(Files.readAllBytes(new File(repo, name).toPath()), StandardCharsets.UTF_8);
    }

    private List<String> changed() throws Exception {
        List<String> paths = new ArrayList<>();
        for (GitOps.FileChange change : GitOps.status(repo)) paths.add(change.path() + ":" + change.kind());
        return paths;
    }

    @Before
    public void setUp() throws Exception {
        System.setProperty("user.home", temp.newFolder("home").getAbsolutePath());
        repo = new File(temp.newFolder("projects"), "repo");
        assertTrue(repo.mkdirs());
        GitOps.init(repo);
        write("a.txt", "one\n");
        write("gone.txt", "bye\n");
        GitOps.commit(repo, "First", List.of("a.txt", "gone.txt"), ME);
    }

    @Test
    public void undoingLeavesTheChangesUncommittedAndGivesBackTheMessage() throws Exception {
        write("a.txt", "two\n");
        assertTrue(new File(repo, "gone.txt").delete());
        write("src/new.txt", "fresh\n");
        GitOps.commit(repo, "Second\n\nWhy it changed", List.of("a.txt", "gone.txt", "src/new.txt"), ME);
        write("a.txt", "three\n");

        GitOps.LastCommit last = GitOps.lastCommit(repo);
        assertEquals("Second", last.commit().summary());
        assertFalse(last.onGitHub());
        assertFalse(last.merge());

        GitOps.LogEntry undone = GitOps.undoCommit(repo);

        assertEquals("Second", undone.summary());
        assertEquals("Why it changed", undone.description());
        assertEquals("First", GitOps.lastCommit(repo).commit().summary());
        // The files stay as they are, the change made after the commit too
        assertEquals("three\n", read("a.txt"));
        assertEquals(List.of("a.txt:modified", "gone.txt:deleted", "src/new.txt:new"), changed());
    }

    @Test
    public void undoingTheFirstCommitLeavesTheBranchWithNone() throws Exception {
        GitOps.LogEntry undone = GitOps.undoCommit(repo);

        assertEquals("First", undone.summary());
        assertNull(GitOps.lastCommit(repo));
        assertEquals(new GitOps.RepoInfo("main", false), GitOps.info(repo));
        assertEquals(List.of("a.txt:new", "gone.txt:new"), changed());
        assertThrows(IllegalStateException.class, () -> GitOps.undoCommit(repo));

        GitOps.commit(repo, "Again", List.of("a.txt"), ME);
        assertEquals("Again", GitOps.lastCommit(repo).commit().summary());
        assertEquals(List.of("gone.txt:new"), changed());
    }

    @Test
    public void aCommitOnGitHubIsNotUndone() throws Exception {
        write("a.txt", "two\n");
        GitOps.commit(repo, "Pushed", List.of("a.txt"), ME);
        // As a fetch leaves it: GitHub's branch is at this commit
        try (Git git = Git.open(repo)) {
            RefUpdate remote = git.getRepository().updateRef(Constants.R_REMOTES + "origin/feature");
            remote.setNewObjectId(git.getRepository().resolve(Constants.HEAD));
            remote.update();
        }

        assertTrue(GitOps.lastCommit(repo).onGitHub());
        assertThrows(GitOps.PushedException.class, () -> GitOps.undoCommit(repo));
        assertEquals("Pushed", GitOps.lastCommit(repo).commit().summary());
        assertEquals(List.of(), changed());

        // A commit after it is not on GitHub yet
        write("a.txt", "three\n");
        GitOps.commit(repo, "Local", List.of("a.txt"), ME);
        assertFalse(GitOps.lastCommit(repo).onGitHub());
        assertEquals("Local", GitOps.undoCommit(repo).summary());
        assertEquals("Pushed", GitOps.lastCommit(repo).commit().summary());
    }

    @Test
    public void aMergeCommitIsNotUndone() throws Exception {
        GitOps.createBranch(repo, "feature");
        write("b.txt", "feature\n");
        GitOps.commit(repo, "On feature", List.of("b.txt"), ME);
        GitOps.checkout(repo, "main");
        write("a.txt", "main\n");
        GitOps.commit(repo, "On main", List.of("a.txt"), ME);
        try (Git git = Git.open(repo)) {
            git.merge().include(git.getRepository().resolve("feature")).setMessage("Merge feature").call();
        }

        assertTrue(GitOps.lastCommit(repo).merge());
        assertThrows(IllegalStateException.class, () -> GitOps.undoCommit(repo));
        assertEquals("Merge feature", GitOps.lastCommit(repo).commit().summary());
    }
}
