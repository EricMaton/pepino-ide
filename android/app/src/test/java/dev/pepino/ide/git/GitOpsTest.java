package dev.pepino.ide.git;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.PersonIdent;
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

    private static int countCommits(Git git) throws Exception {
        int count = 0;
        for (Object ignored : git.log().call()) count++;
        return count;
    }
}
