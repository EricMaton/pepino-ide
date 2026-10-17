package dev.pepino.ide.cli;

import java.io.File;
import java.io.FileDescriptor;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import org.eclipse.jgit.api.AddCommand;
import org.eclipse.jgit.api.CheckoutCommand;
import org.eclipse.jgit.api.CommitCommand;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.ListBranchCommand;
import org.eclipse.jgit.api.LogCommand;
import org.eclipse.jgit.api.MergeResult;
import org.eclipse.jgit.api.PullResult;
import org.eclipse.jgit.api.ResetCommand;
import org.eclipse.jgit.api.Status;
import org.eclipse.jgit.api.errors.GitAPIException;
import org.eclipse.jgit.diff.DiffEntry;
import org.eclipse.jgit.diff.DiffFormatter;
import org.eclipse.jgit.dircache.DirCacheIterator;
import org.eclipse.jgit.errors.RepositoryNotFoundException;
import org.eclipse.jgit.lib.Constants;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.lib.ObjectReader;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.lib.Ref;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.storage.file.FileRepositoryBuilder;
import org.eclipse.jgit.treewalk.AbstractTreeIterator;
import org.eclipse.jgit.treewalk.CanonicalTreeParser;
import org.eclipse.jgit.treewalk.FileTreeIterator;
import org.eclipse.jgit.treewalk.filter.PathFilterGroup;

/**
 * `git` in the terminal (#41): Android has no git, and a native one would
 * need curl and OpenSSL too, megabytes per ABI. This is the JGit the app
 * already ships, started from the shell with app_process (as Android's own
 * `am` and `pm` are): no bytes added to the APK, the same .gitconfig as the
 * GIT tab. The commands people use every day, with git's options and
 * output; remotes without a sign-in (the token stays in the app's Keystore:
 * pushing is the GIT tab's).
 */
public final class GitCli {

    /** What `git` without arguments, or `git help`, lists. */
    static final String USAGE = String.join(
        "\n",
        "usage: git <command> [<args>]   (Pepino's git: JGit, inside the app)",
        "",
        "  init                    create a repository here",
        "  status [-s]             what changed",
        "  diff [--staged] [<path>...]",
        "  add <path>... | -A      stage changes",
        "  rm [--cached] <path>...",
        "  restore [--staged] <path>...",
        "  commit -m <msg> [-a] [--amend]",
        "  log [--oneline] [-n <n>]",
        "  branch [-d|-D] [<name>]",
        "  switch [-c] <branch> | checkout [-b] <branch> | checkout -- <path>...",
        "  reset [--soft|--mixed|--hard] [<commit>]",
        "  stash [push|list|pop|apply|drop]",
        "  remote -v",
        "  fetch | pull | clone <url> [<dir>]   (public repositories)",
        "",
        "push, and anything signed in to GitHub, is in the GIT tab.",
        ""
    );

    /** Failures that end the command with a message and exit code 1 (git uses 128 for fatal ones). */
    static final class Failure extends Exception {
        final int code;

        Failure(String message, int code) {
            super(message);
            this.code = code;
        }
    }

    private final File cwd;
    private final PrintStream out;
    private final PrintStream err;
    private final boolean color;

    GitCli(File cwd, PrintStream out, PrintStream err, boolean color) {
        this.cwd = cwd;
        this.out = out;
        this.err = err;
        this.color = color;
    }

    public static void main(String[] args) throws java.io.UnsupportedEncodingException {
        // JGit reads the git config from the home folder: the app's, as the GIT tab's
        // (the shell's HOME is the projects, #161; the app's is PEPINO_HOME)
        String home = System.getenv("PEPINO_HOME");
        if (home == null) home = System.getenv("HOME");
        if (home != null) System.setProperty("user.home", home);
        // (PrintStream with a Charset is API 33; minSdk is 26)
        PrintStream out = new PrintStream(new java.io.FileOutputStream(FileDescriptor.out), true, "UTF-8");
        PrintStream err = new PrintStream(new java.io.FileOutputStream(FileDescriptor.err), true, "UTF-8");
        boolean color;
        try {
            color = android.system.Os.isatty(FileDescriptor.out);
        } catch (Throwable notAndroid) {
            color = false;
        }
        int code = new GitCli(new File(System.getProperty("user.dir", ".")), out, err, color).run(args);
        out.flush();
        err.flush();
        System.exit(code);
    }

    /** Runs `git [args]`; returns the exit code. */
    int run(String[] args) {
        try {
            if (args.length == 0 || args[0].equals("help") || args[0].equals("--help") || args[0].equals("-h")) {
                out.print(USAGE);
                return args.length == 0 ? 1 : 0;
            }
            if (args[0].equals("--version") || args[0].equals("version")) {
                out.println("git version 2 (Pepino's git: JGit 5.13, inside the app)");
                return 0;
            }
            List<String> rest = new ArrayList<>(Arrays.asList(args).subList(1, args.length));
            switch (args[0]) {
                case "init":
                    return init(rest);
                case "clone":
                    return cloneRepository(rest);
                default:
                    break;
            }
            try (Git git = open()) {
                switch (args[0]) {
                    case "status":
                        return status(git, rest);
                    case "diff":
                        return diff(git, rest);
                    case "add":
                        return add(git, rest);
                    case "rm":
                        return rm(git, rest);
                    case "restore":
                        return restore(git, rest);
                    case "commit":
                        return commit(git, rest);
                    case "log":
                        return log(git, rest);
                    case "branch":
                        return branch(git, rest);
                    case "switch":
                        return switchBranch(git, rest);
                    case "checkout":
                        return checkout(git, rest);
                    case "reset":
                        return reset(git, rest);
                    case "stash":
                        return stash(git, rest);
                    case "remote":
                        return remote(git, rest);
                    case "fetch":
                        return fetch(git);
                    case "pull":
                        return pull(git);
                    case "push":
                        throw new Failure("push needs your GitHub sign-in, which stays in the app: push from the GIT tab", 1);
                    default:
                        throw new Failure("'" + args[0] + "' is not a command Pepino's git has. See 'git help'.", 1);
                }
            }
        } catch (Failure failure) {
            err.println((failure.code == 128 ? "fatal: " : "error: ") + failure.getMessage());
            return failure.code;
        } catch (GitAPIException | IOException | RuntimeException e) {
            err.println("fatal: " + (e.getMessage() != null ? e.getMessage() : e.toString()));
            return 128;
        }
    }

    private String paint(String code, String text) {
        return color ? "\u001b[" + code + "m" + text + "\u001b[m" : text;
    }

    private Git open() throws IOException, Failure {
        FileRepositoryBuilder builder = new FileRepositoryBuilder().readEnvironment().findGitDir(cwd);
        if (builder.getGitDir() == null) {
            throw new Failure("not a git repository (or any of the parent directories): .git", 128);
        }
        try {
            return new Git(builder.build());
        } catch (RepositoryNotFoundException e) {
            throw new Failure("not a git repository: " + cwd, 128);
        }
    }

    /** Paths as given (relative to the current folder) as the repository's, '/'-separated. */
    private List<String> repoPaths(Repository repository, List<String> paths) throws IOException, Failure {
        File top = repository.getWorkTree().getCanonicalFile();
        List<String> result = new ArrayList<>();
        for (String path : paths) {
            File file = new File(cwd, path).getCanonicalFile();
            String relative = top.toPath().relativize(file.toPath()).toString().replace(File.separatorChar, '/');
            if (relative.startsWith("..")) throw new Failure(path + ": outside repository", 128);
            result.add(relative.isEmpty() ? "." : relative);
        }
        return result;
    }

    private static String option(List<String> args, String... names) {
        for (int i = 0; i < args.size(); i++) {
            for (String name : names) {
                if (args.get(i).equals(name) && i + 1 < args.size()) {
                    String value = args.get(i + 1);
                    args.remove(i + 1);
                    args.remove(i);
                    return value;
                }
                if (name.startsWith("--") && args.get(i).startsWith(name + "=")) {
                    String value = args.get(i).substring(name.length() + 1);
                    args.remove(i);
                    return value;
                }
            }
        }
        return null;
    }

    private static boolean flag(List<String> args, String... names) {
        boolean found = false;
        for (String name : names) found |= args.remove(name);
        return found;
    }

    private int init(List<String> args) throws GitAPIException {
        File folder = args.isEmpty() ? cwd : new File(cwd, args.get(0));
        boolean existed = new File(folder, Constants.DOT_GIT).exists();
        try (Git git = Git.init().setDirectory(folder).setInitialBranch("main").call()) {
            out.println((existed ? "Reinitialized existing" : "Initialized empty") + " Git repository in " + git.getRepository().getDirectory().getAbsolutePath() + "/");
        }
        return 0;
    }

    private int status(Git git, List<String> args) throws GitAPIException, IOException {
        boolean shortFormat = flag(args, "-s", "--short");
        Status status = git.status().call();
        Repository repository = git.getRepository();
        if (shortFormat) {
            Set<String> all = new TreeSet<>();
            all.addAll(status.getAdded());
            all.addAll(status.getChanged());
            all.addAll(status.getRemoved());
            all.addAll(status.getModified());
            all.addAll(status.getMissing());
            all.addAll(status.getConflicting());
            for (String path : all) {
                char staged = status.getAdded().contains(path) ? 'A' : status.getChanged().contains(path) ? 'M' : status.getRemoved().contains(path) ? 'D' : ' ';
                char worktree = status.getModified().contains(path) ? 'M' : status.getMissing().contains(path) ? 'D' : ' ';
                if (status.getConflicting().contains(path)) {
                    out.println(paint("31", "UU") + " " + path);
                    continue;
                }
                out.println(paint("32", String.valueOf(staged)) + paint("31", String.valueOf(worktree)) + " " + path);
            }
            for (String path : status.getUntracked()) out.println(paint("31", "??") + " " + path);
            return 0;
        }
        out.println("On branch " + repository.getBranch());
        if (repository.resolve(Constants.HEAD) == null) out.println("\nNo commits yet");
        Set<String> staged = new TreeSet<>();
        staged.addAll(status.getAdded());
        staged.addAll(status.getChanged());
        staged.addAll(status.getRemoved());
        if (!staged.isEmpty()) {
            out.println("\nChanges to be committed:");
            for (String path : staged) {
                String kind = status.getAdded().contains(path) ? "new file:   " : status.getRemoved().contains(path) ? "deleted:    " : "modified:   ";
                out.println("\t" + paint("32", kind + path));
            }
        }
        Set<String> conflicting = new TreeSet<>(status.getConflicting());
        if (!conflicting.isEmpty()) {
            out.println("\nUnmerged paths:");
            for (String path : conflicting) out.println("\t" + paint("31", "both modified:   " + path));
        }
        Set<String> unstaged = new TreeSet<>();
        unstaged.addAll(status.getModified());
        unstaged.addAll(status.getMissing());
        unstaged.removeAll(conflicting);
        if (!unstaged.isEmpty()) {
            out.println("\nChanges not staged for commit:");
            for (String path : unstaged) {
                String kind = status.getMissing().contains(path) ? "deleted:    " : "modified:   ";
                out.println("\t" + paint("31", kind + path));
            }
        }
        Set<String> untracked = new TreeSet<>(status.getUntracked());
        if (!untracked.isEmpty()) {
            out.println("\nUntracked files:");
            for (String path : untracked) out.println("\t" + paint("31", path));
        }
        if (staged.isEmpty() && unstaged.isEmpty() && untracked.isEmpty() && conflicting.isEmpty()) {
            out.println("nothing to commit, working tree clean");
        }
        return 0;
    }

    private int diff(Git git, List<String> args) throws IOException, Failure {
        boolean staged = flag(args, "--staged", "--cached");
        Repository repository = git.getRepository();
        List<String> paths = repoPaths(repository, args);
        try (ObjectReader reader = repository.newObjectReader(); DiffFormatter formatter = new DiffFormatter(new ColorDiff(out, color))) {
            formatter.setRepository(repository);
            if (!paths.isEmpty() && !paths.contains(".")) formatter.setPathFilter(PathFilterGroup.createFromStrings(paths));
            AbstractTreeIterator before;
            AbstractTreeIterator after;
            if (staged) {
                ObjectId head = repository.resolve(Constants.HEAD + "^{tree}");
                CanonicalTreeParser tree = new CanonicalTreeParser();
                if (head != null) tree.reset(reader, head);
                before = tree;
                after = new DirCacheIterator(repository.readDirCache());
            } else {
                before = new DirCacheIterator(repository.readDirCache());
                after = new FileTreeIterator(repository);
            }
            List<DiffEntry> entries = formatter.scan(before, after);
            formatter.format(entries);
            formatter.flush();
        }
        return 0;
    }

    private int add(Git git, List<String> args) throws GitAPIException, IOException, Failure {
        boolean all = flag(args, "-A", "--all");
        if (args.isEmpty() && !all) throw new Failure("Nothing specified, nothing added.", 1);
        List<String> paths = all ? java.util.Collections.singletonList(".") : repoPaths(git.getRepository(), args);
        AddCommand add = git.add();
        for (String path : paths) add.addFilepattern(path);
        add.call();
        // git add also stages deletions of the paths given
        AddCommand removed = git.add().setUpdate(true);
        for (String path : paths) removed.addFilepattern(path);
        removed.call();
        return 0;
    }

    private int rm(Git git, List<String> args) throws GitAPIException, IOException, Failure {
        boolean cached = flag(args, "--cached");
        flag(args, "-r", "-f");
        if (args.isEmpty()) throw new Failure("No pathspec was given. Which files should I remove?", 128);
        org.eclipse.jgit.api.RmCommand rm = git.rm().setCached(cached);
        for (String path : repoPaths(git.getRepository(), args)) {
            rm.addFilepattern(path);
            out.println("rm '" + path + "'");
        }
        rm.call();
        return 0;
    }

    private int restore(Git git, List<String> args) throws GitAPIException, IOException, Failure {
        boolean staged = flag(args, "--staged", "-S");
        if (args.isEmpty()) throw new Failure("you must specify path(s) to restore", 128);
        List<String> paths = repoPaths(git.getRepository(), args);
        if (staged) {
            org.eclipse.jgit.api.ResetCommand reset = git.reset();
            for (String path : paths) reset.addPath(path);
            reset.call();
        } else {
            CheckoutCommand checkout = git.checkout();
            for (String path : paths) checkout.addPath(path);
            checkout.call();
        }
        return 0;
    }

    private int commit(Git git, List<String> args) throws GitAPIException, Failure, IOException {
        String message = option(args, "-m", "--message");
        boolean all = flag(args, "-a", "--all");
        boolean amend = flag(args, "--amend");
        // -am "msg"
        if (message == null) {
            for (int i = 0; i < args.size(); i++) {
                if (args.get(i).equals("-am") && i + 1 < args.size()) {
                    all = true;
                    message = args.get(i + 1);
                }
            }
        }
        if (message == null && amend) message = git.getRepository().parseCommit(git.getRepository().resolve(Constants.HEAD)).getFullMessage();
        if (message == null || message.trim().isEmpty()) throw new Failure("Pepino's git has no editor: give the message with -m \"…\"", 1);
        if (git.status().call().getConflicting().size() > 0) throw new Failure("Committing is not possible because you have unmerged files.", 128);
        CommitCommand commit = git.commit().setMessage(message.endsWith("\n") ? message : message + "\n").setAll(all).setAmend(amend);
        try {
            RevCommit made = commit.setAllowEmpty(false).call();
            out.println("[" + git.getRepository().getBranch() + " " + made.abbreviate(7).name() + "] " + made.getShortMessage());
            return 0;
        } catch (org.eclipse.jgit.api.errors.EmptyCommitException e) {
            out.println("nothing to commit, working tree clean");
            return 1;
        } catch (org.eclipse.jgit.api.errors.NoHeadException | org.eclipse.jgit.api.errors.ServiceUnavailableException e) {
            throw new Failure(e.getMessage(), 128);
        }
    }

    private int log(Git git, List<String> args) throws GitAPIException, IOException, Failure {
        boolean oneline = flag(args, "--oneline");
        String count = option(args, "-n", "--max-count");
        for (String arg : new ArrayList<>(args)) {
            if (arg.matches("-\\d+")) {
                count = arg.substring(1);
                args.remove(arg);
            }
        }
        if (git.getRepository().resolve(Constants.HEAD) == null) {
            throw new Failure("your current branch '" + git.getRepository().getBranch() + "' does not have any commits yet", 128);
        }
        LogCommand log = git.log();
        if (count != null) log.setMaxCount(Integer.parseInt(count));
        SimpleDateFormat date = new SimpleDateFormat("EEE MMM d HH:mm:ss yyyy Z", Locale.US);
        boolean first = true;
        for (RevCommit commit : log.call()) {
            if (oneline) {
                out.println(paint("33", commit.abbreviate(7).name()) + " " + commit.getShortMessage());
                continue;
            }
            if (!first) out.println();
            first = false;
            PersonIdent author = commit.getAuthorIdent();
            out.println(paint("33", "commit " + commit.getName()));
            if (commit.getParentCount() > 1) {
                out.println("Merge: " + commit.getParent(0).abbreviate(7).name() + " " + commit.getParent(1).abbreviate(7).name());
            }
            out.println("Author: " + author.getName() + " <" + author.getEmailAddress() + ">");
            date.setTimeZone(author.getTimeZone());
            out.println("Date:   " + date.format(new Date(author.getWhen().getTime())));
            out.println();
            for (String line : commit.getFullMessage().trim().split("\n")) out.println("    " + line);
        }
        return 0;
    }

    private int branch(Git git, List<String> args) throws GitAPIException, IOException, Failure {
        boolean force = flag(args, "-D");
        boolean delete = flag(args, "-d", "--delete") || force;
        boolean all = flag(args, "-a", "--all");
        boolean remotes = flag(args, "-r", "--remotes");
        if (delete) {
            if (args.isEmpty()) throw new Failure("branch name required", 128);
            for (String name : args) {
                try {
                    git.branchDelete().setBranchNames(name).setForce(force).call();
                    out.println("Deleted branch " + name + ".");
                } catch (org.eclipse.jgit.api.errors.NotMergedException e) {
                    throw new Failure("The branch '" + name + "' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D " + name + "'.", 1);
                }
            }
            return 0;
        }
        if (!args.isEmpty()) {
            git.branchCreate().setName(args.get(0)).call();
            return 0;
        }
        ListBranchCommand list = git.branchList();
        if (all) list.setListMode(ListBranchCommand.ListMode.ALL);
        else if (remotes) list.setListMode(ListBranchCommand.ListMode.REMOTE);
        String current = git.getRepository().getFullBranch();
        for (Ref ref : list.call()) {
            String name = Repository.shortenRefName(ref.getName());
            if (ref.getName().equals(current)) out.println("* " + paint("32", name));
            else if (ref.getName().startsWith(Constants.R_REMOTES)) out.println("  " + paint("31", "remotes/" + name));
            else out.println("  " + name);
        }
        return 0;
    }

    private int switchBranch(Git git, List<String> args) throws GitAPIException, Failure, IOException {
        String create = option(args, "-c", "--create");
        if (create != null) return switchTo(git, create, true);
        if (args.isEmpty()) throw new Failure("missing branch or commit argument", 128);
        return switchTo(git, args.get(0), false);
    }

    private int checkout(Git git, List<String> args) throws GitAPIException, Failure, IOException {
        int separator = args.indexOf("--");
        if (separator >= 0) {
            List<String> paths = repoPaths(git.getRepository(), args.subList(separator + 1, args.size()));
            CheckoutCommand checkout = git.checkout();
            for (String path : paths) checkout.addPath(path);
            checkout.call();
            return 0;
        }
        String create = option(args, "-b");
        if (create != null) return switchTo(git, create, true);
        if (args.isEmpty()) throw new Failure("you must specify a branch", 128);
        return switchTo(git, args.get(0), false);
    }

    private int switchTo(Git git, String name, boolean create) throws GitAPIException, IOException {
        Repository repository = git.getRepository();
        CheckoutCommand checkout = git.checkout().setName(name).setCreateBranch(create);
        boolean remoteOnly = !create
            && repository.exactRef(Constants.R_HEADS + name) == null
            && repository.exactRef(Constants.R_REMOTES + "origin/" + name) != null;
        if (remoteOnly) {
            checkout
                .setCreateBranch(true)
                .setStartPoint("origin/" + name)
                .setUpstreamMode(org.eclipse.jgit.api.CreateBranchCommand.SetupUpstreamMode.TRACK);
        }
        try {
            checkout.call();
        } catch (org.eclipse.jgit.api.errors.CheckoutConflictException e) {
            err.println("error: Your local changes to the following files would be overwritten by checkout:");
            for (String path : e.getConflictingPaths()) err.println("\t" + path);
            err.println("Please commit your changes or stash them before you switch branches.");
            return 1;
        }
        if (remoteOnly) out.println("branch '" + name + "' set up to track 'origin/" + name + "'.");
        out.println((create ? "Switched to a new branch '" : "Switched to branch '") + name + "'");
        return 0;
    }

    private int reset(Git git, List<String> args) throws GitAPIException {
        ResetCommand.ResetType mode = ResetCommand.ResetType.MIXED;
        if (flag(args, "--hard")) mode = ResetCommand.ResetType.HARD;
        else if (flag(args, "--soft")) mode = ResetCommand.ResetType.SOFT;
        else flag(args, "--mixed");
        Ref ref = git.reset().setMode(mode).setRef(args.isEmpty() ? Constants.HEAD : args.get(0)).call();
        if (mode == ResetCommand.ResetType.HARD && ref != null) {
            try {
                RevCommit head = git.getRepository().parseCommit(ref.getObjectId());
                out.println("HEAD is now at " + head.abbreviate(7).name() + " " + head.getShortMessage());
            } catch (IOException e) {
                // Said anyway by the reset itself
            }
        }
        return 0;
    }

    private int stash(Git git, List<String> args) throws GitAPIException, Failure, IOException {
        String what = args.isEmpty() ? "push" : args.remove(0);
        switch (what) {
            case "push":
            case "save": {
                boolean untracked = flag(args, "-u", "--include-untracked");
                RevCommit stash = git.stashCreate().setIncludeUntracked(untracked).call();
                if (stash == null) out.println("No local changes to save");
                else out.println("Saved working directory and index state " + stash.getShortMessage());
                return 0;
            }
            case "list": {
                int index = 0;
                for (RevCommit stash : git.stashList().call()) out.println("stash@{" + index++ + "}: " + stash.getShortMessage());
                return 0;
            }
            case "pop":
            case "apply": {
                int index = args.isEmpty() ? 0 : stashIndex(args.get(0));
                if (!git.stashList().call().iterator().hasNext()) throw new Failure("No stash entries found.", 1);
                git.stashApply().setStashRef("stash@{" + index + "}").setRestoreUntracked(true).call();
                if (what.equals("pop")) {
                    git.stashDrop().setStashRef(index).call();
                    out.println("Dropped refs/stash@{" + index + "}");
                }
                return 0;
            }
            case "drop": {
                int index = args.isEmpty() ? 0 : stashIndex(args.get(0));
                git.stashDrop().setStashRef(index).call();
                out.println("Dropped refs/stash@{" + index + "}");
                return 0;
            }
            default:
                throw new Failure("'stash " + what + "' is not supported: push, list, pop, apply or drop", 1);
        }
    }

    private static int stashIndex(String ref) throws Failure {
        String digits = ref.replaceAll("^stash@\\{(\\d+)}$", "$1");
        if (!digits.matches("\\d+")) throw new Failure(ref + " is not a valid reference", 1);
        return Integer.parseInt(digits);
    }

    private int remote(Git git, List<String> args) throws Failure {
        if (!args.isEmpty() && !args.get(0).equals("-v")) throw new Failure("Pepino's git only lists remotes: git remote -v", 1);
        org.eclipse.jgit.lib.StoredConfig config = git.getRepository().getConfig();
        for (String name : config.getSubsections("remote")) {
            String url = config.getString("remote", name, "url");
            if (args.isEmpty()) out.println(name);
            else {
                out.println(name + "\t" + url + " (fetch)");
                out.println(name + "\t" + url + " (push)");
            }
        }
        return 0;
    }

    private int fetch(Git git) throws GitAPIException, Failure {
        try {
            git.fetch().setRemote("origin").setRemoveDeletedRefs(true).call();
            return 0;
        } catch (org.eclipse.jgit.api.errors.TransportException e) {
            throw new Failure(signInHint(e), 128);
        }
    }

    private int pull(Git git) throws GitAPIException, Failure {
        try {
            PullResult result = git.pull().setRemote("origin").call();
            MergeResult merge = result.getMergeResult();
            if (merge == null || merge.getMergeStatus().isSuccessful()) {
                out.println(merge != null && merge.getMergeStatus() == MergeResult.MergeStatus.ALREADY_UP_TO_DATE ? "Already up to date." : "Updated.");
                return 0;
            }
            err.println("CONFLICT: the merge left conflicts. Resolve them (here, or in the GIT tab), then commit.");
            return 1;
        } catch (org.eclipse.jgit.api.errors.TransportException e) {
            throw new Failure(signInHint(e), 128);
        }
    }

    private int cloneRepository(List<String> args) throws GitAPIException, Failure {
        if (args.isEmpty()) throw new Failure("You must specify a repository to clone.", 128);
        String url = args.get(0);
        String name = args.size() > 1 ? args.get(1) : url.replaceAll("/+$", "").replaceAll("\\.git$", "").replaceAll(".*/", "");
        File folder = new File(cwd, name);
        if (folder.exists() && folder.list() != null && folder.list().length > 0) {
            throw new Failure("destination path '" + name + "' already exists and is not an empty directory.", 128);
        }
        out.println("Cloning into '" + name + "'...");
        try (Git ignored = Git.cloneRepository().setURI(url).setDirectory(folder).call()) {
            return 0;
        } catch (org.eclipse.jgit.api.errors.TransportException e) {
            throw new Failure(signInHint(e), 128);
        }
    }

    /** A remote refused: private repositories need the sign-in, which only the GIT tab has. */
    private static String signInHint(Exception e) {
        String message = e.getMessage() != null ? e.getMessage() : e.toString();
        if (message.contains("not authorized") || message.contains("Authentication") || message.contains("401")) {
            return message + "\nPepino's git has no GitHub sign-in: use the GIT tab for private repositories and push.";
        }
        return message;
    }

    /** A diff as `git diff` colours it: headers bold, hunks cyan, removed red, added green. */
    private static final class ColorDiff extends java.io.OutputStream {
        private final PrintStream out;
        private final boolean color;
        private final java.io.ByteArrayOutputStream line = new java.io.ByteArrayOutputStream();

        ColorDiff(PrintStream out, boolean color) {
            this.out = out;
            this.color = color;
        }

        @Override
        public void write(int b) {
            if (b == '\n') {
                emit();
                return;
            }
            line.write(b);
        }

        private void emit() {
            String text = new String(line.toByteArray(), StandardCharsets.UTF_8);
            line.reset();
            if (!color) {
                out.println(text);
                return;
            }
            String code = text.startsWith("diff --git") || text.startsWith("index ") || text.startsWith("--- ") || text.startsWith("+++ ")
                ? "1"
                : text.startsWith("@@") ? "36" : text.startsWith("+") ? "32" : text.startsWith("-") ? "31" : null;
            out.println(code == null ? text : "\u001b[" + code + "m" + text + "\u001b[m");
        }

        @Override
        public void flush() {
            if (line.size() > 0) emit();
            out.flush();
        }
    }
}
