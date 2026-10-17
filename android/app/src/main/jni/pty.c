/*
 * The terminal's pseudo-terminal (#37, ADR-004): a shell started on a PTY,
 * as Termux does, so that what runs in it sees a real terminal (line
 * editing, colours, Ctrl+C as SIGINT, job control). Java only reads and
 * writes the master side's file descriptor; this file opens it, forks the
 * child onto the slave side, resizes it and waits for the child.
 */

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <jni.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

static void throw_io(JNIEnv *env, const char *what) {
    char message[256];
    snprintf(message, sizeof message, "%s: %s", what, strerror(errno));
    jclass io = (*env)->FindClass(env, "java/io/IOException");
    if (io != NULL) (*env)->ThrowNew(env, io, message);
}

/* A Java String[] as a NULL-terminated array of UTF-8 copies; NULL for a null array. */
static char **strings(JNIEnv *env, jobjectArray array) {
    if (array == NULL) return NULL;
    jsize count = (*env)->GetArrayLength(env, array);
    char **result = calloc((size_t) count + 1, sizeof(char *));
    if (result == NULL) return NULL;
    for (jsize i = 0; i < count; i++) {
        jstring item = (jstring) (*env)->GetObjectArrayElement(env, array, i);
        const char *utf = (*env)->GetStringUTFChars(env, item, NULL);
        result[i] = strdup(utf);
        (*env)->ReleaseStringUTFChars(env, item, utf);
        (*env)->DeleteLocalRef(env, item);
    }
    return result;
}

static void free_strings(char **array) {
    if (array == NULL) return;
    for (char **item = array; *item != NULL; item++) free(*item);
    free(array);
}

/*
 * Starts [argv] (argv[0] the program) in [cwd] with exactly [envp], on a new
 * PTY of [rows] x [cols]. Returns the master side's file descriptor; the
 * child's pid goes in pid[0].
 */
JNIEXPORT jint JNICALL Java_dev_pepino_ide_terminal_Pty_spawn(
    JNIEnv *env, jclass clazz, jstring cwd, jobjectArray args, jobjectArray vars, jintArray pid, jint rows, jint cols) {
    (void) clazz;
    int master = open("/dev/ptmx", O_RDWR | O_CLOEXEC);
    if (master < 0) {
        throw_io(env, "Cannot open /dev/ptmx");
        return -1;
    }
    char slave_name[64];
    if (grantpt(master) || unlockpt(master) || ptsname_r(master, slave_name, sizeof slave_name)) {
        throw_io(env, "Cannot set up the pseudo-terminal");
        close(master);
        return -1;
    }

    // UTF-8 input; no XON/XOFF, so Ctrl+S and Ctrl+Q reach the program
    struct termios tios;
    tcgetattr(master, &tios);
    tios.c_iflag |= IUTF8;
    tios.c_iflag &= ~(IXON | IXOFF);
    tcsetattr(master, TCSANOW, &tios);
    struct winsize size = {.ws_row = (unsigned short) rows, .ws_col = (unsigned short) cols};
    ioctl(master, TIOCSWINSZ, &size);

    const char *dir = (*env)->GetStringUTFChars(env, cwd, NULL);
    char *directory = strdup(dir);
    (*env)->ReleaseStringUTFChars(env, cwd, dir);
    char **argv = strings(env, args);
    char **envp = strings(env, vars);

    pid_t child = fork();
    if (child < 0) {
        throw_io(env, "Cannot start the shell");
        free(directory);
        free_strings(argv);
        free_strings(envp);
        close(master);
        return -1;
    }
    if (child == 0) {
        // The child: no signal blocked or ignored as the app has them (SIGHUP, SIGPIPE...)
        sigset_t none;
        sigemptyset(&none);
        sigprocmask(SIG_SETMASK, &none, NULL);
        for (int sig = 1; sig < NSIG; sig++) signal(sig, SIG_DFL);
        // Its own session, the PTY's slave side as its controlling terminal and stdio
        close(master);
        setsid();
        int slave = open(slave_name, O_RDWR);
        if (slave < 0) _exit(127);
        ioctl(slave, TIOCSCTTY, 0);
        dup2(slave, 0);
        dup2(slave, 1);
        dup2(slave, 2);
        // Nothing of the app's leaks into the shell
        DIR *fds = opendir("/proc/self/fd");
        if (fds != NULL) {
            int own = dirfd(fds);
            struct dirent *entry;
            while ((entry = readdir(fds)) != NULL) {
                int fd = atoi(entry->d_name);
                if (fd > 2 && fd != own) close(fd);
            }
            closedir(fds);
        }
        clearenv();
        if (envp != NULL) {
            for (char **var = envp; *var != NULL; var++) putenv(*var);
        }
        if (chdir(directory) != 0) {
            fprintf(stderr, "pepino: cannot enter %s: %s\r\n", directory, strerror(errno));
        }
        execvp(argv[0], argv);
        fprintf(stderr, "pepino: cannot run %s: %s\r\n", argv[0], strerror(errno));
        fflush(stderr);
        _exit(127);
    }

    free(directory);
    free_strings(argv);
    free_strings(envp);
    jint started = (jint) child;
    (*env)->SetIntArrayRegion(env, pid, 0, 1, &started);
    return master;
}

/* Tells the PTY (and so the program, by SIGWINCH) its new size. */
JNIEXPORT void JNICALL Java_dev_pepino_ide_terminal_Pty_resize(JNIEnv *env, jclass clazz, jint fd, jint rows, jint cols) {
    (void) env;
    (void) clazz;
    struct winsize size = {.ws_row = (unsigned short) rows, .ws_col = (unsigned short) cols};
    ioctl(fd, TIOCSWINSZ, &size);
}

/* Waits for [pid] to end: its exit code, or 128 + the signal that ended it (as shells report it). */
JNIEXPORT jint JNICALL Java_dev_pepino_ide_terminal_Pty_waitFor(JNIEnv *env, jclass clazz, jint pid) {
    (void) env;
    (void) clazz;
    int status;
    while (waitpid(pid, &status, 0) < 0) {
        if (errno != EINTR) return -1;
    }
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return 0;
}

JNIEXPORT void JNICALL Java_dev_pepino_ide_terminal_Pty_close(JNIEnv *env, jclass clazz, jint fd) {
    (void) env;
    (void) clazz;
    close(fd);
}
