package dev.pepino.ide.terminal;

import android.content.Context;
import dev.pepino.ide.R;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;

/**
 * The terminal's shell and what it starts with (#38, ADR-004): Android's own
 * mksh (`/system/bin/sh`) and toybox, a PATH that also reaches the binaries
 * the app ships as native libraries (git #41, node #42: only there can they
 * run, W^X), the app's files folder as HOME (its .gitconfig is JGit's too),
 * and Pepino's prompt and aliases (res/raw/shellrc) through $ENV.
 */
public final class ShellEnvironment {

    private ShellEnvironment() {}

    /** The shell: interactive, as a login shell. */
    public static final String[] SHELL = { "/system/bin/sh", "-l" };

    /** The projects' folder: where shells start, and what the prompt shows paths within. */
    public static File projects(Context context) {
        return new File(context.getFilesDir(), "projects");
    }

    /** The variables a shell gets ("NAME=value"), its start-up file written first. */
    public static String[] of(Context context) throws IOException {
        File home = context.getFilesDir().getCanonicalFile();
        File rc = new File(new File(home, "terminal"), "shellrc");
        writeStartupFile(context, rc);
        return new String[] {
            "TERM=xterm-256color",
            "COLORTERM=truecolor",
            "LANG=en_US.UTF-8",
            "HOME=" + home.getPath(),
            "PROJECTS=" + projects(context).getCanonicalPath(),
            "ENV=" + rc.getPath(),
            "SHELL=" + SHELL[0],
            "TMPDIR=" + context.getCacheDir().getCanonicalPath(),
            "PATH=" + context.getApplicationInfo().nativeLibraryDir + ":/system/bin:/system/xbin:/vendor/bin",
            "ANDROID_DATA=/data",
            "ANDROID_ROOT=/system",
        };
    }

    /** res/raw/shellrc at [file], rewritten only when the app's copy changed. */
    private static void writeStartupFile(Context context, File file) throws IOException {
        byte[] wanted;
        try (InputStream in = context.getResources().openRawResource(R.raw.shellrc); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            for (int read; (read = in.read(buffer)) > 0; ) out.write(buffer, 0, read);
            wanted = out.toByteArray();
        }
        if (file.isFile() && java.util.Arrays.equals(Files.readAllBytes(file.toPath()), wanted)) return;
        File folder = file.getParentFile();
        if (folder != null && !folder.isDirectory() && !folder.mkdirs()) throw new IOException("Cannot create " + folder);
        Files.write(file.toPath(), wanted);
    }
}
