package dev.pepino.ide.terminal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The terminal's shell (#38) on a device: interactive mksh in a project,
 * Pepino's prompt with the path within the projects, its PATH and aliases,
 * toybox's commands.
 */
@RunWith(AndroidJUnit4.class)
public class ShellDeviceTest {

    private Context context;
    private File project;

    private static final class Recorder implements TerminalSession.Listener {
        final StringBuilder output = new StringBuilder();
        final CountDownLatch ended = new CountDownLatch(1);
        volatile int code = -1;

        @Override
        public synchronized void onData(int id, String text, long end) {
            output.append(text);
        }

        @Override
        public void onExit(int id, int code) {
            this.code = code;
            ended.countDown();
        }

        synchronized String output() {
            return output.toString();
        }

        /** Waits until the output has [text] after what was there at [from]. */
        void await(int from, String text) throws InterruptedException {
            // Up to 30 s: git starts a VM (app_process), slow on an emulator
            for (int i = 0; i < 600 && output().indexOf(text, from) < 0; i++) Thread.sleep(50);
            assertTrue("Expected \"" + text + "\" in: " + output().substring(from), output().indexOf(text, from) >= 0);
        }
    }

    @Before
    public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        project = new File(ShellEnvironment.projects(context), "demo");
        assertTrue(new File(project, "src").isDirectory() || new File(project, "src").mkdirs());
    }

    @Test
    public void anInteractiveShellStartsInTheProjectWithPepinosPrompt() throws Exception {
        Recorder recorder = new Recorder();
        TerminalSession shell = TerminalSession.start(
            1,
            project.getCanonicalPath(),
            ShellEnvironment.SHELL,
            ShellEnvironment.of(context),
            24,
            80,
            recorder
        );
        // The prompt: the folder within the projects, green (mksh drops the \001 marks)
        recorder.await(0, "\u001b[32mdemo\u001b[0m $ ");

        int mark = recorder.output().length();
        shell.write("cd src; false\r".getBytes(StandardCharsets.UTF_8));
        // A failed command's code, red, before the path
        recorder.await(mark, "1|");
        recorder.await(mark, "demo/src");

        mark = recorder.output().length();
        shell.write("echo \"[$PATH][$HOME][$PEPINO_HOME]\"; projects; pwd\r".getBytes(StandardCharsets.UTF_8));
        String nativeLibs = context.getApplicationInfo().nativeLibraryDir;
        String projects = ShellEnvironment.projects(context).getCanonicalPath();
        recorder.await(mark, "[" + nativeLibs + ":/system/bin");
        // HOME is the projects (#161); the app's own folder is only for git's config
        recorder.await(mark, "][" + projects + "][" + context.getFilesDir().getCanonicalPath() + "]");
        recorder.await(mark, "\r\n" + projects + "\r\n");

        // toybox, with colours through the alias
        mark = recorder.output().length();
        shell.write("ls demo; echo done\r".getBytes(StandardCharsets.UTF_8));
        recorder.await(mark, "src");
        recorder.await(mark, "\u001b[");
        recorder.await(mark, "done");

        shell.write("exit 5\r".getBytes(StandardCharsets.UTF_8));
        assertTrue(recorder.ended.await(10, TimeUnit.SECONDS));
        assertEquals(5, recorder.code);
    }

    /** The terminal stays in the projects (#161): cd does not leave them, rm and mv touch nothing outside. */
    @Test
    public void theShellStaysInTheProjects() throws Exception {
        Recorder recorder = new Recorder();
        TerminalSession shell = TerminalSession.start(
            1,
            project.getCanonicalPath(),
            ShellEnvironment.SHELL,
            ShellEnvironment.of(context),
            24,
            120,
            recorder
        );
        recorder.await(0, " $ ");
        String projects = ShellEnvironment.projects(context).getCanonicalPath();
        File outside = new File(context.getFilesDir(), "keep-me.txt");
        java.nio.file.Files.write(outside.toPath(), "app data\n".getBytes(StandardCharsets.UTF_8));

        int mark = recorder.output().length();
        // Up to the projects is fine, past them not; cd alone is the projects too
        shell.write("cd ..; pwd; cd ..; pwd; cd /; pwd; cd demo; cd; pwd; echo e\"\"nd-of-cd\r".getBytes(StandardCharsets.UTF_8));
        recorder.await(mark, "end-of-cd");
        String cds = recorder.output().substring(mark);
        assertTrue(cds, cds.contains("pepino: the terminal stays inside the projects"));
        // Every pwd printed the projects' folder: after cd .., after both refusals, and after cd alone
        int pwds = 0;
        for (int at = cds.indexOf("\r\n" + projects + "\r"); at >= 0; at = cds.indexOf("\r\n" + projects + "\r", at + 1)) pwds++;
        assertEquals(cds, 4, pwds);

        mark = recorder.output().length();
        shell.write(
            ("rm ../keep-me.txt; rm -rf \"$PROJECTS\"; mv demo/src ..; touch demo/gone.txt; rm demo/gone.txt; ls demo; echo e\"\"nd-of-rm\r").getBytes(
                StandardCharsets.UTF_8
            )
        );
        recorder.await(mark, "end-of-rm");
        String rms = recorder.output().substring(mark);
        assertTrue(rms, rms.contains("rm: ../keep-me.txt: outside the projects, Pepino keeps it"));
        assertTrue(rms, rms.contains("rm: " + projects + ": outside the projects, Pepino keeps it"));
        assertTrue(rms, rms.contains("mv: ..: outside the projects, Pepino keeps it"));
        assertTrue(outside.exists());
        assertTrue(new File(project, "src").isDirectory());
        assertTrue(!new File(project, "gone.txt").exists());
        shell.kill();
    }

    /** git (#41): the app's JGit through app_process, from the shell, with the app's identity. */
    @Test
    public void gitRunsTheAppsJGit() throws Exception {
        File repo = new File(ShellEnvironment.projects(context), "cli-" + System.nanoTime());
        assertTrue(repo.mkdirs());
        Recorder recorder = new Recorder();
        TerminalSession shell = TerminalSession.start(
            1,
            repo.getCanonicalPath(),
            ShellEnvironment.SHELL,
            ShellEnvironment.of(context),
            24,
            120,
            recorder
        );
        recorder.await(0, " $ ");

        int mark = recorder.output().length();
        // Markers the typed line itself does not show: e""nd only prints as "end"
        shell.write("git --version; echo \"e\"\"xit=$?\"\r".getBytes(StandardCharsets.UTF_8));
        recorder.await(mark, "exit=0");
        assertTrue(recorder.output().substring(mark), recorder.output().indexOf("git version 2 (Pepino", mark) >= 0);

        mark = recorder.output().length();
        shell.write("git init && echo hi > a.txt && git add a.txt && git status -s; echo e\"\"nd-of-status\r".getBytes(StandardCharsets.UTF_8));
        recorder.await(mark, "Initialized empty Git repository in ");
        // On a terminal, in git's colours: the staged A green
        recorder.await(mark, "\u001b[32mA\u001b[m\u001b[31m \u001b[m a.txt");
        recorder.await(mark, "end-of-status");

        // An identity of the repository's own: the test does not depend on the app's .gitconfig
        mark = recorder.output().length();
        shell.write(
            "printf '[user]\\n\\tname = Device\\n\\temail = device@pepino.dev\\n' >> .git/config; git commit -m First; git log -1; echo e\"\"nd-of-log\r".getBytes(
                StandardCharsets.UTF_8
            )
        );
        recorder.await(mark, "end-of-log");
        String log = recorder.output().substring(mark);
        assertTrue(log, log.contains("] First"));
        assertTrue(log, log.contains("Author: Device <device@pepino.dev>"));
        shell.kill();
    }
}
