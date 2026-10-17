package dev.pepino.ide.cli;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The terminal's git (#41): git's commands and output, on JGit. */
public class GitCliTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    private File repo;
    private String out;
    private String err;

    private int git(String... args) throws Exception {
        return gitIn(repo, args);
    }

    private int gitIn(File cwd, String... args) throws Exception {
        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        ByteArrayOutputStream stderr = new ByteArrayOutputStream();
        int code = new GitCli(
            cwd,
            new PrintStream(stdout, true, "UTF-8"),
            new PrintStream(stderr, true, "UTF-8"),
            false
        ).run(args);
        // println's line break is the platform's: \r\n where the tests run on Windows, \n on Android
        out = stdout.toString("UTF-8").replace("\r\n", "\n");
        err = stderr.toString("UTF-8").replace("\r\n", "\n");
        return code;
    }

    private void write(String name, String text) throws Exception {
        File file = new File(repo, name);
        file.getParentFile().mkdirs();
        Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    @Before
    public void setUp() throws Exception {
        File home = temp.newFolder("home");
        System.setProperty("user.home", home.getAbsolutePath());
        Files.write(
            new File(home, ".gitconfig").toPath(),
            "[user]\n\tname = Pepino\n\temail = me@pepino.dev\n".getBytes(StandardCharsets.UTF_8)
        );
        repo = temp.newFolder("repo");
    }

    @Test
    public void initAddCommitAndLogAsGitSaysThem() throws Exception {
        assertEquals(128, git("status"));
        assertTrue(err, err.startsWith("fatal: not a git repository"));

        assertEquals(0, git("init"));
        assertTrue(out, out.startsWith("Initialized empty Git repository in "));
        // The repository's own identity: on Windows JGit reads %HOME%'s config, not user.home's
        Files.write(
            new File(repo, ".git/config").toPath(),
            "\n[user]\n\tname = Pepino\n\temail = me@pepino.dev\n".getBytes(StandardCharsets.UTF_8),
            java.nio.file.StandardOpenOption.APPEND
        );
        write("a.txt", "one\n");
        write("src/b.txt", "bee\n");

        git("status");
        assertTrue(out, out.contains("On branch main"));
        assertTrue(out, out.contains("No commits yet"));
        assertTrue(out, out.contains("Untracked files:\n\ta.txt\n\tsrc/b.txt"));

        assertEquals(0, git("add", "."));
        git("status", "-s");
        assertEquals("A  a.txt\nA  src/b.txt\n", out);

        assertEquals(0, git("commit", "-m", "First"));
        assertTrue(out, out.matches("\\[main [0-9a-f]{7}] First\\n"));
        git("status");
        assertTrue(out, out.contains("nothing to commit, working tree clean"));

        write("a.txt", "two\n");
        assertEquals(0, git("commit", "-am", "Second"));
        git("log", "--oneline");
        assertTrue(out, out.matches("[0-9a-f]{7} Second\\n[0-9a-f]{7} First\\n"));
        git("log", "-1");
        assertTrue(out, out.startsWith("commit "));
        assertTrue(out, out.contains("Author: Pepino <me@pepino.dev>"));
        assertTrue(out, out.contains("\n    Second\n"));

        assertEquals(1, git("commit", "-m", "Nothing"));
        assertTrue(out, out.contains("nothing to commit"));
        assertEquals(1, git("commit"));
        assertTrue(err, err.contains("-m"));
    }

    @Test
    public void diffShowsUnstagedAndStagedChanges() throws Exception {
        git("init");
        write("a.txt", "one\ntwo\n");
        git("add", "a.txt");
        git("commit", "-m", "First");
        write("a.txt", "one\nTWO\n");

        git("diff");
        assertTrue(out, out.contains("diff --git a/a.txt b/a.txt"));
        assertTrue(out, out.contains("-two\n+TWO\n"));

        git("add", "a.txt");
        git("diff");
        assertEquals("", out);
        git("diff", "--staged");
        assertTrue(out, out.contains("+TWO"));

        git("restore", "--staged", "a.txt");
        git("status", "-s");
        assertEquals(" M a.txt\n", out);
        git("restore", "a.txt");
        git("status", "-s");
        assertEquals("", out);
    }

    @Test
    public void branchesSwitchingStashAndReset() throws Exception {
        git("init");
        write("a.txt", "one\n");
        git("add", "-A");
        git("commit", "-m", "First");

        assertEquals(0, git("switch", "-c", "feature"));
        assertEquals("Switched to a new branch 'feature'\n", out);
        git("branch");
        assertEquals("* feature\n  main\n", out);

        write("a.txt", "on feature\n");
        git("stash");
        assertTrue(out, out.startsWith("Saved working directory"));
        assertEquals("one\n", new String(Files.readAllBytes(new File(repo, "a.txt").toPath()), StandardCharsets.UTF_8));
        git("stash", "list");
        assertTrue(out, out.startsWith("stash@{0}: "));
        git("stash", "pop");
        assertEquals("on feature\n", new String(Files.readAllBytes(new File(repo, "a.txt").toPath()), StandardCharsets.UTF_8));

        git("reset", "--hard");
        assertTrue(out, out.startsWith("HEAD is now at "));
        assertEquals(0, git("checkout", "main"));
        assertEquals(0, git("branch", "-d", "feature"));
        assertEquals("Deleted branch feature.\n", out);

        // From a subfolder, paths are the folder's
        write("src/b.txt", "bee\n");
        assertEquals(0, gitIn(new File(repo, "src"), "add", "b.txt"));
        git("status", "-s");
        assertEquals("A  src/b.txt\n", out);
        assertEquals(0, git("rm", "--cached", "src/b.txt"));
        git("status", "-s");
        assertEquals("?? src/b.txt\n", out);
    }

    @Test
    public void pushAndUnknownCommandsSayWhatToDo() throws Exception {
        git("init");
        assertEquals(1, git("push"));
        assertTrue(err, err.contains("GIT tab"));
        assertEquals(1, git("rebase", "main"));
        assertTrue(err, err.contains("'rebase' is not a command"));
        assertEquals(0, git("help"));
        assertTrue(out, out.startsWith("usage: git"));
        assertEquals(1, git());
        assertFalse(out.isEmpty());
    }
}
