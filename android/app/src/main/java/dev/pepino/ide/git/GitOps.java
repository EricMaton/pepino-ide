package dev.pepino.ide.git;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.eclipse.jgit.api.CheckoutCommand;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.Status;
import org.eclipse.jgit.api.errors.CheckoutConflictException;
import org.eclipse.jgit.api.errors.EmptyCommitException;
import org.eclipse.jgit.api.errors.NotMergedException;
import org.eclipse.jgit.api.errors.GitAPIException;
import org.eclipse.jgit.dircache.DirCache;
import org.eclipse.jgit.errors.ConfigInvalidException;
import org.eclipse.jgit.lib.Constants;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.lib.Ref;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.lib.RepositoryCache;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.storage.file.FileBasedConfig;
import org.eclipse.jgit.util.FS;

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

    /**
     * Commits exactly [paths] (as they are on disk; a missing one is a
     * deletion) with [message], as [who]. Anything staged before is left out.
     * JGit writes through `.lock` files and renames, so a crash mid-commit
     * leaves the previous commit intact (Sprint 3, criterion 3).
     */
    public static CommitResult commit(File folder, String message, List<String> paths, Identity who)
        throws IOException, GitAPIException {
        if (paths.isEmpty()) throw new IllegalArgumentException("Choose at least one file to commit");
        if (message == null || message.trim().isEmpty()) throw new IllegalArgumentException("A commit needs a summary");
        try (Git git = Git.open(folder)) {
            Repository repository = git.getRepository();
            excludePepino(repository);
            // The index becomes the last commit plus exactly the chosen files.
            if (repository.resolve(Constants.HEAD) != null) {
                git.reset().call();
            } else {
                DirCache index = repository.lockDirCache();
                index.clear();
                index.write();
                index.commit();
            }
            for (String path : paths) {
                if (new File(folder, path).exists()) git.add().addFilepattern(path).call();
                else git.rm().setCached(true).addFilepattern(path).call();
            }
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
