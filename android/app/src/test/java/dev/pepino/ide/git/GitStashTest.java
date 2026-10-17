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
import org.eclipse.jgit.revwalk.RevCommit;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Stashing (#139): one stash per branch, as GitHub Desktop keeps them. */
public class GitStashTest {

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
        write("a.txt", "one\ntwo\n");
        write("gone.txt", "bye\n");
        GitOps.commit(repo, "First", List.of("a.txt", "gone.txt"), ME);
    }

    @Test
    public void stashingLeavesTheBranchCleanAndRestoringBringsEverythingBack() throws Exception {
        write("a.txt", "one\nTWO\n");
        assertTrue(new File(repo, "gone.txt").delete());
        write("src/new.txt", "fresh\n");
        assertNull(GitOps.stash(repo));

        GitOps.Stashed stashed = GitOps.stashChanges(repo, ME);

        assertEquals(List.of(), changed());
        assertEquals("one\ntwo\n", read("a.txt"));
        assertFalse(new File(repo, "src/new.txt").exists());
        assertEquals(List.of("a.txt", "gone.txt"), stashed.written());
        assertEquals(List.of("src/new.txt"), stashed.removed());
        GitOps.Stash stash = GitOps.stash(repo);
        assertEquals("main", stash.branch());
        assertEquals(
            List.of(
                new GitOps.FileChange("a.txt", "modified"),
                new GitOps.FileChange("gone.txt", "deleted"),
                new GitOps.FileChange("src/new.txt", "new")
            ),
            stash.files()
        );

        GitOps.Stashed restored = GitOps.restoreStash(repo);

        assertEquals(List.of("a.txt:modified", "gone.txt:deleted", "src/new.txt:new"), changed());
        assertEquals("one\nTWO\n", read("a.txt"));
        assertEquals("fresh\n", read("src/new.txt"));
        assertEquals(List.of("a.txt", "src/new.txt"), restored.written());
        assertEquals(List.of("gone.txt"), restored.removed());
        assertNull(GitOps.stash(repo));
    }

    @Test
    public void eachBranchHasItsOwnStashNamedTheWayGitHubDesktopNamesIt() throws Exception {
        write("a.txt", "on main\n");
        GitOps.stashChanges(repo, ME);
        GitOps.createBranch(repo, "feature");
        assertNull(GitOps.stash(repo));
        write("a.txt", "on feature\n");
        GitOps.stashChanges(repo, ME);

        try (Git git = Git.open(repo)) {
            List<String> messages = new ArrayList<>();
            for (RevCommit commit : git.stashList().call()) messages.add(commit.getFullMessage().trim());
            assertEquals(List.of("On feature: !!GitHub_Desktop<feature>", "On main: !!GitHub_Desktop<main>"), messages);
        }
        GitOps.checkout(repo, "main");
        GitOps.restoreStash(repo);
        assertEquals("on main\n", read("a.txt"));
    }

    @Test
    public void stashingAgainReplacesTheBranchsStash() throws Exception {
        write("a.txt", "first try\n");
        GitOps.stashChanges(repo, ME);
        write("a.txt", "second try\n");
        GitOps.stashChanges(repo, ME);

        GitOps.restoreStash(repo);
        assertEquals("second try\n", read("a.txt"));
        assertNull(GitOps.stash(repo));
    }

    @Test
    public void restoringNeedsAClearBranchAndDroppingThrowsTheStashAway() throws Exception {
        write("a.txt", "stashed\n");
        GitOps.stashChanges(repo, ME);
        write("gone.txt", "in the way\n");

        GitOps.ConflictException error = assertThrows(GitOps.ConflictException.class, () -> GitOps.restoreStash(repo));
        assertEquals(List.of("gone.txt"), error.paths);
        assertTrue(GitOps.stash(repo) != null);

        GitOps.dropStash(repo);
        assertNull(GitOps.stash(repo));
        assertEquals("in the way\n", read("gone.txt"));
        assertThrows(IllegalStateException.class, () -> GitOps.dropStash(repo));
        assertThrows(IllegalArgumentException.class, () -> {
            GitOps.discard(repo, List.of("gone.txt"), java.util.Map.of());
            GitOps.stashChanges(repo, ME);
        });
    }

    @Test
    public void aStashThatNoLongerFitsChangesNothingAndStays() throws Exception {
        write("a.txt", "one\nmine\n");
        GitOps.stashChanges(repo, ME);
        write("a.txt", "one\ncommitted meanwhile\n");
        GitOps.commit(repo, "Meanwhile", List.of("a.txt"), ME);

        IllegalStateException error = assertThrows(IllegalStateException.class, () -> GitOps.restoreStash(repo));

        assertTrue(error.getMessage().contains("conflict"));
        assertEquals(List.of(), changed());
        assertEquals("one\ncommitted meanwhile\n", read("a.txt"));
        assertTrue(GitOps.stash(repo) != null);
    }
}
