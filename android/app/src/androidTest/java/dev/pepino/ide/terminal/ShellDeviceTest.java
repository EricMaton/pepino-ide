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
        public synchronized void onData(int id, String text) {
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
            for (int i = 0; i < 100 && output().indexOf(text, from) < 0; i++) Thread.sleep(50);
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
        shell.write("echo \"[$PATH][$HOME][$PROJECTS]\"; projects; pwd\r".getBytes(StandardCharsets.UTF_8));
        String nativeLibs = context.getApplicationInfo().nativeLibraryDir;
        recorder.await(mark, "[" + nativeLibs + ":/system/bin");
        recorder.await(mark, "][" + context.getFilesDir().getCanonicalPath() + "][");
        recorder.await(mark, "\r\n" + ShellEnvironment.projects(context).getCanonicalPath() + "\r\n");

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
}
