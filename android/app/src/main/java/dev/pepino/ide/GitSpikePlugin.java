package dev.pepino.ide;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileWriter;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.Status;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.util.FileUtils;

/** Spike #21: the same git operations as the isomorphic-git bench, in JGit, under filesDir/projects/spike-jgit. */
@CapacitorPlugin(name = "GitSpike")
public class GitSpikePlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private interface Work {
        Object run(JSObject result) throws Exception;
    }

    private File root() {
        return new File(getContext().getFilesDir(), "projects/spike-jgit");
    }

    /** Runs [work] off the bridge thread and reports wall time and the Java heap's peak while it ran. */
    private void measure(PluginCall call, Work work) {
        executor.execute(() -> {
            Runtime runtime = Runtime.getRuntime();
            runtime.gc();
            long before = runtime.totalMemory() - runtime.freeMemory();
            AtomicLong peak = new AtomicLong(before);
            Thread sampler = new Thread(() -> {
                while (!Thread.currentThread().isInterrupted()) {
                    peak.accumulateAndGet(runtime.totalMemory() - runtime.freeMemory(), Math::max);
                    try {
                        Thread.sleep(100);
                    } catch (InterruptedException e) {
                        return;
                    }
                }
            });
            sampler.start();
            long start = System.nanoTime();
            try {
                JSObject result = new JSObject();
                Object value = work.run(result);
                result.put("ms", (System.nanoTime() - start) / 1_000_000);
                result.put("heapPeakMb", (peak.get() - before) / 1_000_000);
                if (value != null) result.put("result", value);
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.toString(), e);
            } finally {
                sampler.interrupt();
            }
        });
    }

    @PluginMethod
    public void wipe(PluginCall call) {
        measure(call, (result) -> {
            if (root().exists()) FileUtils.delete(root(), FileUtils.RECURSIVE);
            return null;
        });
    }

    @PluginMethod
    public void clone(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name");
        String branch = "refs/heads/" + call.getString("branch", "main");
        measure(call, (result) -> {
            root().mkdirs();
            try (
                Git git = Git.cloneRepository()
                    .setURI(url)
                    .setDirectory(new File(root(), name))
                    .setDepth(1)
                    .setBranchesToClone(Collections.singletonList(branch))
                    .setBranch(branch)
                    .call()
            ) {
                return git.getRepository().resolve("HEAD").name();
            }
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        String name = call.getString("name");
        measure(call, (result) -> {
            try (Git git = Git.open(new File(root(), name))) {
                Status status = git.status().call();
                return status.getModified().toString();
            }
        });
    }

    /** Appends a line to [file], then stages it and commits, timing each step. */
    @PluginMethod
    public void editAndCommit(PluginCall call) {
        String name = call.getString("name");
        String file = call.getString("file");
        measure(call, (result) -> {
            try (Git git = Git.open(new File(root(), name))) {
                try (FileWriter writer = new FileWriter(new File(new File(root(), name), file), true)) {
                    writer.write("\n// edited by the spike " + System.currentTimeMillis() + "\n");
                }
                long t = System.nanoTime();
                Status status = git.status().call();
                result.put("statusMs", (System.nanoTime() - t) / 1_000_000);
                result.put("modified", status.getModified().toString());
                t = System.nanoTime();
                git.add().addFilepattern(file).call();
                result.put("addMs", (System.nanoTime() - t) / 1_000_000);
                t = System.nanoTime();
                PersonIdent author = new PersonIdent("Pepino Spike", "spike@pepino.dev");
                RevCommit commit = git.commit().setMessage("spike: edit one file").setAuthor(author).setCommitter(author).call();
                result.put("commitMs", (System.nanoTime() - t) / 1_000_000);
                return commit.name();
            }
        });
    }
}
