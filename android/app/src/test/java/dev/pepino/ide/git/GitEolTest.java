package dev.pepino.ide.git;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.lib.StoredConfig;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Line endings from .gitattributes (`*.bat text eol=crlf`): CRLF on disk, LF
 * in git. Found on the phone switching pepino-ide to an old branch without
 * that rule: its gradlew.bat came out CRLF and showed as changed.
 */
public class GitEolTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    private File repo;

    private static void write(File folder, String name, String text) throws Exception {
        Files.write(new File(folder, name).toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    private String bytesOf(String name) throws Exception {
        return new String(Files.readAllBytes(new File(repo, name).toPath()), StandardCharsets.UTF_8);
    }

    @Before
    public void setUp() throws Exception {
        System.setProperty("user.home", temp.newFolder("home").getAbsolutePath());
        File remote = temp.newFolder("origin");
        PersonIdent me = new PersonIdent("Pepino", "test@pepino.dev");
        try (Git git = Git.init().setDirectory(remote).setInitialBranch("main").call()) {
            // As the phone has it: no autocrlf (this machine's git config stays out)
            StoredConfig config = git.getRepository().getConfig();
            config.setString("core", null, "autocrlf", "false");
            config.save();
            // "old": no .gitattributes, a .bat stored with LF
            write(remote, "a.txt", "a\n");
            write(remote, "old.bat", "@rem old\n@rem bat\n");
            git.add().addFilepattern(".").call();
            git.commit().setMessage("old").setAuthor(me).setCommitter(me).call();
            git.branchCreate().setName("old").call();
            // main: .bat files are CRLF on disk
            write(remote, ".gitattributes", "* text=auto eol=lf\n*.bat text eol=crlf\n");
            git.rm().addFilepattern("old.bat").call();
            write(remote, "new.bat", "@rem one\n@rem two\n@rem three\n");
            git.add().addFilepattern(".").call();
            git.commit().setMessage("new").setAuthor(me).setCommitter(me).call();
        }
        repo = new File(temp.newFolder("projects"), "repo");
        GitOps.clone(repo, remote.toURI().toString(), null, new GitOps.Progress() {
            @Override
            public void update(String task, int done, int total) {}

            @Override
            public boolean cancelled() {
                return false;
            }
        });
    }

    @Test
    public void aBranchsFilesGetThatBranchsLineEndings() throws Exception {
        assertEquals("@rem one\r\n@rem two\r\n@rem three\r\n", bytesOf("new.bat"));

        GitOps.checkout(repo, "old");
        // No rule there: as stored, like git writes it
        assertEquals("@rem old\n@rem bat\n", bytesOf("old.bat"));
        assertEquals(Collections.emptyList(), GitOps.status(repo));

        GitOps.checkout(repo, "main");
        assertEquals("@rem one\r\n@rem two\r\n@rem three\r\n", bytesOf("new.bat"));
        assertEquals(Collections.emptyList(), GitOps.status(repo));
    }

    @Test
    public void aCrlfFileShowsOnlyTheLineThatChanged() throws Exception {
        write(repo, "new.bat", "@rem one\r\n@rem TWO\r\n@rem three\r\n");

        GitOps.FileDiff diff = GitOps.diff(repo, "new.bat");

        List<String> changed = new ArrayList<>();
        for (GitOps.Hunk hunk : diff.hunks()) {
            for (GitOps.DiffLine line : hunk.lines()) {
                if (!line.kind().equals("context")) changed.add(line.kind() + " " + line.text());
            }
        }
        assertEquals(List.of("removed @rem two", "added @rem TWO"), changed);

        // Committed as git stores it: LF
        GitOps.commit(repo, "Shout", List.of("new.bat"), new GitOps.Identity("Pepino", "test@pepino.dev"));
        assertEquals(Collections.emptyList(), GitOps.status(repo));
        try (Git git = Git.open(repo)) {
            String stored = new String(
                git.getRepository().open(git.getRepository().resolve("HEAD:new.bat")).getBytes(),
                StandardCharsets.UTF_8
            );
            assertEquals("@rem one\n@rem TWO\n@rem three\n", stored);
        }
        assertTrue(bytesOf("new.bat").contains("\r\n"));
    }
}
