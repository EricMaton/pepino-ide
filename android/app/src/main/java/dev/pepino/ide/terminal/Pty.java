package dev.pepino.ide.terminal;

import java.io.IOException;

/**
 * The pseudo-terminal in libpepino-pty.so (#37, src/main/jni/pty.c): a
 * program started on a PTY, so it sees a real terminal. Java reads and
 * writes the master side's file descriptor; the native side opens it,
 * starts the child, resizes it and waits for it.
 */
final class Pty {

    static {
        System.loadLibrary("pepino-pty");
    }

    private Pty() {}

    /**
     * Starts [args] (args[0] the program, looked up in the PATH of [env]) in
     * [cwd] with exactly [env] ("NAME=value"), on a new PTY of [rows] x
     * [cols]. Returns the master side's file descriptor; the pid goes in pid[0].
     */
    static native int spawn(String cwd, String[] args, String[] env, int[] pid, int rows, int cols) throws IOException;

    static native void resize(int fd, int rows, int cols);

    /** Blocks until [pid] ends: its exit code, or 128 + the signal that ended it. */
    static native int waitFor(int pid);

    static native void close(int fd);
}
