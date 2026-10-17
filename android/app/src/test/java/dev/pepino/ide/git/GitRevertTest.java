package dev.pepino.ide.git;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Revert (#142): a new commit that undoes an earlier one, as GitHub Desktop makes it. */
public class GitRevertTest {

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

    private String commit(String message, String... paths) throws Exception {
        GitOps.commit(repo, message, List.of(paths), ME);
        return GitOps.lastCommit(repo).commit().id();
    }

    private List<String> summaries() throws Exception {
        List<String> summaries = new ArrayList<>();
        for (GitOps.LogEntry entry : GitOps.log(repo, 0, 10)) summaries.add(entry.summary());
        return summaries;
    }

    @Before
    public void setUp() throws Exception {
        System.setProperty("user.home", temp.newFolder("home").getAbsolutePath());
        repo = new File(temp.newFolder("projects"), "repo");
        assertTrue(repo.mkdirs());
        GitOps.init(repo);
        write("a.txt", "1\n2\n3\n4\n5\n6\n7\n8\n");
        write("gone.txt", "bye\n");
        commit("First", "a.txt", "gone.txt");
    }

    @Test
    public void anEarlierCommitIsUndoneByANewOneAndLaterChangesStay() throws Exception {
        write("a.txt", "ONE\n2\n3\n4\n5\n6\n7\n8\n");
        assertTrue(new File(repo, "gone.txt").delete());
        write("new.txt", "fresh\n");
        String id = commit("Change things", "a.txt", "gone.txt", "new.txt");
        write("a.txt", "ONE\n2\n3\n4\n5\n6\n7\nEIGHT\n");
        commit("Later", "a.txt");

        GitOps.Reverted reverted = GitOps.revert(repo, id, ME);

        assertEquals("Revert \"Change things\"", reverted.commit().summary());
        assertEquals(List.of("Revert \"Change things\"", "Later", "Change things", "First"), summaries());
        assertEquals("This reverts commit " + id + ".", GitOps.lastCommit(repo).commit().description());
        assertEquals("1\n2\n3\n4\n5\n6\n7\nEIGHT\n", read("a.txt"));
        assertEquals("bye\n", read("gone.txt"));
        assertFalse(new File(repo, "new.txt").exists());
        assertEquals(List.of("a.txt", "gone.txt"), reverted.written());
        assertEquals(List.of("new.txt"), reverted.removed());
        assertEquals(List.of(), GitOps.status(repo));
    }

    @Test
    public void laterChangesToTheSameLinesChangeNothing() throws Exception {
        write("a.txt", "ONE\n2\n3\n4\n5\n6\n7\n8\n");
        String id = commit("Change one", "a.txt");
        write("a.txt", "uno\n2\n3\n4\n5\n6\n7\n8\n");
        commit("Again", "a.txt");

        GitOps.MergeConflictException error = assertThrows(GitOps.MergeConflictException.class, () -> GitOps.revert(repo, id, ME));

        assertEquals(List.of("a.txt"), error.paths);
        assertEquals(List.of("Again", "Change one", "First"), summaries());
        assertEquals("uno\n2\n3\n4\n5\n6\n7\n8\n", read("a.txt"));
    }

    @Test
    public void uncommittedChangesToItsFilesAreInTheWayOthersAreNot() throws Exception {
        write("a.txt", "ONE\n2\n3\n4\n5\n6\n7\n8\n");
        String id = commit("Change one", "a.txt");
        write("a.txt", "mine\n");

        GitOps.ConflictException error = assertThrows(GitOps.ConflictException.class, () -> GitOps.revert(repo, id, ME));
        assertEquals(List.of("a.txt"), error.paths);
        assertEquals("mine\n", read("a.txt"));

        GitOps.discard(repo, List.of("a.txt"), java.util.Map.of());
        write("other.txt", "untouched\n");
        GitOps.revert(repo, id, ME);
        assertEquals("1\n2\n3\n4\n5\n6\n7\n8\n", read("a.txt"));
        assertEquals(List.of(new GitOps.FileChange("other.txt", "new")), GitOps.status(repo));
    }

    @Test
    public void theFirstCommitCanBeRevertedAndNothingTwice() throws Exception {
        String first = GitOps.log(repo, 0, 1).get(0).id();
        write("b.txt", "kept\n");
        commit("Second", "b.txt");

        GitOps.revert(repo, first, ME);

        assertFalse(new File(repo, "a.txt").exists());
        assertFalse(new File(repo, "gone.txt").exists());
        assertEquals("kept\n", read("b.txt"));
        assertThrows(IllegalArgumentException.class, () -> GitOps.revert(repo, first, ME));
    }
}
