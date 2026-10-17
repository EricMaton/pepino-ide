package dev.pepino.ide.terminal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The terminal's PTY (#37) on a device: a shell that sees a real terminal,
 * whose output comes back, which takes Ctrl+C as SIGINT, and which resizes.
 */
@RunWith(AndroidJUnit4.class)
public class PtyDeviceTest {

    private static final String[] ENV = { "TERM=xterm-256color", "PATH=/system/bin", "HOME=/data/local/tmp" };

    /** Everything a session prints, and how it ended. */
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

        /** Waits until the output has [text]. */
        void await(String text) throws InterruptedException {
            for (int i = 0; i < 100 && !output().contains(text); i++) Thread.sleep(50);
            assertTrue("Expected \"" + text + "\" in: " + output(), output().contains(text));
        }
    }

    /** The app's files folder, as the shell sees it (/data/data/…, not the /data/user/0/… link). */
    private String cwd() throws java.io.IOException {
        return InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir().getCanonicalPath();
    }

    private TerminalSession run(Recorder recorder, String script) throws Exception {
        return TerminalSession.start(1, cwd(), new String[] { "/system/bin/sh", "-c", script }, ENV, 24, 80, recorder);
    }

    @Test
    public void aCommandRunsOnATerminalAndItsExitCodeComesBack() throws Exception {
        Recorder recorder = new Recorder();
        run(recorder, "tty; echo \"$TERM in $PWD\"; printf 'caf\\303\\251\\n'; exit 3");

        assertTrue(recorder.ended.await(10, TimeUnit.SECONDS));
        assertEquals(3, recorder.code);
        String output = recorder.output();
        assertTrue(output, output.contains("/dev/pts/"));
        assertTrue(output, output.contains("xterm-256color in " + cwd()));
        // UTF-8 whole, and the terminal's own line endings
        assertTrue(output, output.contains("café\r\n"));
    }

    @Test
    public void ctrlCReachesTheProgramAsSigint() throws Exception {
        Recorder recorder = new Recorder();
        TerminalSession session = run(recorder, "echo ready; exec cat");
        recorder.await("ready");

        session.write("hello\n".getBytes(StandardCharsets.UTF_8));
        recorder.await("hello\r\nhello");
        session.write(new byte[] { 3 });

        assertTrue(recorder.ended.await(10, TimeUnit.SECONDS));
        assertEquals(128 + 2, recorder.code);
    }

    @Test
    public void resizingTellsTheProgramItsSize() throws Exception {
        Recorder recorder = new Recorder();
        TerminalSession session = run(recorder, "stty size; read line; stty size");
        recorder.await("24 80");

        session.resize(40, 100);
        session.write("\n".getBytes(StandardCharsets.UTF_8));

        recorder.await("40 100");
        assertTrue(recorder.ended.await(10, TimeUnit.SECONDS));
    }

    /** Throughput (#37): 5 MB through the PTY to the session's listener, every byte, timed. */
    @Test
    public void aLargeOutputArrivesWhole() throws Exception {
        int size = 5 * 1024 * 1024;
        Recorder recorder = new Recorder();
        long start = System.nanoTime();
        run(recorder, "head -c " + size + " /dev/zero | tr '\\0' x");

        assertTrue(recorder.ended.await(60, TimeUnit.SECONDS));
        double seconds = (System.nanoTime() - start) / 1e9;
        assertEquals(size, recorder.output().length());
        android.util.Log.i("PtyDeviceTest", String.format("5 MB through the PTY in %.2f s: %.1f MB/s", seconds, 5 / seconds));
    }

    @Test
    public void killingEndsTheShellAndWhatItRuns() throws Exception {
        Recorder recorder = new Recorder();
        TerminalSession session = run(recorder, "echo ready; sleep 60");
        recorder.await("ready");

        session.kill();

        assertTrue(recorder.ended.await(10, TimeUnit.SECONDS));
        assertEquals(128 + 1, recorder.code);
    }
}
