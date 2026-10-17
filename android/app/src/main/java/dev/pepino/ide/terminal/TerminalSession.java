package dev.pepino.ide.terminal;

import android.os.ParcelFileDescriptor;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/**
 * One shell on a PTY (#37): what it prints comes to [Listener.onData] as
 * text (UTF-8 decoded across reads, so a character split between two reads
 * arrives whole), what is typed goes in with [write], and [Listener.onExit]
 * says when it ended. A reader thread and a waiter thread per session.
 */
public final class TerminalSession {

    public interface Listener {
        void onData(int id, String text);

        void onExit(int id, int code);
    }

    /** One read hands over at most this much: output that keeps coming goes in chunks this size. */
    private static final int CHUNK = 64 * 1024;

    public final int id;
    public final int pid;
    private final ParcelFileDescriptor master;
    private final FileOutputStream out;
    private final Thread reader;
    private volatile boolean closed;

    private TerminalSession(int id, int pid, int fd, Listener listener) {
        this.id = id;
        this.pid = pid;
        this.master = ParcelFileDescriptor.adoptFd(fd);
        this.out = new FileOutputStream(master.getFileDescriptor());
        FileInputStream in = new FileInputStream(master.getFileDescriptor());
        reader = new Thread(() -> read(in, listener), "pty-read-" + id);
        reader.start();
        Thread waiter = new Thread(
            () -> {
                int code = Pty.waitFor(pid);
                // What it printed last comes before its end
                try {
                    reader.join(500);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                close();
                listener.onExit(id, code);
            },
            "pty-wait-" + id
        );
        waiter.start();
    }

    /** Starts [args] in [cwd] with [env] on a PTY of [rows] x [cols]. */
    public static TerminalSession start(int id, String cwd, String[] args, String[] env, int rows, int cols, Listener listener)
        throws IOException {
        int[] pid = new int[1];
        int fd = Pty.spawn(cwd, args, env, pid, Math.max(1, rows), Math.max(1, cols));
        return new TerminalSession(id, pid[0], fd, listener);
    }

    private void read(InputStream in, Listener listener) {
        CharsetDecoder decoder = StandardCharsets.UTF_8
            .newDecoder()
            .onMalformedInput(CodingErrorAction.REPLACE)
            .onUnmappableCharacter(CodingErrorAction.REPLACE);
        ByteBuffer bytes = ByteBuffer.allocate(CHUNK + 8);
        CharBuffer chars = CharBuffer.allocate(CHUNK + 8);
        byte[] buffer = new byte[CHUNK];
        try {
            while (true) {
                int read = in.read(buffer, 0, CHUNK - bytes.position());
                if (read < 0) break;
                // More already waiting: one message for all of it, not one per read
                while (read < CHUNK - bytes.position() && in.available() > 0) {
                    int more = in.read(buffer, read, Math.min(in.available(), CHUNK - bytes.position() - read));
                    if (more <= 0) break;
                    read += more;
                }
                bytes.put(buffer, 0, read);
                bytes.flip();
                decoder.decode(bytes, chars, false);
                bytes.compact();
                chars.flip();
                if (chars.hasRemaining()) listener.onData(id, chars.toString());
                chars.clear();
            }
        } catch (IOException e) {
            // EIO: the shell ended and the PTY's other side is gone
        }
    }

    public void write(byte[] data) throws IOException {
        if (closed) throw new IOException("The terminal has ended");
        out.write(data);
    }

    public void resize(int rows, int cols) {
        if (!closed) Pty.resize(master.getFd(), Math.max(1, rows), Math.max(1, cols));
    }

    /** Ends the shell and what it runs: SIGHUP to its process group, as closing a terminal window does. */
    public void kill() {
        for (int target : new int[] { -pid, pid }) {
            try {
                Os.kill(target, OsConstants.SIGHUP);
            } catch (ErrnoException e) {
                // Gone already
            }
        }
    }

    private synchronized void close() {
        if (closed) return;
        closed = true;
        try {
            master.close();
        } catch (IOException e) {
            // Nothing left to do with it
        }
    }
}
