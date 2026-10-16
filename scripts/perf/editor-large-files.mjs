// Measures the editor with large files under CPU throttling (≈ a mid-range phone). See docs/performance.md.
//
//   npm run build && npx vite preview --port 4173      (in another terminal)
//   npm run perf:editor                                 (defaults: 10,5000,50000 lines, 4x CPU)
//   npm run perf:editor -- --lines 5000 --cpu 6 --url http://127.0.0.1:4173/
//
// Uses the Chrome installed on this machine (playwright-core, no browser download).
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
const url = args.url ?? 'http://127.0.0.1:4173/';
const sizes = (args.lines ?? '10,5000,50000').split(',').map(Number);
const cpu = Number(args.cpu ?? 4);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const cdp = await page.context().newCDPSession(page);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const button = (name) => page.getByRole('button', { name, exact: true });
const pause = (ms = 300) => page.waitForTimeout(ms);
const fileRow = (name) => page.getByRole('treeitem').getByRole('button', { name, exact: true });
const source = (lines) =>
  Array.from(
    { length: lines },
    (_, i) => `export function compute${i}(v: number): number { return v * ${i}; } // ${i + 1}`,
  ).join('\n');

/** Paste [text] the way a user would (CodeMirror's paste handler, one transaction). */
const paste = (text) =>
  page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document
      .querySelector('.cm-content')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);

/** requestAnimationFrame deltas while [action] runs; frames over 50 ms are visible jank. */
async function frames(action) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__stop = false;
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (!window.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await action();
  const deltas = await page.evaluate(() => {
    window.__stop = true;
    return window.__frames;
  });
  return { long: deltas.filter((d) => d > 50).length, worst: Math.round(Math.max(...deltas)) };
}

await page.goto(url);
await page.getByText('No projects yet').waitFor();
// A project is a folder: create it, then open it as the workspace (on its file tree).
await button('New file or folder').click();
await page.getByLabel('Name').fill('perf');
await button('Folder').click();
await button('Open perf as workspace').click();
await page.getByRole('tree', { name: 'Files' }).waitFor();
await pause();

const results = [];
for (const lines of sizes) {
  const name = `perf${lines}.ts`;
  await button('New file or folder').click();
  await page.getByLabel('Name').fill(name);
  await button('File').click(); // a new file opens right away
  await page.locator('.cm-content').waitFor();
  await page.locator('.cm-content').click();
  await paste(source(lines));
  await page.keyboard.press('Control+s');
  await page
    .getByRole('status')
    .filter({ hasText: /^saved$/i })
    .waitFor({ timeout: 60_000 });
  await button(`Close ${name}`).click(); // its tab: the tree shows again
  await pause(500);

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const opened = Date.now();
  await fileRow(name).click();
  await page.locator('.cm-line').first().waitFor();
  const openMs = Date.now() - opened;
  await pause(1500);

  const scroll = await frames(async () => {
    for (let step = 1; step <= 20; step++) {
      await page.evaluate((f) => {
        const scroller = document.querySelector('.cm-scroller');
        scroller.scrollTop = scroller.scrollHeight * f;
      }, step / 20);
      await page.waitForTimeout(50);
    }
  });

  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  const latencies = [];
  for (const char of 'const typed = 1;') {
    const start = Date.now();
    await page.keyboard.type(char);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    latencies.push(Date.now() - start);
  }
  latencies.sort((a, b) => a - b);
  const typing = await frames(() => page.keyboard.type('// more typing', { delay: 30 }));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  results.push({
    lines,
    'open (ms)': openMs,
    'scroll jumps: long frames': scroll.long,
    'scroll: worst frame (ms)': scroll.worst,
    'keystroke median (ms)': latencies[Math.floor(latencies.length / 2)],
    'keystroke worst (ms)': latencies[latencies.length - 1],
    'typing: long frames': typing.long,
  });
  await button(`Close ${name}`).click();
  await pause(1500);
}

console.log(`CPU throttling ${cpu}x, 390×844 viewport`);
console.table(results);
if (errors.length) console.log(`Page errors:\n${errors.join('\n')}`);
await browser.close();
