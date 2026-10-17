package dev.pepino.ide.git;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Discarding changes (#138): whole files, every file, or some lines, always snapshotted first. */
public class GitDiscardTest {

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

    /** The diff's changed lines of [path], by their text ("+two", "-one"). */
    private Map<String, Integer> lines(String path) throws Exception {
        Map<String, Integer> found = new java.util.TreeMap<>();
        for (GitOps.Hunk hunk : GitOps.diff(repo, path).hunks()) {
            for (GitOps.DiffLine line : hunk.lines()) {
                if (line.index() >= 0) found.put(("added".equals(line.kind()) ? "+" : "-") + line.text(), line.index());
            }
        }
        return found;
    }

    @Before
    public void setUp() throws Exception {
        System.setProperty("user.home", temp.newFolder("home").getAbsolutePath());
        repo = new File(temp.newFolder("projects"), "repo");
        assertTrue(repo.mkdirs());
        GitOps.init(repo);
        write("a.txt", "one\ntwo\nthree\n");
        write("gone.txt", "bye\n");
        write("src/b.txt", "bee\n");
        GitOps.commit(repo, "First", List.of("a.txt", "gone.txt", "src/b.txt"), ME);
    }

    @Test
    public void wholeFilesGoBackToTheLastCommitAndNewOnesAreDeleted() throws Exception {
        write("a.txt", "one\nTWO\nthree\n");
        assertTrue(new File(repo, "gone.txt").delete());
        write("new.txt", "fresh\n");
        assertEquals(List.of("a.txt:modified", "gone.txt:deleted", "new.txt:new"), changed());

        GitOps.Discarded discarded = GitOps.discard(repo, List.of("a.txt", "gone.txt", "new.txt"), Collections.emptyMap());

        assertEquals(List.of(), changed());
        assertEquals("one\ntwo\nthree\n", read("a.txt"));
        assertEquals("bye\n", read("gone.txt"));
        assertFalse(new File(repo, "new.txt").exists());
        assertEquals(List.of("a.txt", "gone.txt"), discarded.written());
        assertEquals(List.of("new.txt"), discarded.removed());
    }

    @Test
    public void onlyTheChosenFilesAreDiscarded() throws Exception {
        write("a.txt", "one\nTWO\nthree\n");
        write("src/b.txt", "bee\nbuzz\n");

        GitOps.discard(repo, List.of("src/b.txt"), Collections.emptyMap());

        assertEquals(List.of("a.txt:modified"), changed());
        assertEquals("bee\n", read("src/b.txt"));
    }

    @Test
    public void whatWasDiscardedStaysInTheSnapshots() throws Exception {
        write("a.txt", "one\nmine\nthree\n");
        GitOps.discard(repo, List.of("a.txt"), Collections.emptyMap());

        List<GitOps.SnapshotVersion> versions = GitOps.snapshotVersions(repo, "a.txt", 10);
        assertTrue(versions.get(0).reason().startsWith("Before discarding changes to a.txt"));
        assertEquals("one\nmine\nthree\n", GitOps.snapshotFile(repo, versions.get(0).id(), "a.txt"));
    }

    @Test
    public void someLinesGoBackAndTheOtherChangesStay() throws Exception {
        write("a.txt", "one\nTWO\nthree\nfour\n");
        Map<String, Integer> found = lines("a.txt");
        String version = GitOps.diff(repo, "a.txt").version();

        // Discard "four" (added) only: TWO stays
        GitOps.discard(repo, List.of("a.txt"), Map.of("a.txt", new GitOps.LineExclusion(version, Set.of(found.get("+four")))));
        assertEquals("one\nTWO\nthree\n", read("a.txt"));

        // Discard the change of the second line: back to the commit
        found = lines("a.txt");
        version = GitOps.diff(repo, "a.txt").version();
        GitOps.discard(
            repo,
            List.of("a.txt"),
            Map.of("a.txt", new GitOps.LineExclusion(version, Set.of(found.get("-two"), found.get("+TWO"))))
        );
        assertEquals("one\ntwo\nthree\n", read("a.txt"));
        assertEquals(List.of(), changed());
    }

    @Test
    public void linesPickedOnAnOlderVersionDiscardNothing() throws Exception {
        write("a.txt", "one\nTWO\nthree\n");
        String version = GitOps.diff(repo, "a.txt").version();
        write("a.txt", "one\nTWO\nthree\nmore\n");

        GitOps.StaleSelectionException error = assertThrows(
            GitOps.StaleSelectionException.class,
            () -> GitOps.discard(repo, List.of("a.txt"), Map.of("a.txt", new GitOps.LineExclusion(version, Set.of(0))))
        );
        assertEquals(List.of("a.txt"), error.paths);
        assertEquals("one\nTWO\nthree\nmore\n", read("a.txt"));
    }

    @Test
    public void crlfFilesKeepTheirLineEndings() throws Exception {
        write(".gitattributes", "*.bat text eol=crlf\n");
        write("run.bat", "@rem one\r\n@rem two\r\n");
        GitOps.commit(repo, "Bat", List.of(".gitattributes", "run.bat"), ME);
        write("run.bat", "@rem one\r\n@rem TWO\r\n@rem three\r\n");
        Map<String, Integer> found = lines("run.bat");
        String version = GitOps.diff(repo, "run.bat").version();

        GitOps.discard(repo, List.of("run.bat"), Map.of("run.bat", new GitOps.LineExclusion(version, Set.of(found.get("+@rem three")))));

        assertEquals("@rem one\r\n@rem TWO\r\n", read("run.bat"));
        GitOps.discard(repo, List.of("run.bat"), Collections.emptyMap());
        assertEquals("@rem one\r\n@rem two\r\n", read("run.bat"));
        assertEquals(List.of(), changed());
    }
}
