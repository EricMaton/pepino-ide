// Spike #21: measurements of isomorphic-git in the app's WebView, driven over DevTools as window.__gitSpike.
import { Buffer } from 'buffer';
import git from 'isomorphic-git';
import { counters, createCapacitorGitFs } from './capacitorFs';
import { capacitorHttp, httpStats } from './capacitorHttp';

(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;

interface Options {
  readThroughWebView?: boolean;
  statCache?: boolean;
}

const author = { name: 'Pepino Spike', email: 'spike@pepino.dev' };

/** Runs [work] and reports wall time, bridge calls and the JS heap's peak while it ran. */
async function measure<T>(work: () => Promise<T>) {
  counters.calls = {};
  counters.bridgeMs = 0;
  httpStats.requests = 0;
  httpStats.bytesIn = 0;
  httpStats.ms = 0;
  const heap = () => (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
  const before = heap();
  let peak = before;
  const sampler = setInterval(() => (peak = Math.max(peak, heap())), 100);
  const start = performance.now();
  try {
    const result = await work();
    return {
      ms: Math.round(performance.now() - start),
      bridgeMs: Math.round(counters.bridgeMs),
      calls: { ...counters.calls },
      http: { requests: httpStats.requests, mb: +(httpStats.bytesIn / 1e6).toFixed(1), ms: Math.round(httpStats.ms) },
      heapPeakMb: +((peak - before) / 1e6).toFixed(1),
      result,
    };
  } finally {
    clearInterval(sampler);
  }
}

function setup(options: Options = {}) {
  return createCapacitorGitFs({
    readThroughWebView: options.readThroughWebView ?? true,
    statCache: options.statCache ?? true,
  });
}

export const gitSpike = {
  async wipe() {
    await setup().wipe();
  },

  async clone(url: string, name: string, options: Options = {}) {
    const fs = setup(options);
    await fs.ensureRoot();
    const phases: Array<[string, number]> = [];
    const start = performance.now();
    return measure(async () => {
      await git.clone({
        fs,
        http: capacitorHttp,
        dir: `/${name}`,
        url,
        depth: 1,
        singleBranch: true,
        onProgress: ({ phase }) => {
          if (phases[phases.length - 1]?.[0] !== phase) phases.push([phase, Math.round(performance.now() - start)]);
        },
      });
      return { phases };
    });
  },

  async init(name: string) {
    const fs = setup();
    await fs.ensureRoot();
    return measure(() => git.init({ fs, dir: `/${name}` }));
  },

  async status(name: string, options: Options = {}) {
    const fs = setup(options);
    return measure(async () => {
      const matrix = await git.statusMatrix({ fs, dir: `/${name}` });
      const changed = matrix.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1));
      return { files: matrix.length, changed: changed.map(([path]) => path).slice(0, 10) };
    });
  },

  /** Appends a line to [file], then stages it and commits. */
  async editAndCommit(name: string, file: string, options: Options = {}) {
    const fs = setup(options);
    const dir = `/${name}`;
    const text = (await fs.promises.readFile(`${dir}/${file}`, 'utf8')) as string;
    await fs.promises.writeFile(`${dir}/${file}`, `${text}\n// edited by the spike ${Date.now()}\n`);
    const status = await gitSpike.status(name, options);
    const add = await measure(() => git.add({ fs, dir, filepath: file }));
    const commit = await measure(() => git.commit({ fs, dir, message: 'spike: edit one file', author }));
    return { status, add, commit };
  },

  async log(name: string) {
    const fs = setup();
    return measure(async () => (await git.log({ fs, dir: `/${name}`, depth: 5 })).map((entry) => entry.commit.message));
  },
};

(window as { __gitSpike?: typeof gitSpike }).__gitSpike = gitSpike;
