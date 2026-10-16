package dev.pepino.ide.git;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The git operations on a real Android runtime (#28): JGit 6 needs Java 11
 * APIs that only core library desugaring brings to minSdk 26 (ADR-006), which
 * JUnit on the JVM cannot show. Run on an emulator or a device with
 * `./gradlew connectedDebugAndroidTest` (set ANDROID_SERIAL to pick one).
 */
@RunWith(AndroidJUnit4.class)
public class GitOpsDeviceTest {

    private static final GitOps.Identity ME = new GitOps.Identity("Pepino", "me@pepino.dev");

    private File space;

    @Before
    public void setUp() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        // As MainActivity does: JGit's home is the app's own files folder.
        System.setProperty("user.home", context.getFilesDir().getAbsolutePath());
        space = new File(context.getCacheDir(), "git-device-test");
        delete(space);
        assertTrue(space.mkdirs());
    }

    @After
    public void tearDown() {
        delete(space);
    }

    private static void delete(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) delete(child);
        file.delete();
    }

    private static void write(File folder, String path, String text) throws Exception {
        File file = new File(folder, path);
        file.getParentFile().mkdirs();
        Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    public void theCoreOperationsWorkOnAndroid() throws Exception {
        File app = new File(space, "app");
        assertTrue(app.mkdirs());
        assertEquals(new GitOps.RepoInfo("main", false), GitOps.init(app));

        write(app, "a.txt", "one\ntwo\n");
        write(app, "src/b.ts", "export {};\n");
        assertEquals(2, GitOps.status(app).size());
        GitOps.commit(app, "First", Arrays.asList("a.txt", "src/b.ts"), ME);

        write(app, "a.txt", "one\n2\n");
        assertEquals(1, GitOps.diff(app, "a.txt").hunks().size());
        GitOps.snapshot(app, "Before editing a.txt");
        GitOps.commit(app, "Second", Collections.singletonList("a.txt"), ME);

        List<GitOps.LogEntry> log = GitOps.log(app, 0, 50);
        assertEquals(2, log.size());
        assertEquals("Second", log.get(0).summary());
        assertEquals(1, GitOps.commitChanges(app, log.get(0).id()).size());
        assertEquals(1, GitOps.commitDiff(app, log.get(0).id(), "a.txt").hunks().size());

        GitOps.createBranch(app, "feature");
        write(app, "a.txt", "feature\n");
        GitOps.commit(app, "On feature", Collections.singletonList("a.txt"), ME);
        GitOps.Switched switched = GitOps.checkout(app, "main");
        assertEquals("main", switched.info().branch());
        assertEquals("one\n2\n", new String(Files.readAllBytes(new File(app, "a.txt").toPath()), StandardCharsets.UTF_8));
        GitOps.deleteBranch(app, "feature", true);
        assertEquals(1, GitOps.branches(app).size());

        List<GitOps.SnapshotVersion> versions = GitOps.snapshotVersions(app, "a.txt", 50);
        assertFalse(versions.isEmpty());
        assertEquals("one\n2\n", GitOps.snapshotFile(app, versions.get(versions.size() - 1).id(), "a.txt"));
    }

    @Test
    public void identityLivesInTheAppsOwnGitConfig() throws Exception {
        File config = new File(space, ".gitconfig");
        GitOps.setIdentity(config, ME);
        assertEquals(ME, GitOps.identity(config));
    }
}
