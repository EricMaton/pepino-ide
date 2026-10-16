package dev.pepino.ide.git;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.eclipse.jgit.api.CheckoutCommand;
import org.eclipse.jgit.api.CreateBranchCommand;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.Status;
import org.eclipse.jgit.api.errors.CheckoutConflictException;
import org.eclipse.jgit.api.errors.EmptyCommitException;
import org.eclipse.jgit.api.errors.NotMergedException;
import org.eclipse.jgit.api.errors.GitAPIException;
import org.eclipse.jgit.api.errors.TransportException;
import org.eclipse.jgit.diff.DiffAlgorithm;
import org.eclipse.jgit.diff.DiffEntry;
import org.eclipse.jgit.diff.Edit;
import org.eclipse.jgit.diff.EditList;
import org.eclipse.jgit.diff.RawText;
import org.eclipse.jgit.diff.SequenceComparator;
import org.eclipse.jgit.dircache.DirCache;
import org.eclipse.jgit.dircache.DirCacheBuilder;
import org.eclipse.jgit.dircache.DirCacheEditor;
import org.eclipse.jgit.dircache.DirCacheEntry;
import org.eclipse.jgit.dircache.DirCacheIterator;
import org.eclipse.jgit.errors.ConfigInvalidException;
import org.eclipse.jgit.lib.CommitBuilder;
import org.eclipse.jgit.lib.Constants;
import org.eclipse.jgit.lib.FileMode;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.lib.ObjectInserter;
import org.eclipse.jgit.lib.ObjectLoader;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.lib.ProgressMonitor;
import org.eclipse.jgit.lib.Ref;
import org.eclipse.jgit.lib.RefUpdate;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.lib.RepositoryCache;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.revwalk.RevTree;
import org.eclipse.jgit.revwalk.RevWalk;
import org.eclipse.jgit.storage.file.FileBasedConfig;
import org.eclipse.jgit.transport.CredentialsProvider;
import org.eclipse.jgit.treewalk.EmptyTreeIterator;
import org.eclipse.jgit.treewalk.FileTreeIterator;
import org.eclipse.jgit.treewalk.TreeWalk;
import org.eclipse.jgit.treewalk.filter.NotIgnoredFilter;
import org.eclipse.jgit.treewalk.filter.TreeFilter;
import org.eclipse.jgit.util.FS;
import org.eclipse.jgit.util.RawParseUtils;

/**
 * The git operations, on plain files and JGit only (no Android), so the JVM
 * unit tests run the same code as the phone (ADR-006). Paths are relative to
 * the project space root, like everywhere else in the app; the paths of the
 * files in a repository are relative to the repository.
 */
public final class GitOps {

    /** The branch a new repository starts on. */
    public static final String DEFAULT_BRANCH = "main";

    /** Pepino's own folder (editor snapshots): never a change to commit. */
    static final String PEPINO_EXCLUDE = ".pepino/";

    /** What the UI shows about a repository. */
    public record RepoInfo(String branch, boolean hasCommits) {}

    /** A changed file, against the last commit: "new", "modified", "deleted" or "conflicted". */
    public record FileChange(String path, String kind) {}

    /** Who commits: the app's own git identity. */
    public record Identity(String name, String email) {}

    /** A commit just made: its short id and first line. */
    public record CommitResult(String id, String summary) {}

    /**
     * A commit in the history: its full id, the message's first line and the
     * rest of it, and who wrote it when ([time] in millis since the epoch).
     */
    public record LogEntry(String id, String summary, String description, String author, String email, long time) {}

    /**
     * Pepino's snapshots of the working tree: a chain of commits on a ref of
     * its own, which no branch, History or push ever shows.
     */
    static final String SNAPSHOTS_REF = "refs/pepino/snapshots";

    /** Bigger files are left out of snapshots. */
    static final int SNAPSHOT_MAX_FILE_BYTES = 5 << 20;

    /** How far back [snapshotVersions] looks. */
    static final int SNAPSHOTS_SCANNED = 500;

    /** Folders snapshots never look into: dependencies, rebuilt at will. */
    private static final Set<String> SNAPSHOT_SKIPPED = Set.of("node_modules");

    /** A snapshot holding one version of a file: when it was taken, and why. */
    public record SnapshotVersion(String id, String reason, long time) {}

    /** A local branch; [current] is the one HEAD is on. */
    /** A branch; [remote] when it is only on GitHub (origin/[name]), with no local branch yet. */
    public record Branch(String name, boolean current, boolean remote) {
        public Branch(String name, boolean current) {
            this(name, current, false);
        }
    }

    /** The remote a clone sets up, whose branches show next to the local ones. */
    static final String ORIGIN = "origin";

    /** After switching branch: where HEAD is now, and the files the switch wrote or removed (repo-relative). */
    public record Switched(RepoInfo info, List<String> written, List<String> removed) {}

    /** Switching would overwrite uncommitted changes to these files. */
    public static final class ConflictException extends IllegalStateException {
        public final List<String> paths;

        ConflictException(List<String> paths) {
            super("Commit your changes to " + describe(paths) + " before switching branch");
            this.paths = paths;
        }

        private static String describe(List<String> paths) {
            String first = new File(paths.get(0)).getName();
            return paths.size() == 1 ? first : first + " and " + (paths.size() - 1) + " more";
        }
    }

    /** The branch has commits that no other branch has; deleting it needs [force]. */
    public static final class NotMergedBranchException extends IllegalStateException {
        NotMergedBranchException(String name) {
            super(name + " has commits that are on no other branch");
        }
    }

    /** Lines of context around each change in a diff, as git shows them. */
    static final int DIFF_CONTEXT = 3;

    /** Bigger files are committed whole, never shown line by line. */
    static final int DIFF_MAX_BYTES = 1 << 20;

    /**
     * A line of a diff: "context", "added" or "removed". [oldLine] and
     * [newLine] are 1-based, 0 on the side the line is not on. [index] numbers
     * the changed lines of the file in order (-1 for context): it is how a
     * commit leaves lines out. [noNewline]: the file ends on it without one.
     * [endOfFile]: not a line but the file's final line break, added or
     * removed (empty [text], no line numbers).
     */
    public record DiffLine(String kind, String text, int oldLine, int newLine, int index, boolean noNewline, boolean endOfFile) {
        DiffLine(String kind, String text, int oldLine, int newLine, int index, boolean noNewline) {
            this(kind, text, oldLine, newLine, index, noNewline, false);
        }
    }

    /** Changed lines and the context around them; starts and counts as in git's "@@ -a,b +c,d @@". */
    public record Hunk(int oldStart, int oldLines, int newStart, int newLines, List<DiffLine> lines) {}

    /**
     * A file against the last commit. Binary and too large files have no
     * hunks (they are committed whole). [version] names the two contents the
     * hunks were made from, so lines picked on them can be checked at commit.
     */
    public record FileDiff(String version, boolean binary, boolean tooLarge, List<Hunk> hunks) {}

    /** Changed lines ([DiffLine.index]) to leave out of a commit, picked on the diff [version]. */
    public record LineExclusion(String version, Set<Integer> lines) {}

    /** The files changed after their lines were picked; nothing was committed. */
    public static final class StaleSelectionException extends IllegalStateException {
        public final List<String> paths;

        StaleSelectionException(List<String> paths) {
            super(new File(paths.get(0)).getName() + " changed since you picked its lines: check them again");
            this.paths = paths;
        }
    }

    private GitOps() {}

    /**
     * The folder at [path] inside [root]. The root itself never is one (the
     * project space is not a project), and nothing outside it is reachable.
     */
    public static File resolve(File root, String path) throws IOException {
        if (path == null || path.trim().isEmpty()) throw new IllegalArgumentException("The project space is not a project");
        File base = root.getCanonicalFile();
        File folder = new File(base, path).getCanonicalFile();
        if (!folder.toPath().startsWith(base.toPath()) || folder.equals(base)) {
            throw new IllegalArgumentException("Outside the project space: " + path);
        }
        return folder;
    }

    /** True when [folder] holds a git repository (its own .git, not one of a parent folder). */
    public static boolean isRepository(File folder) {
        return RepositoryCache.FileKey.isGitRepository(new File(folder, Constants.DOT_GIT), FS.DETECTED);
    }

    /**
     * Talking to a remote went wrong (#32): "CANCELLED" (the user stopped
     * it), "UNAUTHORIZED" (the remote refused the credentials), "NETWORK"
     * (no connection) or "FAILED".
     */
    public static final class RemoteException extends IOException {
        public final String code;

        RemoteException(String code, String message, Throwable cause) {
            super(message, cause);
            this.code = code;
        }
    }

    /** How a clone goes: [update] as each step advances ([total] 0 when unknown), and whether to stop. */
    public interface Progress {
        void update(String task, int done, int total);

        boolean cancelled();
    }

    /**
     * Clones [url] into [folder], which must not exist or be empty, checking
     * out the remote's default branch; every remote branch comes along as
     * origin/…. JGit 5.13 has no shallow clone (ADR-006): the whole history
     * comes. A failed or cancelled clone leaves nothing behind.
     */
    public static RepoInfo clone(File folder, String url, CredentialsProvider credentials, Progress progress)
        throws IOException, GitAPIException {
        String[] existing = folder.list();
        if (folder.exists() && (existing == null || existing.length > 0)) {
            throw new IOException("Already exists and is not empty: " + folder.getName());
        }
        boolean created = !folder.exists();
        try (
            Git git = Git.cloneRepository()
                .setURI(url)
                .setDirectory(folder)
                .setCloneAllBranches(true)
                .setCredentialsProvider(credentials)
                .setProgressMonitor(monitor(progress))
                .call()
        ) {
            excludePepino(git.getRepository());
            return info(git.getRepository());
        } catch (IOException | GitAPIException | RuntimeException e) {
            // JGit cleans up after itself too; this also covers a failure after its clone (the exclude)
            deleteContents(folder);
            if (created) folder.delete();
            if (progress.cancelled()) throw new RemoteException("CANCELLED", "Clone cancelled", e);
            throw remoteFailure(e);
        }
    }

    /** JGit's progress as [Progress], at most every 150 ms per step (every object would flood the bridge). */
    private static ProgressMonitor monitor(Progress progress) {
        return new ProgressMonitor() {
            private String task = "";
            private int total;
            private int done;
            private long shown;

            @Override
            public void start(int totalTasks) {}

            @Override
            public void beginTask(String title, int totalWork) {
                task = title;
                total = totalWork == UNKNOWN ? 0 : totalWork;
                done = 0;
                shown = System.currentTimeMillis();
                progress.update(task, 0, total);
            }

            @Override
            public void update(int completed) {
                done += completed;
                long now = System.currentTimeMillis();
                if (now - shown >= 150) {
                    shown = now;
                    progress.update(task, done, total);
                }
            }

            @Override
            public void endTask() {
                progress.update(task, total > 0 ? total : done, total);
            }

            @Override
            public boolean isCancelled() {
                return progress.cancelled();
            }
        };
    }

    /** What a failed fetch or clone was, by what JGit says. */
    static IOException remoteFailure(Exception e) {
        if (e instanceof RemoteException) return (RemoteException) e;
        String message = String.valueOf(e.getMessage());
        if (e instanceof TransportException) {
            if (message.contains("not authorized") || message.contains("Authentication is required") || message.contains("401")) {
                return new RemoteException("UNAUTHORIZED", "GitHub refused the sign-in", e);
            }
            for (Throwable cause = e.getCause(); cause != null; cause = cause.getCause()) {
                if (cause instanceof java.net.UnknownHostException
                    || cause instanceof java.net.ConnectException
                    || cause instanceof java.net.SocketTimeoutException
                    || cause instanceof java.net.NoRouteToHostException) {
                    return new RemoteException("NETWORK", "Cannot reach GitHub", e);
                }
            }
        }
        return new RemoteException("FAILED", message, e);
    }

    /** Deletes what is inside [folder]; a symlink goes, never what it points to. */
    private static void deleteContents(File folder) {
        File[] children = folder.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (child.isDirectory() && !Files.isSymbolicLink(child.toPath())) deleteContents(child);
            child.delete();
        }
    }

    /** Makes [folder] a repository on [DEFAULT_BRANCH]. An existing repository is left as it is. */
    public static RepoInfo init(File folder) throws IOException, GitAPIException {
        if (!folder.isDirectory()) throw new IOException("Not a folder: " + folder.getName());
        if (!isRepository(folder)) {
            try (Git git = Git.init().setDirectory(folder).setInitialBranch(DEFAULT_BRANCH).call()) {
                excludePepino(git.getRepository());
                return info(git.getRepository());
            }
        }
        return info(folder);
    }

    /** The current branch and whether it has commits yet, or null when [folder] is not a repository. */
    public static RepoInfo info(File folder) throws IOException {
        if (!isRepository(folder)) return null;
        try (Git git = Git.open(folder)) {
            return info(git.getRepository());
        }
    }

    private static RepoInfo info(Repository repository) throws IOException {
        return new RepoInfo(repository.getBranch(), repository.resolve(Constants.HEAD) != null);
    }

    /**
     * Every file that differs from the last commit, by path. GitHub Desktop's
     * model: what is staged does not matter, the commit takes the files the
     * user ticks.
     */
    public static List<FileChange> status(File folder) throws IOException, GitAPIException {
        try (Git git = Git.open(folder)) {
            excludePepino(git.getRepository());
            Status status = git.status().call();
            Map<String, String> kinds = new TreeMap<>();
            // Later kinds win: a file both added and modified is new, a conflict is a conflict.
            put(kinds, status.getModified(), "modified");
            put(kinds, status.getChanged(), "modified");
            put(kinds, status.getUntracked(), "new");
            put(kinds, status.getAdded(), "new");
            put(kinds, status.getRemoved(), "deleted");
            for (String path : status.getMissing()) {
                // Added, then deleted before any commit: there is nothing left to commit.
                if (status.getAdded().contains(path)) kinds.remove(path);
                else kinds.put(path, "deleted");
            }
            put(kinds, status.getConflicting(), "conflicted");
            List<FileChange> changes = new ArrayList<>();
            kinds.forEach((path, kind) -> changes.add(new FileChange(path, kind)));
            return changes;
        }
    }

    private static void put(Map<String, String> kinds, Collection<String> paths, String kind) {
        for (String path : paths) kinds.put(path, kind);
    }

    /** [path] inside the repository at [folder], never outside it. */
    private static File repoFile(File folder, String path) throws IOException {
        if (path == null || path.trim().isEmpty()) throw new IllegalArgumentException("No file given");
        File base = folder.getCanonicalFile();
        File file = new File(base, path).getCanonicalFile();
        if (!file.toPath().startsWith(base.toPath()) || file.equals(base)) {
            throw new IllegalArgumentException("Outside the repository: " + path);
        }
        return file;
    }

    /** RawText with each line's bytes reachable, so a partial commit copies them exactly. */
    private static final class Lines extends RawText {
        Lines(byte[] content) {
            super(content);
        }

        /** Line [i] (0-based) runs from [start] to [end], its line break included. */
        int start(int i) {
            return lines.get(i + 1);
        }

        int end(int i) {
            return lines.get(i + 2);
        }

        String text(int i) {
            int end = end(i);
            if (end > start(i) && content[end - 1] == '\n') end--;
            if (end > start(i) && content[end - 1] == '\r') end--;
            return RawParseUtils.decode(content, start(i), end);
        }

        boolean endsWithoutNewline(int i) {
            return i == size() - 1 && isMissingNewlineAtEnd();
        }

        /** Where line [i] ends without its '\n' (a '\r' before it stays): what lines are compared by. */
        int contentEnd(int i) {
            int end = end(i);
            return end > start(i) && content[end - 1] == '\n' ? end - 1 : end;
        }

        boolean sameLine(int i, Lines other, int j) {
            int length = contentEnd(i) - start(i);
            if (length != other.contentEnd(j) - other.start(j)) return false;
            for (int k = 0; k < length; k++) {
                if (content[start(i) + k] != other.content[other.start(j) + k]) return false;
            }
            return true;
        }

        int hashLine(int i) {
            int hash = 5381;
            for (int p = start(i); p < contentEnd(i); p++) hash = ((hash << 5) + hash) + (content[p] & 0xff);
            return hash;
        }
    }

    /**
     * Lines compared without their final '\n': a last line that gains or
     * loses its line break is still the same line. The line break at the end
     * of the file is a change of its own ([Changes.endOfFile]).
     */
    private static final SequenceComparator<Lines> BY_CONTENT = new SequenceComparator<Lines>() {
        @Override
        public boolean equals(Lines a, int ai, Lines b, int bi) {
            return a.sameLine(ai, b, bi);
        }

        @Override
        public int hash(Lines seq, int i) {
            return seq.hashLine(i);
        }
    };

    /**
     * The changed lines between [a] and [b], and how each side ends: [oldBare]
     * / [newBare] when its last line has no line break (an empty side ends
     * like the other). When they differ, that final line break is one more
     * changed line, numbered after all the others.
     */
    private record Changes(Lines a, Lines b, EditList edits, boolean oldBare, boolean newBare) {
        static Changes of(byte[] old, byte[] now) {
            Lines a = new Lines(old);
            Lines b = new Lines(now);
            EditList edits = DiffAlgorithm.getAlgorithm(DiffAlgorithm.SupportedAlgorithm.HISTOGRAM).diff(BY_CONTENT, a, b);
            boolean oldBare = a.size() > 0 ? a.isMissingNewlineAtEnd() : b.size() > 0 && b.isMissingNewlineAtEnd();
            boolean newBare = b.size() > 0 ? b.isMissingNewlineAtEnd() : oldBare;
            return new Changes(a, b, edits, oldBare, newBare);
        }

        boolean endOfFile() {
            return oldBare != newBare;
        }

        /** The changed lines, the final line break included when it changed. */
        int count() {
            int count = endOfFile() ? 1 : 0;
            for (Edit edit : edits) count += edit.getLengthA() + edit.getLengthB();
            return count;
        }
    }

    /** A file in the last commit and on disk (empty where it is missing), and the mode to commit it with. */
    private record Sides(byte[] old, byte[] now, FileMode mode, boolean text, boolean tooLarge) {
        String version() {
            ObjectInserter.Formatter ids = new ObjectInserter.Formatter();
            return ids.idFor(Constants.OBJ_BLOB, old).name() + ":" + ids.idFor(Constants.OBJ_BLOB, now).name();
        }

        Changes changes() {
            return Changes.of(old, now);
        }
    }

    private static Sides sides(Repository repository, File folder, String path) throws IOException {
        File file = repoFile(folder, path);
        byte[] old = new byte[0];
        FileMode mode = FS.DETECTED.canExecute(file) ? FileMode.EXECUTABLE_FILE : FileMode.REGULAR_FILE;
        boolean text = true;
        ObjectId tree = repository.resolve(Constants.HEAD + "^{tree}");
        if (tree != null) {
            try (TreeWalk walk = TreeWalk.forPath(repository, path, tree)) {
                if (walk != null) {
                    mode = walk.getFileMode(0);
                    // Symlinks and submodules are not text to pick lines from.
                    text = mode == FileMode.REGULAR_FILE || mode == FileMode.EXECUTABLE_FILE;
                    ObjectLoader blob = text ? repository.open(walk.getObjectId(0), Constants.OBJ_BLOB) : null;
                    if (blob != null && blob.getSize() > DIFF_MAX_BYTES) return new Sides(old, old, mode, true, true);
                    if (blob != null) old = blob.getCachedBytes(DIFF_MAX_BYTES);
                }
            }
        }
        if (file.length() > DIFF_MAX_BYTES) return new Sides(old, old, mode, text, true);
        byte[] now = file.isFile() ? Files.readAllBytes(file.toPath()) : new byte[0];
        return new Sides(old, now, mode, text && !RawText.isBinary(old) && !RawText.isBinary(now), false);
    }

    /**
     * How [path] (repo-relative) differs from the last commit, as hunks of
     * lines with [DIFF_CONTEXT] lines of context. Like status, it compares the
     * file on disk with the last commit; what is staged does not matter.
     */
    public static FileDiff diff(File folder, String path) throws IOException {
        try (Git git = Git.open(folder)) {
            Sides sides = sides(git.getRepository(), folder, path);
            if (sides.tooLarge()) return new FileDiff("", false, true, Collections.emptyList());
            if (!sides.text()) return new FileDiff(sides.version(), true, false, Collections.emptyList());
            return new FileDiff(sides.version(), false, false, hunks(sides.changes()));
        }
    }

    private static List<Hunk> hunks(Changes changes) {
        Lines a = changes.a();
        Lines b = changes.b();
        // The final line break, when it changed, is an empty edit at the end: it gets its hunk and context too.
        List<Edit> edits = new ArrayList<>(changes.edits());
        if (changes.endOfFile()) edits.add(new Edit(a.size(), a.size(), b.size(), b.size()));
        List<Hunk> hunks = new ArrayList<>();
        int index = 0;
        for (int first = 0; first < edits.size(); ) {
            // Edits closer than twice the context share a hunk.
            int last = first;
            while (last + 1 < edits.size() && edits.get(last + 1).getBeginA() - edits.get(last).getEndA() <= 2 * DIFF_CONTEXT) {
                last++;
            }
            int aStart = Math.max(0, edits.get(first).getBeginA() - DIFF_CONTEXT);
            int bStart = Math.max(0, edits.get(first).getBeginB() - DIFF_CONTEXT);
            int aEnd = Math.min(a.size(), edits.get(last).getEndA() + DIFF_CONTEXT);
            int bEnd = Math.min(b.size(), edits.get(last).getEndB() + DIFF_CONTEXT);
            List<DiffLine> lines = new ArrayList<>();
            int ai = aStart;
            int bi = bStart;
            for (int k = first; k <= last; k++) {
                Edit edit = edits.get(k);
                for (; ai < edit.getBeginA(); ai++, bi++) lines.add(context(a, ai, b, bi));
                for (; ai < edit.getEndA(); ai++) {
                    lines.add(new DiffLine("removed", a.text(ai), ai + 1, 0, index++, a.endsWithoutNewline(ai)));
                }
                for (; bi < edit.getEndB(); bi++) {
                    lines.add(new DiffLine("added", b.text(bi), 0, bi + 1, index++, b.endsWithoutNewline(bi)));
                }
                if (edit.isEmpty()) {
                    lines.add(new DiffLine(changes.newBare() ? "removed" : "added", "", 0, 0, index++, false, true));
                }
            }
            for (; ai < aEnd; ai++, bi++) lines.add(context(a, ai, b, bi));
            int oldLines = aEnd - aStart;
            int newLines = bEnd - bStart;
            // git numbers an empty side by the line before it
            hunks.add(new Hunk(oldLines == 0 ? aStart : aStart + 1, oldLines, newLines == 0 ? bStart : bStart + 1, newLines, lines));
            first = last + 1;
        }
        return hunks;
    }

    /** A context line ends the file as it is now. */
    private static DiffLine context(Lines a, int ai, Lines b, int bi) {
        return new DiffLine("context", a.text(ai), ai + 1, bi + 1, -1, b.endsWithoutNewline(bi));
    }

    /**
     * The file as committed when [excluded] changed lines stay as they were:
     * a removed line left out is kept, an added line left out is not added,
     * and the final line break is the old one unless its change is committed.
     */
    private static byte[] partial(Changes changes, Set<Integer> excluded) {
        Lines a = changes.a();
        Lines b = changes.b();
        List<int[]> kept = new ArrayList<>(); // {0 for a / 1 for b, line}
        int ai = 0;
        int index = 0;
        for (Edit edit : changes.edits()) {
            for (; ai < edit.getBeginA(); ai++) kept.add(new int[] {0, ai});
            for (int k = edit.getBeginA(); k < edit.getEndA(); k++) {
                if (excluded.contains(index++)) kept.add(new int[] {0, k});
            }
            for (int k = edit.getBeginB(); k < edit.getEndB(); k++) {
                if (!excluded.contains(index++)) kept.add(new int[] {1, k});
            }
            ai = edit.getEndA();
        }
        for (; ai < a.size(); ai++) kept.add(new int[] {0, ai});
        boolean bare = changes.endOfFile() && !excluded.contains(index) ? changes.newBare() : changes.oldBare();

        // Lines are joined by '\n' (a '\r' stays with its line), so every line but the last has one.
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (int k = 0; k < kept.size(); k++) {
            Lines text = kept.get(k)[0] == 0 ? a : b;
            int line = kept.get(k)[1];
            if (k > 0) out.write('\n');
            out.write(text.getRawContent(), text.start(line), text.contentEnd(line) - text.start(line));
        }
        if (!kept.isEmpty() && !bare) out.write('\n');
        return out.toByteArray();
    }

    /**
     * Commits exactly [paths] (as they are on disk; a missing one is a
     * deletion) with [message], as [who]. Anything staged before is left out.
     * JGit writes through `.lock` files and renames, so a crash mid-commit
     * leaves the previous commit intact (Sprint 3, criterion 3).
     */
    public static CommitResult commit(File folder, String message, List<String> paths, Identity who)
        throws IOException, GitAPIException {
        return commit(folder, message, paths, Collections.emptyMap(), who);
    }

    /**
     * Like [commit], leaving out of the files in [excluded] the changed lines
     * picked there: GitHub Desktop's line selection. When a file changed since
     * its lines were picked, nothing is committed ([StaleSelectionException]).
     */
    public static CommitResult commit(
        File folder,
        String message,
        List<String> paths,
        Map<String, LineExclusion> excluded,
        Identity who
    ) throws IOException, GitAPIException {
        if (paths.isEmpty()) throw new IllegalArgumentException("Choose at least one file to commit");
        if (message == null || message.trim().isEmpty()) throw new IllegalArgumentException("A commit needs a summary");
        try (Git git = Git.open(folder)) {
            Repository repository = git.getRepository();
            clearStaleLocks(repository);
            excludePepino(repository);
            // Files with some (not all, not none) of their lines picked: committed as built from those lines.
            Map<String, Partial> partials = new TreeMap<>();
            List<String> stale = new ArrayList<>();
            List<String> whole = new ArrayList<>();
            for (String path : paths) {
                LineExclusion exclusion = excluded.get(path);
                if (exclusion == null || exclusion.lines().isEmpty()) {
                    whole.add(path);
                    continue;
                }
                Sides sides = sides(repository, folder, path);
                if (sides.tooLarge() || !sides.text() || !sides.version().equals(exclusion.version())) {
                    stale.add(path);
                    continue;
                }
                Changes changes = sides.changes();
                int total = changes.count();
                Set<Integer> lines = new HashSet<>();
                for (int line : exclusion.lines()) if (line >= 0 && line < total) lines.add(line);
                // Every line left out: the file is not part of this commit.
                if (lines.isEmpty()) whole.add(path);
                else if (lines.size() < total) {
                    partials.put(path, new Partial(partial(changes, lines), sides.mode()));
                }
            }
            if (!stale.isEmpty()) throw new StaleSelectionException(stale);
            // The index becomes the last commit plus exactly the chosen files.
            if (repository.resolve(Constants.HEAD) != null) {
                git.reset().call();
            } else {
                DirCache index = repository.lockDirCache();
                index.clear();
                index.write();
                index.commit();
            }
            for (String path : whole) {
                if (new File(folder, path).exists()) git.add().addFilepattern(path).call();
                else git.rm().setCached(true).addFilepattern(path).call();
            }
            if (!partials.isEmpty()) stage(repository, partials);
            PersonIdent ident = new PersonIdent(who.name(), who.email());
            try {
                RevCommit commit = git
                    .commit()
                    .setMessage(message.trim() + "\n")
                    .setAuthor(ident)
                    .setCommitter(ident)
                    .setAllowEmpty(false)
                    .call();
                return new CommitResult(commit.abbreviate(7).name(), commit.getShortMessage());
            } catch (EmptyCommitException e) {
                throw new IllegalArgumentException("Those files have no changes to commit");
            }
        }
    }

    /** A file committed with some of its lines: its content as built from them. */
    private record Partial(byte[] content, FileMode mode) {}

    /** Puts each partial file into the index, past the disk. */
    private static void stage(Repository repository, Map<String, Partial> partials) throws IOException {
        DirCache index = repository.lockDirCache();
        try (ObjectInserter inserter = repository.newObjectInserter()) {
            DirCacheEditor editor = index.editor();
            for (Map.Entry<String, Partial> entry : partials.entrySet()) {
                Partial partial = entry.getValue();
                ObjectId blob = inserter.insert(Constants.OBJ_BLOB, partial.content());
                editor.add(new DirCacheEditor.PathEdit(entry.getKey()) {
                    @Override
                    public void apply(DirCacheEntry ent) {
                        ent.setFileMode(partial.mode());
                        ent.setObjectId(blob);
                        ent.setLength(partial.content().length);
                    }
                });
            }
            inserter.flush();
            editor.commit();
        } finally {
            index.unlock();
        }
    }

    /** The local branches by name. A repository with no commits yet has just its unborn current branch. */
    /**
     * The commits reachable from HEAD, newest first: [limit] of them after
     * the first [skip]. None before the first commit.
     */
    public static List<LogEntry> log(File folder, int skip, int limit) throws IOException, GitAPIException {
        try (Git git = Git.open(folder)) {
            if (git.getRepository().resolve(Constants.HEAD) == null) return Collections.emptyList();
            List<LogEntry> entries = new ArrayList<>();
            for (RevCommit commit : git.log().setSkip(Math.max(0, skip)).setMaxCount(Math.max(1, limit)).call()) {
                String message = commit.getFullMessage().trim();
                int end = message.indexOf('\n');
                PersonIdent author = commit.getAuthorIdent();
                entries.add(new LogEntry(
                    commit.getName(),
                    (end < 0 ? message : message.substring(0, end)).trim(),
                    end < 0 ? "" : message.substring(end + 1).trim(),
                    author.getName(),
                    author.getEmailAddress(),
                    author.getWhen().getTime()
                ));
            }
            return entries;
        }
    }

    private static RevCommit parseCommit(Repository repository, RevWalk walk, String id) throws IOException {
        ObjectId objectId = id == null ? null : repository.resolve(id + "^{commit}");
        if (objectId == null) throw new IllegalArgumentException("No commit " + id);
        return walk.parseCommit(objectId);
    }

    /** The files [id] changed against its first parent (all new in a first commit), by path. */
    public static List<FileChange> commitChanges(File folder, String id) throws IOException {
        try (Git git = Git.open(folder); RevWalk walk = new RevWalk(git.getRepository()); TreeWalk trees = new TreeWalk(git.getRepository())) {
            Repository repository = git.getRepository();
            RevCommit commit = parseCommit(repository, walk, id);
            if (commit.getParentCount() > 0) trees.addTree(walk.parseCommit(commit.getParent(0)).getTree());
            else trees.addTree(new EmptyTreeIterator());
            trees.addTree(commit.getTree());
            trees.setRecursive(true);
            trees.setFilter(TreeFilter.ANY_DIFF);
            List<FileChange> changes = new ArrayList<>();
            for (DiffEntry entry : DiffEntry.scan(trees)) {
                switch (entry.getChangeType()) {
                    case ADD -> changes.add(new FileChange(entry.getNewPath(), "new"));
                    case DELETE -> changes.add(new FileChange(entry.getOldPath(), "deleted"));
                    default -> changes.add(new FileChange(entry.getNewPath(), "modified"));
                }
            }
            changes.sort((a, b) -> a.path().compareTo(b.path()));
            return changes;
        }
    }

    /** A file as a commit has it: nothing when it is not there; not text when it is a link or a submodule. */
    private record Blob(byte[] bytes, boolean text, boolean tooLarge) {
        static final Blob NONE = new Blob(new byte[0], true, false);
    }

    private static Blob blob(Repository repository, RevTree tree, String path) throws IOException {
        try (TreeWalk walk = TreeWalk.forPath(repository, path, tree)) {
            if (walk == null) return Blob.NONE;
            FileMode mode = walk.getFileMode(0);
            if (mode != FileMode.REGULAR_FILE && mode != FileMode.EXECUTABLE_FILE) return new Blob(new byte[0], false, false);
            ObjectLoader loader = repository.open(walk.getObjectId(0), Constants.OBJ_BLOB);
            if (loader.getSize() > DIFF_MAX_BYTES) return new Blob(new byte[0], true, true);
            return new Blob(loader.getCachedBytes(DIFF_MAX_BYTES), true, false);
        }
    }

    /** How [path] (repo-relative) changed in [id]: its first parent's version against the commit's. */
    public static FileDiff commitDiff(File folder, String id, String path) throws IOException {
        try (Git git = Git.open(folder); RevWalk walk = new RevWalk(git.getRepository())) {
            Repository repository = git.getRepository();
            RevCommit commit = parseCommit(repository, walk, id);
            Blob before = commit.getParentCount() > 0
                ? blob(repository, walk.parseCommit(commit.getParent(0)).getTree(), path)
                : Blob.NONE;
            Blob after = blob(repository, commit.getTree(), path);
            if (before.tooLarge() || after.tooLarge()) return new FileDiff("", false, true, Collections.emptyList());
            if (!before.text() || !after.text() || RawText.isBinary(before.bytes()) || RawText.isBinary(after.bytes())) {
                return new FileDiff("", true, false, Collections.emptyList());
            }
            return new FileDiff("", false, false, hunks(Changes.of(before.bytes(), after.bytes())));
        }
    }

    /**
     * Records the working tree as it is on disk (every file that is not
     * ignored, untracked ones too) as a snapshot on [SNAPSHOTS_REF], with
     * [reason] as its message. Nothing new is recorded when nothing changed
     * since the last one. The index, HEAD and the files are left as they are.
     * Returns the snapshot's id.
     */
    public static String snapshot(File folder, String reason) throws IOException {
        try (Git git = Git.open(folder)) {
            return snapshot(git.getRepository(), reason);
        }
    }

    private static String snapshot(Repository repository, String reason) throws IOException {
        clearStaleLocks(repository);
        excludePepino(repository);
        try (ObjectInserter inserter = repository.newObjectInserter(); RevWalk walk = new RevWalk(repository)) {
            ObjectId tree = workingTree(repository, inserter);
            Ref ref = repository.exactRef(SNAPSHOTS_REF);
            RevCommit last = ref == null ? null : walk.parseCommit(ref.getObjectId());
            if (last != null && last.getTree().equals(tree)) return last.getName();
            PersonIdent pepino = new PersonIdent("Pepino", "snapshots@pepino.dev");
            CommitBuilder commit = new CommitBuilder();
            commit.setTreeId(tree);
            if (last != null) commit.setParentId(last);
            commit.setAuthor(pepino);
            commit.setCommitter(pepino);
            commit.setMessage((reason == null || reason.trim().isEmpty() ? "Snapshot" : reason.trim()) + "\n");
            ObjectId id = inserter.insert(commit);
            inserter.flush();
            RefUpdate update = repository.updateRef(SNAPSHOTS_REF);
            update.setNewObjectId(id);
            update.setExpectedOldObjectId(last != null ? last : ObjectId.zeroId());
            update.disableRefLog();
            RefUpdate.Result result = update.update(walk);
            if (result != RefUpdate.Result.NEW && result != RefUpdate.Result.FAST_FORWARD) {
                throw new IOException("Cannot record the snapshot: " + result);
            }
            return id.getName();
        }
    }

    /**
     * The working tree as a tree object: files unchanged since the index
     * reuse its blobs, the others are written. Ignored files, [SNAPSHOT_SKIPPED]
     * folders and files over [SNAPSHOT_MAX_FILE_BYTES] are left out.
     */
    private static ObjectId workingTree(Repository repository, ObjectInserter inserter) throws IOException {
        DirCache tree = DirCache.newInCore();
        DirCacheBuilder builder = tree.builder();
        try (TreeWalk walk = new TreeWalk(repository)) {
            int disk = walk.addTree(new FileTreeIterator(repository));
            int index = walk.addTree(new DirCacheIterator(repository.readDirCache()));
            walk.setFilter(new NotIgnoredFilter(disk));
            while (walk.next()) {
                FileTreeIterator file = walk.getTree(disk, FileTreeIterator.class);
                if (file == null) continue; // only in the index: gone from disk
                if (walk.isSubtree()) {
                    if (!SNAPSHOT_SKIPPED.contains(walk.getNameString())) walk.enterSubtree();
                    continue;
                }
                FileMode mode = file.getEntryFileMode();
                if (mode == FileMode.GITLINK || file.getEntryLength() > SNAPSHOT_MAX_FILE_BYTES) continue;
                DirCacheIterator cached = walk.getTree(index, DirCacheIterator.class);
                ObjectId blob;
                if (cached != null && !file.isModified(cached.getDirCacheEntry(), true, walk.getObjectReader())) {
                    blob = cached.getEntryObjectId();
                } else {
                    try (InputStream content = file.openEntryStream()) {
                        blob = inserter.insert(Constants.OBJ_BLOB, file.getEntryContentLength(), content);
                    }
                }
                DirCacheEntry entry = new DirCacheEntry(walk.getPathString());
                entry.setFileMode(mode);
                entry.setObjectId(blob);
                builder.add(entry);
            }
        }
        builder.finish();
        return tree.writeTree(inserter);
    }

    /** The blob of [path] in [tree], or null when it is not there (or not a file). */
    private static ObjectId blobId(Repository repository, RevTree tree, String path) throws IOException {
        try (TreeWalk walk = TreeWalk.forPath(repository, path, tree)) {
            if (walk == null || (walk.getFileMode(0).getBits() & FileMode.TYPE_MASK) != FileMode.TYPE_FILE) return null;
            return walk.getObjectId(0);
        }
    }

    /**
     * The versions of [path] (repo-relative) in the snapshots, newest first:
     * a snapshot whose copy of the file is the same as the newer one's is the
     * same version and left out. At most [limit] of them.
     */
    public static List<SnapshotVersion> snapshotVersions(File folder, String path, int limit) throws IOException {
        try (Git git = Git.open(folder); RevWalk walk = new RevWalk(git.getRepository())) {
            Repository repository = git.getRepository();
            List<SnapshotVersion> versions = new ArrayList<>();
            Ref ref = repository.exactRef(SNAPSHOTS_REF);
            if (ref == null) return versions;
            walk.markStart(walk.parseCommit(ref.getObjectId()));
            ObjectId newer = null;
            int scanned = 0;
            for (RevCommit commit : walk) {
                if (++scanned > SNAPSHOTS_SCANNED || versions.size() >= limit) break;
                ObjectId blob = blobId(repository, commit.getTree(), path);
                if (blob != null && !blob.equals(newer)) {
                    versions.add(new SnapshotVersion(
                        commit.getName(),
                        commit.getFullMessage().trim(),
                        commit.getCommitterIdent().getWhen().getTime()
                    ));
                }
                newer = blob;
            }
            return versions;
        }
    }

    /** [path] (repo-relative) as snapshot [id] has it, as text; null when it is not there. */
    public static String snapshotFile(File folder, String id, String path) throws IOException {
        try (Git git = Git.open(folder); RevWalk walk = new RevWalk(git.getRepository())) {
            Repository repository = git.getRepository();
            ObjectId blob = blobId(repository, parseCommit(repository, walk, id).getTree(), path);
            if (blob == null) return null;
            return RawParseUtils.decode(repository.open(blob, Constants.OBJ_BLOB).getCachedBytes(SNAPSHOT_MAX_FILE_BYTES));
        }
    }

    public static List<Branch> branches(File folder) throws IOException, GitAPIException {
        try (Git git = Git.open(folder)) {
            String current = git.getRepository().getBranch();
            Map<String, Boolean> names = new TreeMap<>();
            for (Ref ref : git.branchList().call()) names.put(Repository.shortenRefName(ref.getName()), false);
            names.put(current, true);
            List<Branch> branches = new ArrayList<>();
            names.forEach((name, isCurrent) -> branches.add(new Branch(name, isCurrent)));
            // GitHub's branches not here yet (after a clone, all but the default one), as GitHub Desktop lists them
            String prefix = Constants.R_REMOTES + ORIGIN + "/";
            for (Ref ref : git.getRepository().getRefDatabase().getRefsByPrefix(prefix)) {
                String name = ref.getName().substring(prefix.length());
                if (!name.equals(Constants.HEAD) && !names.containsKey(name)) branches.add(new Branch(name, false, true));
            }
            return branches;
        }
    }

    /** Creates [name] at the current commit and switches to it; uncommitted changes come along. */
    public static RepoInfo createBranch(File folder, String name) throws IOException, GitAPIException {
        String branch = name == null ? "" : name.trim();
        if (!Repository.isValidRefName(Constants.R_HEADS + branch)) {
            throw new IllegalArgumentException("Not a valid branch name: " + branch);
        }
        try (Git git = Git.open(folder)) {
            Repository repository = git.getRepository();
            clearStaleLocks(repository);
            if (repository.resolve(Constants.HEAD) == null) {
                throw new IllegalStateException("Make the first commit before creating branches");
            }
            if (repository.exactRef(Constants.R_HEADS + branch) != null) {
                throw new IllegalArgumentException("There is already a branch named " + branch);
            }
            git.checkout().setCreateBranch(true).setName(branch).call();
            return info(repository);
        }
    }

    /**
     * Switches to [name]. Uncommitted changes come along when the two branches
     * agree on those files; when they do not, nothing changes and the conflict
     * names the files (commit them first). A branch only on GitHub
     * (origin/[name]) gets its local branch first, tracking it, like
     * `git checkout name`.
     */
    public static Switched checkout(File folder, String name) throws IOException, GitAPIException {
        try (Git git = Git.open(folder)) {
            Repository repository = git.getRepository();
            clearStaleLocks(repository);
            if (name.equals(repository.getBranch())) return new Switched(info(repository), Collections.emptyList(), Collections.emptyList());
            boolean local = repository.exactRef(Constants.R_HEADS + name) != null;
            String remote = Constants.R_REMOTES + ORIGIN + "/" + name;
            if (!local && repository.exactRef(remote) == null) {
                throw new IllegalArgumentException("No branch named " + name);
            }
            // The files are about to be rewritten: keep how they are first.
            snapshot(repository, "Before switching to " + name);
            CheckoutCommand checkout = git.checkout().setName(name);
            if (!local) {
                checkout.setCreateBranch(true).setStartPoint(remote).setUpstreamMode(CreateBranchCommand.SetupUpstreamMode.TRACK);
            }
            try {
                checkout.call();
            } catch (CheckoutConflictException e) {
                throw new ConflictException(e.getConflictingPaths());
            }
            return new Switched(
                info(repository),
                new ArrayList<>(checkout.getResult().getModifiedList()),
                new ArrayList<>(checkout.getResult().getRemovedList())
            );
        }
    }

    /** Deletes branch [name], never the current one; with commits on no other branch it needs [force]. */
    public static void deleteBranch(File folder, String name, boolean force) throws IOException, GitAPIException {
        try (Git git = Git.open(folder)) {
            clearStaleLocks(git.getRepository());
            if (name.equals(git.getRepository().getBranch())) {
                throw new IllegalArgumentException("Switch to another branch before deleting " + name);
            }
            if (git.getRepository().exactRef(Constants.R_HEADS + name) == null) {
                throw new IllegalArgumentException("No branch named " + name);
            }
            try {
                git.branchDelete().setBranchNames(Constants.R_HEADS + name).setForce(force).call();
            } catch (NotMergedException e) {
                throw new NotMergedBranchException(name);
            }
        }
    }

    /** The app's git identity, from its own git config file, or null until it is set. */
    public static Identity identity(File configFile) throws IOException {
        FileBasedConfig config = load(configFile);
        String name = config.getString("user", null, "name");
        String email = config.getString("user", null, "email");
        if (name == null || name.trim().isEmpty() || email == null || email.trim().isEmpty()) return null;
        return new Identity(name, email);
    }

    public static void setIdentity(File configFile, Identity identity) throws IOException {
        if (identity.name().trim().isEmpty() || identity.email().trim().isEmpty()) {
            throw new IllegalArgumentException("A name and an email are needed");
        }
        FileBasedConfig config = load(configFile);
        config.setString("user", null, "name", identity.name().trim());
        config.setString("user", null, "email", identity.email().trim());
        config.save();
    }

    private static FileBasedConfig load(File configFile) throws IOException {
        FileBasedConfig config = new FileBasedConfig(configFile, FS.DETECTED);
        try {
            config.load();
        } catch (ConfigInvalidException e) {
            throw new IOException("Damaged git config: " + configFile.getName(), e);
        }
        return config;
    }

    /** Keeps Pepino's own folder out of every change list, without touching the project's .gitignore. */
    /**
     * Removes the lock files a killed app left behind (`index.lock`,
     * `HEAD.lock`, a branch's `.lock`…). JGit writes through them and renames
     * them into place, so one still there when an operation starts belongs to
     * a write that never finished, and it would block every later one (Sprint
     * 3, criterion 3). Safe because Pepino is the only git on its files and
     * runs one operation at a time (GitPlugin's single git thread).
     */
    static void clearStaleLocks(Repository repository) {
        File dir = repository.getDirectory();
        for (String name : new String[] {"index.lock", "HEAD.lock", "config.lock", "packed-refs.lock"}) {
            new File(dir, name).delete();
        }
        deleteLocks(new File(dir, Constants.R_REFS));
    }

    private static void deleteLocks(File folder) {
        File[] children = folder.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (child.isDirectory()) deleteLocks(child);
            else if (child.getName().endsWith(".lock")) child.delete();
        }
    }

    private static void excludePepino(Repository repository) throws IOException {
        File exclude = new File(repository.getDirectory(), "info/exclude");
        String current = exclude.exists() ? new String(Files.readAllBytes(exclude.toPath()), StandardCharsets.UTF_8) : "";
        for (String line : current.split("\n")) {
            if (line.trim().equals(PEPINO_EXCLUDE)) return;
        }
        File parent = exclude.getParentFile();
        if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create " + parent);
        String separator = current.isEmpty() || current.endsWith("\n") ? "" : "\n";
        String text = current + separator + "# Pepino's own files (editor snapshots)\n" + PEPINO_EXCLUDE + "\n";
        Files.write(exclude.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }
}
