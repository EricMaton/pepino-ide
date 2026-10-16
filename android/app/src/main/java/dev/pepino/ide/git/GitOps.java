package dev.pepino.ide.git;

import java.io.File;
import java.io.IOException;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.errors.GitAPIException;
import org.eclipse.jgit.lib.Constants;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.lib.RepositoryCache;
import org.eclipse.jgit.util.FS;

/**
 * The git operations, on plain files and JGit only (no Android), so the JVM
 * unit tests run the same code as the phone (ADR-006). Paths are relative to
 * the project space root, like everywhere else in the app.
 */
public final class GitOps {

    /** The branch a new repository starts on. */
    public static final String DEFAULT_BRANCH = "main";

    /** What the UI shows about a repository. */
    public record RepoInfo(String branch, boolean hasCommits) {}

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
}
