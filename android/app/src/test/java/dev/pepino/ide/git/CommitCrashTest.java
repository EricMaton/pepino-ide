package dev.pepino.ide.git;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.Constants;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.revwalk.RevWalk;
import org.eclipse.jgit.treewalk.TreeWalk;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Sprint 3, criterion 3: nothing is lost when the app dies in the middle of
 * a commit (#28). The app is a second JVM that commits (and snapshots) in a
 * loop; it is killed outright at random moments, and after each kill the
 * repository must hold every commit it had, read whole, and take the next one.
 */
public class CommitCrashTest {

    private static final GitOps.Identity ME = new GitOps.Identity("Pepino", "me@pepino.dev");

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    /** The app: commits in a loop until it is killed. Says "committing" once its first commit is in. */
    public static void main(String[] args) throws Exception {
        File app = new File(args[0]);
        System.setProperty("user.home", args[1]);
        // Each run writes what no earlier run did, so there is always something to commit.
        String run = args[2];
        for (int i = 0; ; i++) {
            write(app, "a.txt", "run " + run + ", line " + i + "\n");
            write(app, "src/b" + (i % 3) + ".txt", "run " + run + ", b " + i + "\n");
            GitOps.commit(app, "commit " + run + "." + i, Arrays.asList("a.txt", "src/b" + (i % 3) + ".txt"), ME);
            if (i % 4 == 0) GitOps.snapshot(app, "snapshot " + run + "." + i);
            if (i == 0) {
                System.out.println("committing");
                System.out.flush();
            }
        }
    }

    private static void write(File folder, String path, String text) throws Exception {
        File file = new File(folder, path);
        file.getParentFile().mkdirs();
        Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    public void killingTheAppMidCommitNeverLosesOrBreaksTheRepository() throws Exception {
        File app = temp.newFolder("projects", "app");
        File home = temp.newFolder("home");
        System.setProperty("user.home", home.getAbsolutePath());
        GitOps.init(app);
        Random random = new Random(28);
        Set<String> seen = new HashSet<>();

        for (int round = 0; round < 8; round++) {
            Process child = new ProcessBuilder(
                new File(System.getProperty("java.home"), "bin/java").getPath(),
                "-cp",
                System.getProperty("java.class.path"),
                CommitCrashTest.class.getName(),
                app.getAbsolutePath(),
                home.getAbsolutePath(),
                String.valueOf(round)
            ).redirectErrorStream(true).start();
            BufferedReader output = new BufferedReader(new InputStreamReader(child.getInputStream(), StandardCharsets.UTF_8));
            // (JGit's logging may say something first)
            StringBuilder said = new StringBuilder();
            for (String line; !"committing".equals(line = output.readLine()); said.append(line).append('\n')) {
                if (line == null) throw new AssertionError("The app stopped before committing:\n" + said);
            }
            Thread.sleep(random.nextInt(400));
            if (!child.isAlive()) {
                StringBuilder why = new StringBuilder();
                for (String line; (line = output.readLine()) != null; ) why.append(line).append('\n');
                throw new AssertionError("The app stopped before it was killed:\n" + why);
            }
            child.destroyForcibly();
            assertTrue(child.waitFor(30, TimeUnit.SECONDS));

            List<GitOps.LogEntry> log = GitOps.log(app, 0, Integer.MAX_VALUE);
            Set<String> now = new HashSet<>();
            for (GitOps.LogEntry entry : log) now.add(entry.id());
            assertTrue("a commit made before the kill is gone", now.containsAll(seen));
            readEverything(app);
            GitOps.status(app);
            // and the next commit goes through
            write(app, "after.txt", "after kill " + round + "\n");
            GitOps.commit(app, "after kill " + round, Collections.singletonList("after.txt"), ME);
            seen.addAll(now);
            seen.add(GitOps.log(app, 0, 1).get(0).id());
        }
        assertTrue("the app never got to commit", seen.size() >= 16);
    }

    /** Every commit and snapshot, and every file in them: nothing missing or broken. */
    private static void readEverything(File app) throws Exception {
        try (Git git = Git.open(app); RevWalk walk = new RevWalk(git.getRepository())) {
            Repository repository = git.getRepository();
            for (String ref : new String[] {Constants.HEAD, GitOps.SNAPSHOTS_REF}) {
                ObjectId start = repository.resolve(ref);
                if (start != null) walk.markStart(walk.parseCommit(start));
            }
            for (RevCommit commit : walk) {
                try (TreeWalk files = new TreeWalk(repository)) {
                    files.addTree(commit.getTree());
                    files.setRecursive(true);
                    while (files.next()) repository.open(files.getObjectId(0)).getBytes();
                }
            }
        }
    }
}
