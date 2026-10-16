package dev.pepino.ide.git;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
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
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.Status;
import org.eclipse.jgit.api.errors.CheckoutConflictException;
import org.eclipse.jgit.api.errors.EmptyCommitException;
import org.eclipse.jgit.api.errors.NotMergedException;
import org.eclipse.jgit.api.errors.GitAPIException;
import org.eclipse.jgit.diff.DiffAlgorithm;
import org.eclipse.jgit.diff.Edit;
import org.eclipse.jgit.diff.EditList;
import org.eclipse.jgit.diff.RawText;
import org.eclipse.jgit.diff.RawTextComparator;
import org.eclipse.jgit.dircache.DirCache;
import org.eclipse.jgit.dircache.DirCacheEditor;
import org.eclipse.jgit.dircache.DirCacheEntry;
import org.eclipse.jgit.errors.ConfigInvalidException;
import org.eclipse.jgit.lib.Constants;
import org.eclipse.jgit.lib.FileMode;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.lib.ObjectInserter;
import org.eclipse.jgit.lib.ObjectLoader;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.lib.Ref;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.lib.RepositoryCache;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.storage.file.FileBasedConfig;
import org.eclipse.jgit.treewalk.TreeWalk;
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

    /** A local branch; [current] is the one HEAD is on. */
    public record Branch(String name, boolean current) {}

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
     */
    public record DiffLine(String kind, String text, int oldLine, int newLine, int index, boolean noNewline) {}

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
    }

    /** A file in the last commit and on disk (empty where it is missing), and the mode to commit it with. */
    private record Sides(byte[] old, byte[] now, FileMode mode, boolean text, boolean tooLarge) {
        String version() {
            ObjectInserter.Formatter ids = new ObjectInserter.Formatter();
            return ids.idFor(Constants.OBJ_BLOB, old).name() + ":" + ids.idFor(Constants.OBJ_BLOB, now).name();
        }

        EditList edits() {
            return DiffAlgorithm.getAlgorithm(DiffAlgorithm.SupportedAlgorithm.HISTOGRAM)
                .diff(RawTextComparator.DEFAULT, new Lines(old), new Lines(now));
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
            return new FileDiff(sides.version(), false, false, hunks(new Lines(sides.old()), new Lines(sides.now()), sides.edits()));
        }
    }

    private static List<Hunk> hunks(Lines a, Lines b, EditList edits) {
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
                for (; ai < edit.getBeginA(); ai++, bi++) lines.add(context(a, ai, bi));
                for (; ai < edit.getEndA(); ai++) {
                    lines.add(new DiffLine("removed", a.text(ai), ai + 1, 0, index++, a.endsWithoutNewline(ai)));
                }
                for (; bi < edit.getEndB(); bi++) {
                    lines.add(new DiffLine("added", b.text(bi), 0, bi + 1, index++, b.endsWithoutNewline(bi)));
                }
            }
            for (; ai < aEnd; ai++, bi++) lines.add(context(a, ai, bi));
            int oldLines = aEnd - aStart;
            int newLines = bEnd - bStart;
            // git numbers an empty side by the line before it
            hunks.add(new Hunk(oldLines == 0 ? aStart : aStart + 1, oldLines, newLines == 0 ? bStart : bStart + 1, newLines, lines));
            first = last + 1;
        }
        return hunks;
    }

    private static DiffLine context(Lines a, int ai, int bi) {
        return new DiffLine("context", a.text(ai), ai + 1, bi + 1, -1, a.endsWithoutNewline(ai));
    }

    /**
     * The file as committed when [excluded] changed lines stay as they were:
     * a removed line left out is kept, an added line left out is not added.
     */
    private static byte[] partial(Lines a, Lines b, EditList edits, Set<Integer> excluded) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int ai = 0;
        int index = 0;
        for (Edit edit : edits) {
            copy(out, a, ai, edit.getBeginA());
            for (int k = edit.getBeginA(); k < edit.getEndA(); k++) {
                if (excluded.contains(index++)) copy(out, a, k, k + 1);
            }
            for (int k = edit.getBeginB(); k < edit.getEndB(); k++) {
                if (!excluded.contains(index++)) copy(out, b, k, k + 1);
            }
            ai = edit.getEndA();
        }
        copy(out, a, ai, a.size());
        return out.toByteArray();
    }

    private static void copy(ByteArrayOutputStream out, Lines text, int from, int to) {
        if (from >= to) return;
        // A last line without a break that is no longer last gets one.
        byte[] written = out.toByteArray();
        if (written.length > 0 && written[written.length - 1] != '\n') out.write('\n');
        out.write(text.getRawContent(), text.start(from), text.end(to - 1) - text.start(from));
    }

    private static int changedLines(EditList edits) {
        int count = 0;
        for (Edit edit : edits) count += edit.getLengthA() + edit.getLengthB();
        return count;
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
                EditList edits = sides.edits();
                int total = changedLines(edits);
                Set<Integer> lines = new HashSet<>();
                for (int line : exclusion.lines()) if (line >= 0 && line < total) lines.add(line);
                // Every line left out: the file is not part of this commit.
                if (lines.isEmpty()) whole.add(path);
                else if (lines.size() < total) {
                    partials.put(path, new Partial(partial(new Lines(sides.old()), new Lines(sides.now()), edits, lines), sides.mode()));
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
    public static List<Branch> branches(File folder) throws IOException, GitAPIException {
        try (Git git = Git.open(folder)) {
            String current = git.getRepository().getBranch();
            Map<String, Boolean> names = new TreeMap<>();
            for (Ref ref : git.branchList().call()) names.put(Repository.shortenRefName(ref.getName()), false);
            names.put(current, true);
            List<Branch> branches = new ArrayList<>();
            names.forEach((name, isCurrent) -> branches.add(new Branch(name, isCurrent)));
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
     * names the files (commit them first).
     */
    public static Switched checkout(File folder, String name) throws IOException, GitAPIException {
        try (Git git = Git.open(folder)) {
            Repository repository = git.getRepository();
            if (name.equals(repository.getBranch())) return new Switched(info(repository), Collections.emptyList(), Collections.emptyList());
            if (repository.exactRef(Constants.R_HEADS + name) == null) {
                throw new IllegalArgumentException("No branch named " + name);
            }
            CheckoutCommand checkout = git.checkout().setName(name);
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
