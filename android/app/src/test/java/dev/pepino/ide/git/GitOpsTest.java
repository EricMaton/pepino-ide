package dev.pepino.ide.git;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.revwalk.RevCommit;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The git operations against real JGit on the JVM: the same code that runs on the phone (ADR-006, #28). */
public class GitOpsTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    private File space;

    @Before
    public void setUp() throws Exception {
        space = temp.newFolder("projects");
        // Keep JGit away from the machine's own git config.
        System.setProperty("user.home", temp.newFolder("home").getAbsolutePath());
    }

    private File project(String name) throws Exception {
        File folder = new File(space, name);
        assertTrue(folder.mkdirs());
        return folder;
    }

    @Test
    public void resolvesProjectsInsideTheSpaceOnly() throws Exception {
        File app = project("app");
        assertEquals(app.getCanonicalFile(), GitOps.resolve(space, "app"));
        assertEquals(new File(app, "packages").getCanonicalFile(), GitOps.resolve(space, "app/packages"));
        assertThrows(IllegalArgumentException.class, () -> GitOps.resolve(space, ""));
        assertThrows(IllegalArgumentException.class, () -> GitOps.resolve(space, "."));
        assertThrows(IllegalArgumentException.class, () -> GitOps.resolve(space, "../outside"));
        assertThrows(IllegalArgumentException.class, () -> GitOps.resolve(space, "app/../.."));
    }

    @Test
    public void initMakesARepositoryOnMainWithNoCommits() throws Exception {
        File app = project("app");
        assertFalse(GitOps.isRepository(app));
        assertNull(GitOps.info(app));

        GitOps.RepoInfo info = GitOps.init(app);

        assertTrue(GitOps.isRepository(app));
        assertEquals(new GitOps.RepoInfo("main", false), info);
        assertEquals(info, GitOps.info(app));
    }

    @Test
    public void initLeavesAnExistingRepositoryAsItIs() throws Exception {
        File app = project("app");
        try (Git git = Git.init().setDirectory(app).setInitialBranch("trunk").call()) {
            Files.write(new File(app, "README.md").toPath(), "# app\n".getBytes(StandardCharsets.UTF_8));
            git.add().addFilepattern("README.md").call();
            PersonIdent me = new PersonIdent("Pepino", "test@pepino.dev");
            git.commit().setMessage("first").setAuthor(me).setCommitter(me).call();
        }

        assertEquals(new GitOps.RepoInfo("trunk", true), GitOps.init(app));
        try (Git git = Git.open(app)) {
            assertEquals(1, countCommits(git));
        }
    }

    @Test
    public void aFolderInsideARepositoryIsNotARepositoryOfItsOwn() throws Exception {
        File app = project("app");
        GitOps.init(app);
        File packages = project("app/packages");
        assertFalse(GitOps.isRepository(packages));
    }

    @Test
    public void initRefusesWhatIsNotAFolder() throws Exception {
        assertThrows(java.io.IOException.class, () -> GitOps.init(new File(space, "missing")));
    }

    private static final GitOps.Identity ME = new GitOps.Identity("Pepino", "me@pepino.dev");

    private static void write(File folder, String path, String text) throws Exception {
        File file = new File(folder, path);
        file.getParentFile().mkdirs();
        Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    private static List<GitOps.FileChange> changes(String... pathKinds) {
        GitOps.FileChange[] list = new GitOps.FileChange[pathKinds.length / 2];
        for (int i = 0; i < list.length; i++) list[i] = new GitOps.FileChange(pathKinds[2 * i], pathKinds[2 * i + 1]);
        return Arrays.asList(list);
    }

    @Test
    public void statusListsNewModifiedAndDeletedFilesAgainstTheLastCommit() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "keep.txt", "1");
        write(app, "edit.txt", "1");
        write(app, "gone.txt", "1");
        GitOps.commit(app, "first", Arrays.asList("keep.txt", "edit.txt", "gone.txt"), ME);

        write(app, "edit.txt", "2");
        assertTrue(new File(app, "gone.txt").delete());
        write(app, "src/new.ts", "x");

        assertEquals(changes("edit.txt", "modified", "gone.txt", "deleted", "src/new.ts", "new"), GitOps.status(app));
    }

    @Test
    public void pepinoSnapshotsAndIgnoredFilesAreNeverChanges() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, ".pepino/snapshots/a.ts@1", "old");
        write(app, ".gitignore", "build/\n");
        write(app, "build/out.js", "x");
        assertEquals(changes(".gitignore", "new"), GitOps.status(app));
    }

    @Test
    public void anExistingRepositoryGetsPepinoExcludedToo() throws Exception {
        File app = project("app");
        Git.init().setDirectory(app).call().close();
        write(app, ".pepino/snapshots/a.ts@1", "old");
        assertEquals(Collections.emptyList(), GitOps.status(app));
    }

    @Test
    public void commitTakesExactlyTheChosenFiles() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "a.txt", "a");
        write(app, "b.txt", "b");
        try (Git git = Git.open(app)) {
            git.add().addFilepattern("b.txt").call(); // staged before, but not chosen
        }

        GitOps.CommitResult result = GitOps.commit(app, "Add a\n\nOnly a for now.", Collections.singletonList("a.txt"), ME);

        assertEquals("Add a", result.summary());
        assertEquals(7, result.id().length());
        assertEquals(changes("b.txt", "new"), GitOps.status(app));
        assertEquals(new GitOps.RepoInfo("main", true), GitOps.info(app));
        try (Git git = Git.open(app)) {
            RevCommit commit = git.log().call().iterator().next();
            assertEquals("Add a\n\nOnly a for now.\n", commit.getFullMessage());
            assertEquals("Pepino", commit.getAuthorIdent().getName());
            assertEquals("me@pepino.dev", commit.getCommitterIdent().getEmailAddress());
        }
    }

    @Test
    public void commitRecordsADeletion() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "gone.txt", "1");
        GitOps.commit(app, "first", Collections.singletonList("gone.txt"), ME);
        assertTrue(new File(app, "gone.txt").delete());

        GitOps.commit(app, "remove", Collections.singletonList("gone.txt"), ME);

        assertEquals(Collections.emptyList(), GitOps.status(app));
        try (Git git = Git.open(app)) {
            assertEquals(2, countCommits(git));
        }
    }

    @Test
    public void commitRefusesNothingToCommit() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "a.txt", "a");
        GitOps.commit(app, "first", Collections.singletonList("a.txt"), ME);
        assertThrows(IllegalArgumentException.class, () -> GitOps.commit(app, "again", Collections.singletonList("a.txt"), ME));
        assertThrows(IllegalArgumentException.class, () -> GitOps.commit(app, "none", Collections.emptyList(), ME));
        write(app, "a.txt", "b");
        assertThrows(IllegalArgumentException.class, () -> GitOps.commit(app, "  ", Collections.singletonList("a.txt"), ME));
    }

    @Test
    public void identityIsStoredInTheAppsGitConfig() throws Exception {
        File config = new File(temp.getRoot(), "home/.gitconfig");
        assertNull(GitOps.identity(config));
        GitOps.setIdentity(config, new GitOps.Identity(" Ana ", "ana@example.com "));
        assertEquals(new GitOps.Identity("Ana", "ana@example.com"), GitOps.identity(config));
        assertThrows(IllegalArgumentException.class, () -> GitOps.setIdentity(config, new GitOps.Identity("", "x@y")));
    }

    private static String read(File folder, String path) throws Exception {
        return new String(Files.readAllBytes(new File(folder, path).toPath()), StandardCharsets.UTF_8);
    }

    /** A repository on main with a.txt ("main") committed. */
    private File repoWithACommit() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "a.txt", "main");
        GitOps.commit(app, "first", Collections.singletonList("a.txt"), ME);
        return app;
    }

    @Test
    public void anUnbornRepositoryHasJustItsCurrentBranchAndCannotBranchYet() throws Exception {
        File app = project("app");
        GitOps.init(app);
        assertEquals(Collections.singletonList(new GitOps.Branch("main", true)), GitOps.branches(app));
        assertThrows(IllegalStateException.class, () -> GitOps.createBranch(app, "feature"));
    }

    @Test
    public void createBranchSwitchesToItAndKeepsUncommittedChanges() throws Exception {
        File app = repoWithACommit();
        write(app, "a.txt", "work in progress");

        assertEquals(new GitOps.RepoInfo("feature", true), GitOps.createBranch(app, " feature "));

        assertEquals(
            Arrays.asList(new GitOps.Branch("feature", true), new GitOps.Branch("main", false)),
            GitOps.branches(app)
        );
        assertEquals("work in progress", read(app, "a.txt"));
        assertThrows(IllegalArgumentException.class, () -> GitOps.createBranch(app, "main"));
        assertThrows(IllegalArgumentException.class, () -> GitOps.createBranch(app, "bad name"));
        assertThrows(IllegalArgumentException.class, () -> GitOps.createBranch(app, ""));
    }

    @Test
    public void checkoutRewritesTheFilesAndReportsThem() throws Exception {
        File app = repoWithACommit();
        GitOps.createBranch(app, "feature");
        write(app, "a.txt", "feature");
        write(app, "b.txt", "only on feature");
        GitOps.commit(app, "feature work", Arrays.asList("a.txt", "b.txt"), ME);

        GitOps.Switched switched = GitOps.checkout(app, "main");

        assertEquals(new GitOps.RepoInfo("main", true), switched.info());
        assertEquals("main", read(app, "a.txt"));
        assertFalse(new File(app, "b.txt").exists());
        assertEquals(Collections.singletonList("a.txt"), switched.written());
        assertEquals(Collections.singletonList("b.txt"), switched.removed());
        assertEquals(Collections.emptyList(), GitOps.checkout(app, "main").written());
    }

    @Test
    public void checkoutCarriesChangesTheBranchesAgreeOn() throws Exception {
        File app = repoWithACommit();
        GitOps.createBranch(app, "feature");
        GitOps.checkout(app, "main");
        write(app, "a.txt", "uncommitted");

        GitOps.checkout(app, "feature");

        assertEquals("uncommitted", read(app, "a.txt"));
        assertEquals(changes("a.txt", "modified"), GitOps.status(app));
    }

    @Test
    public void checkoutRefusesToOverwriteUncommittedChanges() throws Exception {
        File app = repoWithACommit();
        GitOps.createBranch(app, "feature");
        write(app, "a.txt", "feature");
        GitOps.commit(app, "feature work", Collections.singletonList("a.txt"), ME);
        write(app, "a.txt", "uncommitted");

        GitOps.ConflictException conflict = assertThrows(GitOps.ConflictException.class, () -> GitOps.checkout(app, "main"));

        assertEquals(Collections.singletonList("a.txt"), conflict.paths);
        assertEquals("uncommitted", read(app, "a.txt"));
        assertEquals("feature", GitOps.info(app).branch());
        assertThrows(IllegalArgumentException.class, () -> GitOps.checkout(app, "missing"));
    }

    @Test
    public void deleteBranchNeedsForceForCommitsOnNoOtherBranch() throws Exception {
        File app = repoWithACommit();
        GitOps.createBranch(app, "merged");
        GitOps.checkout(app, "main");
        GitOps.deleteBranch(app, "merged", false);

        GitOps.createBranch(app, "work");
        write(app, "a.txt", "only on work");
        GitOps.commit(app, "work", Collections.singletonList("a.txt"), ME);
        assertThrows(IllegalArgumentException.class, () -> GitOps.deleteBranch(app, "work", false));
        GitOps.checkout(app, "main");
        assertThrows(GitOps.NotMergedBranchException.class, () -> GitOps.deleteBranch(app, "work", false));
        GitOps.deleteBranch(app, "work", true);

        assertEquals(Collections.singletonList(new GitOps.Branch("main", true)), GitOps.branches(app));
    }

    private static int countCommits(Git git) throws Exception {
        int count = 0;
        for (Object ignored : git.log().call()) count++;
        return count;
    }
}
