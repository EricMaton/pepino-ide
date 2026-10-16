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

    private static String line(GitOps.DiffLine line) {
        String mark = line.kind().equals("added") ? "+" : line.kind().equals("removed") ? "-" : " ";
        return mark + line.text();
    }

    private static List<String> lines(GitOps.Hunk hunk) {
        List<String> lines = new java.util.ArrayList<>();
        for (GitOps.DiffLine line : hunk.lines()) lines.add(line(line));
        return lines;
    }

    private static String numbered(int from, int to) {
        StringBuilder text = new StringBuilder();
        for (int i = from; i <= to; i++) text.append("line ").append(i).append('\n');
        return text.toString();
    }

    /** What the last commit holds for [path]. */
    private static String committed(File app, String path) throws Exception {
        try (Git git = Git.open(app)) {
            org.eclipse.jgit.lib.Repository repository = git.getRepository();
            try (org.eclipse.jgit.treewalk.TreeWalk walk = org.eclipse.jgit.treewalk.TreeWalk.forPath(
                repository, path, repository.resolve("HEAD^{tree}"))) {
                if (walk == null) return null;
                return new String(repository.open(walk.getObjectId(0)).getBytes(), StandardCharsets.UTF_8);
            }
        }
    }

    @Test
    public void diffShowsHunksWithThreeLinesOfContextAndBothLineNumbers() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "a.txt", numbered(1, 20));
        GitOps.commit(app, "first", Collections.singletonList("a.txt"), ME);
        write(app, "a.txt", numbered(1, 20).replace("line 2\n", "line two\n").replace("line 18\n", "").concat("line 21\n"));

        GitOps.FileDiff diff = GitOps.diff(app, "a.txt");

        assertFalse(diff.binary());
        assertEquals(2, diff.hunks().size());
        GitOps.Hunk first = diff.hunks().get(0);
        assertEquals(Arrays.asList(" line 1", "-line 2", "+line two", " line 3", " line 4", " line 5"), lines(first));
        assertEquals(Arrays.asList(1, 5, 1, 5), Arrays.asList(first.oldStart(), first.oldLines(), first.newStart(), first.newLines()));
        assertEquals(new GitOps.DiffLine("removed", "line 2", 2, 0, 0, false), first.lines().get(1));
        assertEquals(new GitOps.DiffLine("added", "line two", 0, 2, 1, false), first.lines().get(2));
        GitOps.Hunk second = diff.hunks().get(1);
        assertEquals(
            Arrays.asList(" line 15", " line 16", " line 17", "-line 18", " line 19", " line 20", "+line 21"),
            lines(second)
        );
        assertEquals(new GitOps.DiffLine("context", "line 19", 19, 18, -1, false), second.lines().get(4));
        assertEquals(2, second.lines().get(3).index());
        assertEquals(3, second.lines().get(6).index());
        assertEquals(diff.version(), GitOps.diff(app, "a.txt").version());
    }

    @Test
    public void diffOfNewDeletedBinaryAndMissingNewlineFiles() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "new.txt", "a\r\nb");
        GitOps.FileDiff created = GitOps.diff(app, "new.txt");
        assertEquals(Arrays.asList("+a", "+b"), lines(created.hunks().get(0)));
        assertEquals(Arrays.asList(0, 0, 1, 2), Arrays.asList(
            created.hunks().get(0).oldStart(), created.hunks().get(0).oldLines(),
            created.hunks().get(0).newStart(), created.hunks().get(0).newLines()));
        assertTrue(created.hunks().get(0).lines().get(1).noNewline());

        Files.write(new File(app, "logo.png").toPath(), new byte[] {(byte) 0x89, 'P', 'N', 'G', 0, 0, 1});
        GitOps.commit(app, "first", Arrays.asList("new.txt", "logo.png"), ME);
        assertTrue(new File(app, "new.txt").delete());
        write(app, "logo.png", "\0changed");

        assertEquals(Arrays.asList("-a", "-b"), lines(GitOps.diff(app, "new.txt").hunks().get(0)));
        GitOps.FileDiff binary = GitOps.diff(app, "logo.png");
        assertTrue(binary.binary());
        assertEquals(Collections.emptyList(), binary.hunks());
        assertThrows(IllegalArgumentException.class, () -> GitOps.diff(app, "../outside.txt"));
    }

    @Test
    public void aLastLineThatGainsALineBreakIsNotChangedAndTheLineBreakIsAChangeOfItsOwn() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "main.py", "hello world;");
        GitOps.commit(app, "first", Collections.singletonList("main.py"), ME);

        // Only a line added after it: "hello world;" is context, not removed and added again.
        write(app, "main.py", "hello world;\nhola mundo;");
        GitOps.Hunk hunk = GitOps.diff(app, "main.py").hunks().get(0);
        assertEquals(Arrays.asList(" hello world;", "+hola mundo;"), lines(hunk));
        assertEquals(new GitOps.DiffLine("context", "hello world;", 1, 1, -1, false), hunk.lines().get(0));
        assertTrue(hunk.lines().get(1).noNewline());

        // And the file now ending with a line break: one more change, after the lines.
        write(app, "main.py", "hello world;\nhola mundo;\n");
        GitOps.FileDiff diff = GitOps.diff(app, "main.py");
        assertEquals(Arrays.asList(" hello world;", "+hola mundo;", "+"), lines(diff.hunks().get(0)));
        assertEquals(new GitOps.DiffLine("added", "", 0, 0, 1, false, true), diff.hunks().get(0).lines().get(2));
        java.util.Map<String, GitOps.LineExclusion> excluded = Collections.singletonMap(
            "main.py", new GitOps.LineExclusion(diff.version(), new java.util.HashSet<>(Collections.singletonList(1))));
        GitOps.commit(app, "the line", Collections.singletonList("main.py"), excluded, ME);
        assertEquals("hello world;\nhola mundo;", committed(app, "main.py"));

        // Only the final line break left: the lines are context around it.
        assertEquals(Arrays.asList(" hello world;", " hola mundo;", "+"), lines(GitOps.diff(app, "main.py").hunks().get(0)));
        GitOps.commit(app, "the break", Collections.singletonList("main.py"), ME);

        // Removing the last line and the final line break; the line kept, the break goes.
        write(app, "main.py", "hello world;");
        diff = GitOps.diff(app, "main.py");
        assertEquals(Arrays.asList(" hello world;", "-hola mundo;", "-"), lines(diff.hunks().get(0)));
        excluded = Collections.singletonMap(
            "main.py", new GitOps.LineExclusion(diff.version(), new java.util.HashSet<>(Collections.singletonList(0))));
        GitOps.commit(app, "no break", Collections.singletonList("main.py"), excluded, ME);
        assertEquals("hello world;\nhola mundo;", committed(app, "main.py"));
    }

    @Test
    public void commitLeavesOutTheExcludedLines() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "a.txt", "one\ntwo\nthree\n");
        GitOps.commit(app, "first", Collections.singletonList("a.txt"), ME);
        write(app, "a.txt", "one\n2\nthree\nfour\n");
        GitOps.FileDiff diff = GitOps.diff(app, "a.txt");
        // 0: -two, 1: +2, 2: +four; keep "two" and leave "four" out
        java.util.Map<String, GitOps.LineExclusion> excluded = Collections.singletonMap(
            "a.txt", new GitOps.LineExclusion(diff.version(), new java.util.HashSet<>(Arrays.asList(0, 2))));

        GitOps.commit(app, "two ways", Collections.singletonList("a.txt"), excluded, ME);

        assertEquals("one\ntwo\n2\nthree\n", committed(app, "a.txt"));
        assertEquals("one\n2\nthree\nfour\n", read(app, "a.txt"));
        assertEquals(changes("a.txt", "modified"), GitOps.status(app));
    }

    @Test
    public void commitOfSomeLinesOfANewFileAndOfNoneOfThem() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "keep.txt", "k\n");
        write(app, "new.txt", "a\nb\nc");
        String version = GitOps.diff(app, "new.txt").version();
        java.util.Map<String, GitOps.LineExclusion> excluded = new java.util.HashMap<>();
        excluded.put("new.txt", new GitOps.LineExclusion(version, new java.util.HashSet<>(Collections.singletonList(1))));

        GitOps.commit(app, "first", Arrays.asList("keep.txt", "new.txt"), excluded, ME);
        assertEquals("a\nc", committed(app, "new.txt"));

        write(app, "keep.txt", "k2\n");
        write(app, "new.txt", "a\nb\nc\nd\n");
        GitOps.FileDiff diff = GitOps.diff(app, "new.txt");
        excluded.put("new.txt", new GitOps.LineExclusion(diff.version(), new java.util.HashSet<>(Arrays.asList(0, 1, 2, 3))));
        GitOps.commit(app, "keep only", Arrays.asList("keep.txt", "new.txt"), excluded, ME);
        assertEquals("a\nc", committed(app, "new.txt"));
        assertEquals("k2\n", committed(app, "keep.txt"));
    }

    @Test
    public void commitRefusesLinesPickedOnAnOlderVersionAndCommitsNothing() throws Exception {
        File app = repoWithACommit();
        write(app, "a.txt", "picked\n");
        String version = GitOps.diff(app, "a.txt").version();
        write(app, "a.txt", "changed again\n");
        java.util.Map<String, GitOps.LineExclusion> excluded = Collections.singletonMap(
            "a.txt", new GitOps.LineExclusion(version, new java.util.HashSet<>(Collections.singletonList(0))));

        GitOps.StaleSelectionException stale = assertThrows(GitOps.StaleSelectionException.class,
            () -> GitOps.commit(app, "late", Collections.singletonList("a.txt"), excluded, ME));

        assertEquals(Collections.singletonList("a.txt"), stale.paths);
        assertEquals("main", committed(app, "a.txt"));
    }

    @Test
    public void logListsTheCommitsNewestFirstInPages() throws Exception {
        File app = project("app");
        GitOps.init(app);
        assertEquals(Collections.emptyList(), GitOps.log(app, 0, 50));
        write(app, "a.txt", "1");
        GitOps.commit(app, "First", Collections.singletonList("a.txt"), ME);
        write(app, "a.txt", "2");
        GitOps.commit(app, "Second\n\nWhy it changed.\nIn two lines.", Collections.singletonList("a.txt"), ME);
        write(app, "a.txt", "3");
        GitOps.commit(app, "Third", Collections.singletonList("a.txt"), ME);

        List<GitOps.LogEntry> log = GitOps.log(app, 0, 50);

        assertEquals(3, log.size());
        assertEquals("Third", log.get(0).summary());
        GitOps.LogEntry second = log.get(1);
        assertEquals("Second", second.summary());
        assertEquals("Why it changed.\nIn two lines.", second.description());
        assertEquals("", log.get(2).description());
        assertEquals("Pepino", second.author());
        assertEquals("me@pepino.dev", second.email());
        assertEquals(40, second.id().length());
        assertTrue(Math.abs(System.currentTimeMillis() - second.time()) < 60_000);

        List<GitOps.LogEntry> page = GitOps.log(app, 1, 1);
        assertEquals(1, page.size());
        assertEquals(second.id(), page.get(0).id());
        assertEquals(Collections.emptyList(), GitOps.log(app, 3, 50));
    }

    @Test
    public void commitChangesAndDiffAreAgainstTheFirstParent() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "keep.txt", "one\ntwo\n");
        write(app, "gone.txt", "bye\n");
        GitOps.commit(app, "First", Arrays.asList("keep.txt", "gone.txt"), ME);
        write(app, "keep.txt", "one\n2\n");
        assertTrue(new File(app, "gone.txt").delete());
        write(app, "src/new.txt", "hi\n");
        GitOps.commit(app, "Second", Arrays.asList("keep.txt", "gone.txt", "src/new.txt"), ME);
        List<GitOps.LogEntry> log = GitOps.log(app, 0, 50);
        String second = log.get(0).id();
        String first = log.get(1).id();

        assertEquals(changes("gone.txt", "new", "keep.txt", "new"), GitOps.commitChanges(app, first));
        assertEquals(
            changes("gone.txt", "deleted", "keep.txt", "modified", "src/new.txt", "new"),
            GitOps.commitChanges(app, second)
        );
        // a short id works too
        assertEquals(3, GitOps.commitChanges(app, second.substring(0, 7)).size());

        List<GitOps.DiffLine> lines = GitOps.commitDiff(app, second, "keep.txt").hunks().get(0).lines();
        assertEquals("one", lines.get(0).text());
        assertEquals("context", lines.get(0).kind());
        assertEquals("two", lines.get(1).text());
        assertEquals("removed", lines.get(1).kind());
        assertEquals("2", lines.get(2).text());
        assertEquals("added", lines.get(2).kind());
        GitOps.FileDiff gone = GitOps.commitDiff(app, second, "gone.txt");
        assertEquals("removed", gone.hunks().get(0).lines().get(0).kind());
        GitOps.FileDiff created = GitOps.commitDiff(app, first, "keep.txt");
        assertEquals(2, created.hunks().get(0).lines().size());
        assertEquals("added", created.hunks().get(0).lines().get(1).kind());

        assertThrows(IllegalArgumentException.class, () -> GitOps.commitChanges(app, "0000000000"));
    }

    @Test
    public void snapshotRecordsTheWorkingTreeWithoutTouchingTheRepository() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "a.txt", "committed\n");
        GitOps.commit(app, "First", Collections.singletonList("a.txt"), ME);
        write(app, "a.txt", "edited\n");
        write(app, "src/new.ts", "untracked\n");
        write(app, ".gitignore", "build/\n");
        write(app, "build/out.js", "ignored\n");
        write(app, "node_modules/dep/index.js", "skipped\n");
        write(app, ".pepino/snapshots/x@1.snap", "pepino's own\n");
        List<GitOps.FileChange> before = GitOps.status(app);

        String id = GitOps.snapshot(app, "Before editing a.txt");

        assertEquals("edited\n", GitOps.snapshotFile(app, id, "a.txt"));
        assertEquals("untracked\n", GitOps.snapshotFile(app, id, "src/new.ts"));
        assertNull(GitOps.snapshotFile(app, id, "build/out.js"));
        assertNull(GitOps.snapshotFile(app, id, "node_modules/dep/index.js"));
        assertNull(GitOps.snapshotFile(app, id, ".pepino/snapshots/x@1.snap"));
        // History, branches, the index and the files are as they were
        assertEquals(before, GitOps.status(app));
        assertEquals(1, GitOps.log(app, 0, 50).size());
        assertEquals(1, GitOps.branches(app).size());
        assertEquals("edited\n", new String(Files.readAllBytes(new File(app, "a.txt").toPath()), StandardCharsets.UTF_8));
        // nothing changed since: the same snapshot
        assertEquals(id, GitOps.snapshot(app, "Again"));
    }

    @Test
    public void snapshotVersionsListEachVersionOfAFileOnce() throws Exception {
        File app = project("app");
        GitOps.init(app);
        write(app, "a.txt", "v1\n");
        String first = GitOps.snapshot(app, "one");
        write(app, "b.txt", "other\n");
        GitOps.snapshot(app, "b changed, a did not");
        write(app, "a.txt", "v2\n");
        String third = GitOps.snapshot(app, "three");

        List<GitOps.SnapshotVersion> versions = GitOps.snapshotVersions(app, "a.txt", 50);

        assertEquals(2, versions.size());
        assertEquals(third, versions.get(0).id());
        assertEquals("three", versions.get(0).reason());
        assertEquals("b changed, a did not", versions.get(1).reason());
        assertEquals("v1\n", GitOps.snapshotFile(app, versions.get(1).id(), "a.txt"));
        assertEquals("v1\n", GitOps.snapshotFile(app, first, "a.txt"));
        assertEquals(Collections.emptyList(), GitOps.snapshotVersions(app, "missing.txt", 50));
        assertEquals(1, GitOps.snapshotVersions(app, "a.txt", 1).size());
    }

    @Test
    public void checkoutTakesASnapshotFirst() throws Exception {
        File app = repoWithACommit();
        GitOps.createBranch(app, "feature");
        write(app, "notes.txt", "uncommitted\n");

        GitOps.checkout(app, "main");

        List<GitOps.SnapshotVersion> versions = GitOps.snapshotVersions(app, "notes.txt", 50);
        assertEquals(1, versions.size());
        assertEquals("Before switching to main", versions.get(0).reason());
    }

    /** Sprint 3, criterion 1: edit → pick what goes in → commit → see it in History, end to end. */
    @Test
    public void theWholeFlowFromAnEditToHistory() throws Exception {
        File app = project("app");
        GitOps.init(app);
        StringBuilder lines = new StringBuilder();
        for (int i = 1; i <= 20; i++) lines.append("line ").append(i).append('\n');
        write(app, "a.txt", lines.toString());
        GitOps.commit(app, "First", Collections.singletonList("a.txt"), ME);

        // Two edits far apart (two hunks), and a new file
        write(app, "a.txt", lines.toString().replace("line 2\n", "line two\n").replace("line 18\n", "line eighteen\n"));
        write(app, "notes.txt", "todo\n");
        assertEquals(changes("a.txt", "modified", "notes.txt", "new"), GitOps.status(app));
        GitOps.FileDiff diff = GitOps.diff(app, "a.txt");
        assertEquals(2, diff.hunks().size());

        // Commit only a.txt, and of it only the first hunk
        java.util.Set<Integer> secondHunk = new java.util.HashSet<>();
        for (GitOps.DiffLine line : diff.hunks().get(1).lines()) if (line.index() >= 0) secondHunk.add(line.index());
        GitOps.CommitResult result = GitOps.commit(
            app,
            "Rename line two\n\nOnly the first change.",
            Collections.singletonList("a.txt"),
            Collections.singletonMap("a.txt", new GitOps.LineExclusion(diff.version(), secondHunk)),
            ME
        );

        // History has it, with what it changed
        List<GitOps.LogEntry> log = GitOps.log(app, 0, 50);
        assertEquals(2, log.size());
        GitOps.LogEntry last = log.get(0);
        assertTrue(last.id().startsWith(result.id()));
        assertEquals("Rename line two", last.summary());
        assertEquals("Only the first change.", last.description());
        assertEquals("Pepino", last.author());
        assertEquals(changes("a.txt", "modified"), GitOps.commitChanges(app, last.id()));
        List<GitOps.Hunk> committed = GitOps.commitDiff(app, last.id(), "a.txt").hunks();
        assertEquals(1, committed.size());
        assertTrue(committed.get(0).lines().stream().anyMatch(line -> line.text().equals("line two")));
        assertTrue(committed.get(0).lines().stream().noneMatch(line -> line.text().equals("line eighteen")));

        // What was left out is still a change, the new file untouched
        assertEquals(changes("a.txt", "modified", "notes.txt", "new"), GitOps.status(app));
        assertEquals(1, GitOps.diff(app, "a.txt").hunks().size());
        assertTrue(GitOps.diff(app, "a.txt").hunks().get(0).lines().stream().anyMatch(line -> line.text().equals("line eighteen")));
    }

    @Test
    public void locksLeftByAKilledAppDoNotBlockTheNextOperations() throws Exception {
        File app = repoWithACommit();
        GitOps.createBranch(app, "feature");
        GitOps.checkout(app, "main");
        // What JGit leaves behind when the process dies mid-write.
        File git = new File(app, ".git");
        for (String lock : new String[] {"index.lock", "HEAD.lock", "refs/heads/main.lock", "refs/heads/feature.lock"}) {
            write(git, lock, "half written");
        }
        write(app, "a.txt", "after the crash");

        GitOps.commit(app, "after the crash", Collections.singletonList("a.txt"), ME);
        GitOps.checkout(app, "feature");
        GitOps.checkout(app, "main");
        GitOps.snapshot(app, "after the crash");

        assertEquals("after the crash", GitOps.log(app, 0, 1).get(0).summary());
        for (String lock : new String[] {"index.lock", "HEAD.lock", "refs/heads/main.lock", "refs/heads/feature.lock"}) {
            assertFalse(lock, new File(git, lock).exists());
        }
    }

    private static int countCommits(Git git) throws Exception {
        int count = 0;
        for (Object ignored : git.log().call()) count++;
        return count;
    }
}
