const CONSECUTIVE = 5;
const WORD_START = 4;
const IN_NAME = 2;

/**
 * fzf-style score of [query] against [path], or null when the query's
 * characters do not all appear in order. Picks the best alignment (dynamic
 * programming, not the first occurrence of each letter): consecutive
 * characters, characters starting a word (after `/ . _ -` or a lower→upper
 * camelCase step) and characters in the file name weigh more; shorter paths
 * win ties.
 */
export function fuzzyScore(query: string, path: string): number | null {
  const needle = query.replace(/\s+/g, '').toLowerCase();
  if (!needle) return 0;
  const haystack = path.toLowerCase();
  const length = path.length;
  const nameStart = path.lastIndexOf('/') + 1;

  const bonus = new Float64Array(length);
  for (let j = 0; j < length; j++) {
    const before = path[j - 1];
    const camelStep = before !== undefined && before === haystack[j - 1] && path[j] !== haystack[j];
    const wordStart = j === 0 || '/._-'.includes(before) || camelStep;
    bonus[j] = 1 + (wordStart ? WORD_START : 0) + (j >= nameStart ? IN_NAME : 0);
  }

  // best[j]: best score with the current query character matched at j (-Infinity = impossible).
  let best = new Float64Array(length).fill(-Infinity);
  for (let j = 0; j < length; j++) if (haystack[j] === needle[0]) best[j] = bonus[j];

  for (let i = 1; i < needle.length; i++) {
    const next = new Float64Array(length).fill(-Infinity);
    let bestBefore = -Infinity; // max of best[k] for k < j - 1
    for (let j = 1; j < length; j++) {
      if (j >= 2) bestBefore = Math.max(bestBefore, best[j - 2]);
      if (haystack[j] !== needle[i]) continue;
      const fromGap = bestBefore;
      const fromNeighbour = best[j - 1] + CONSECUTIVE;
      const previous = Math.max(fromGap, fromNeighbour);
      if (previous !== -Infinity) next[j] = previous + bonus[j];
    }
    best = next;
  }

  const top = Math.max(...best);
  return top === -Infinity ? null : top - length * 0.01;
}

/** The best [limit] paths for [query], best first. */
export function fuzzyFind(query: string, paths: readonly string[], limit = 50): string[] {
  const scored: Array<{ path: string; score: number }> = [];
  for (const path of paths) {
    const score = fuzzyScore(query, path);
    if (score !== null) scored.push({ path, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ path }) => path);
}
