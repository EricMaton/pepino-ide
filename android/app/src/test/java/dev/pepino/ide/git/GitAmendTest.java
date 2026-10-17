package dev.pepino.ide.git;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.Constants;
import org.eclipse.jgit.lib.RefUpdate;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Amend (#141): the last commit replaced, with a new message and more changes, as GitHub Desktop does. */
public class GitAmendTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    private static final GitOps.Identity ME = new GitOps.Identity("Pepino", "me@pepino.dev");
    private static final GitOps.Identity OTHER = new GitOps.Identity("Other", "other@pepino.dev");

    private File repo;

    private void write(String name, String text) throws Exception {
        File file = new File(repo, name);
        file.getParentFile().mkdirs();
        Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    private List<String> summaries() throws Exception {
        List<String> summaries = new ArrayList<>();
        for (GitOps.LogEntry entry : GitOps.log(repo, 0, 10)) summaries.add(entry.summary());
        return summaries;
    }

    private GitOps.CommitResult amend(String message, List<String> paths) throws Exception {
        return GitOps.commit(repo, message, paths, Map.of(), OTHER, true);
    }

    @Before
    public void setUp() throws Exception {
        System.setProperty("user.home", temp.newFolder("home").getAbsolutePath());
        repo = new File(temp.newFolder("projects"), "repo");
        assertTrue(repo.mkdirs());
        GitOps.init(repo);
        write("a.txt", "one\n");
        GitOps.commit(repo, "First", List.of("a.txt"), ME);
        write("a.txt", "two\n");
        GitOps.commit(repo, "Secnod", List.of("a.txt"), ME);
    }

    @Test
    public void aNewMessageAloneReplacesTheLastCommitKeepingItsAuthor() throws Exception {
        String before = GitOps.lastCommit(repo).commit().id();

        amend("Second\n\nWith a description", List.of());

        GitOps.LogEntry last = GitOps.lastCommit(repo).commit();
        assertNotEquals(before, last.id());
        assertEquals(List.of("Second", "First"), summaries());
        assertEquals("With a description", last.description());
        assertEquals("Pepino", last.author());
        assertEquals(List.of(new GitOps.FileChange("a.txt", "modified")), GitOps.commitChanges(repo, last.id()));
    }

    @Test
    public void theChosenChangesJoinTheCommitAndTheOthersStay() throws Exception {
        write("b.txt", "joins\n");
        write("c.txt", "stays out\n");

        amend("Second", List.of("b.txt"));

        assertEquals(List.of("Second", "First"), summaries());
        assertEquals(
            List.of(new GitOps.FileChange("a.txt", "modified"), new GitOps.FileChange("b.txt", "new")),
            GitOps.commitChanges(repo, GitOps.lastCommit(repo).commit().id())
        );
        assertEquals(List.of(new GitOps.FileChange("c.txt", "new")), GitOps.status(repo));
    }

    @Test
    public void aCommitOnGitHubIsNotAmended() throws Exception {
        try (Git git = Git.open(repo)) {
            RefUpdate remote = git.getRepository().updateRef(Constants.R_REMOTES + "origin/main");
            remote.setNewObjectId(git.getRepository().resolve(Constants.HEAD));
            remote.update();
        }

        GitOps.PushedException error = assertThrows(GitOps.PushedException.class, () -> amend("Second", List.of()));

        assertTrue(error.getMessage().contains("amending"));
        assertEquals(List.of("Secnod", "First"), summaries());
    }

    @Test
    public void thereMustBeACommitToAmend() throws Exception {
        File empty = new File(temp.newFolder("more"), "empty");
        assertTrue(empty.mkdirs());
        GitOps.init(empty);
        Files.write(new File(empty, "a.txt").toPath(), "one\n".getBytes(StandardCharsets.UTF_8));

        assertThrows(IllegalStateException.class, () -> GitOps.commit(empty, "First", List.of("a.txt"), Map.of(), ME, true));
        assertThrows(IllegalArgumentException.class, () -> GitOps.commit(repo, "Nothing", List.of(), Map.of(), ME, false));
    }
}
