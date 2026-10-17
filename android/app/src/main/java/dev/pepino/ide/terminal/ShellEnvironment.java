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
        File projects = projects(context).getCanonicalFile();
        if (!projects.isDirectory() && !projects.mkdirs()) throw new IOException("Cannot create " + projects);
        java.util.List<String> env = new java.util.ArrayList<>(java.util.Arrays.asList(
            "TERM=xterm-256color",
            "COLORTERM=truecolor",
            "LANG=en_US.UTF-8",
            // HOME is the projects (cd, ~): the app's own files stay out of reach (#161).
            // Its git config is in PEPINO_HOME, read by the terminal's git (#41).
            "HOME=" + projects.getPath(),
            "PEPINO_HOME=" + home.getPath(),
            "PROJECTS=" + projects.getPath(),
            "ENV=" + rc.getPath(),
            "SHELL=" + SHELL[0],
            // The APK, whose JGit the shell's `git` runs (#41, res/raw/shellrc)
            "PEPINO_APK=" + context.getPackageCodePath(),
            "TMPDIR=" + context.getCacheDir().getCanonicalPath(),
            "PATH=" + context.getApplicationInfo().nativeLibraryDir + ":/system/bin:/system/xbin:/vendor/bin",
            "ANDROID_DATA=/data",
            "ANDROID_ROOT=/system"
        ));
        // What Android's runtime needs to start a VM from the shell (app_process: git #41, am, pm),
        // as the app's own process has them
        for (String name : RUNTIME) {
            String value = System.getenv(name);
            if (value != null) env.add(name + "=" + value);
        }
        return env.toArray(new String[0]);
    }

    private static final String[] RUNTIME = {
        "BOOTCLASSPATH",
        "DEX2OATBOOTCLASSPATH",
        "SYSTEMSERVERCLASSPATH",
        "ANDROID_ART_ROOT",
        "ANDROID_I18N_ROOT",
        "ANDROID_TZDATA_ROOT",
        "ANDROID_ASSETS",
        "ANDROID_STORAGE",
        "EXTERNAL_STORAGE",
    };

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
