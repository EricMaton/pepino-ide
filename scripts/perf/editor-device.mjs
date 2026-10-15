// Measures the editor with large files inside the app's Android WebView, over the DevTools protocol.
// Same steps as editor-large-files.mjs, but timed inside the page so adb's round trips don't count.
// See docs/performance.md.
//
//   adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof dev.pepino.ide)
//   npm run perf:editor:device                                  (defaults: 10,5000,50000 lines)
//   npm run perf:editor:device -- --lines 5000 --port 9222
//
// The app must be on the editor or the explorer of a debug build. It creates a "perf-device"
// project, measures, and deletes the project again.
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
const port = Number(args.port ?? 9222);
const sizes = (args.lines ?? '10,5000,50000').split(',').map(Number);
const project = 'perf-device';

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve));
let lastId = 0;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++lastId;
    const onMessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id !== id) return;
      socket.removeEventListener('message', onMessage);
      if (data.error) reject(new Error(`${method}: ${data.error.message}`));
      else resolve(data.result);
    };
    socket.addEventListener('message', onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });

/** Runs [fn](arg) in the page, with the helpers below in scope, and returns its value. */
async function run(fn, arg) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: `(async () => { ${pageHelpers}; return (${fn})(${JSON.stringify(arg)}); })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

const pageHelpers = String.raw`
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (test, timeout = 10000) => {
    for (const end = performance.now() + timeout; performance.now() < end; await frame()) {
      const value = test();
      if (value) return value;
    }
    throw new Error('Timed out waiting for ' + test);
  };
  const buttonText = (b) => (b.getAttribute('aria-label') || b.textContent).replace(/\s+/g, ' ').trim();
  const button = (name, exact = true) =>
    [...document.querySelectorAll('button')].find((b) => (exact ? buttonText(b) === name : buttonText(b).includes(name)));
  const click = async (name, exact) => (await waitFor(() => button(name, exact))).click();
  const view = () => document.querySelector('.cm-content')?.cmTile?.view;
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Types [text] the way a soft keyboard commits it (IME insertText), one character at a time. */
async function type(text, delay = 50) {
  for (const char of text) {
    await send('Input.insertText', { text: char });
    await sleep(delay);
  }
}
const enter = async () => {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
};
/** Creates [name] in the folder the explorer shows; the create dialog focuses its Name field. */
async function create(name, kind) {
  await run(() => click('New file or folder'));
  await run(() => waitFor(() => document.activeElement?.tagName === 'INPUT'));
  await type(name, 10);
  if (kind) await run((label) => click(label), kind);
  else await enter();
  await sleep(600);
}
/** Back to the list of projects, from the editor or from inside a project. */
async function toProjects() {
  await run(async () => {
    if (button('Close file')) await click('Close file');
    await sleep(400);
    if (button('Close project')) await click('Close project');
    await sleep(400);
    const crumbs = () => document.querySelectorAll('nav[aria-label="Location"] button');
    if (crumbs().length > 1) crumbs()[0].click(); // the breadcrumb's root, ~
    await waitFor(() => button('New file or folder') && crumbs().length === 1);
    await sleep(400);
  });
}
async function deleteProject() {
  const exists = await run((name) => !!button(`Actions for ${name}`), project);
  if (!exists) return;
  await run(async (name) => {
    await click(`Actions for ${name}`);
    await click('Delete', false);
    await sleep(300);
    // The confirmation dialog's button is the last "Delete" on the page.
    const buttons = [...document.querySelectorAll('button')].filter((b) => buttonText(b) === 'Delete');
    buttons[buttons.length - 1].click();
    await waitFor(() => !button('Actions for ' + name));
  }, project);
}

const device = await run(() => ({
  agent: navigator.userAgent.match(/Android [\d.]+|Chrome\/[\d.]+/g).join(', '),
  screen: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
}));
await toProjects();
await deleteProject();
await create(project); // a new project opens right away
await run(async () => !!(await waitFor(() => button('Close project'))));

const results = [];
for (const lines of sizes) {
  const name = `perf${lines}.ts`;
  await create(name, 'File');
  await run((file) => click(file, false), name);
  await run(async () => !!(await waitFor(() => view())));

  // Paste the code as one transaction, as CodeMirror's paste handler does, and wait for the save.
  // Not a synthetic paste event: with the soft keyboard open, Android's DOM observer can apply it twice.
  const pasted = await run(async (count) => {
    const text = Array.from(
      { length: count },
      (_, i) => `export function compute${i}(v: number): number { return v * ${i}; } // ${i + 1}`,
    ).join('\n');
    if (view().state.doc.length > 0) throw new Error('the new file is not empty');
    const start = performance.now();
    view().dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.paste' });
    await frame();
    const pasteMs = performance.now() - start;
    await waitFor(() => document.querySelector('[role="status"]')?.textContent === 'Saved', 60000);
    return { pasteMs, lines: view().state.doc.lines };
  }, lines);
  if (pasted.lines !== lines) throw new Error(`pasted ${pasted.lines} lines, expected ${lines}`);
  await run(() => click('Close file'));
  await sleep(800);

  // Open: from the tap on the row to the first painted line.
  const openMs = await run(async (file) => {
    await waitFor(() => !document.querySelector('.cm-editor'), 30000);
    const row = await waitFor(() => button(file, false));
    await sleep(300);
    const start = performance.now();
    row.click();
    await waitFor(() => document.querySelector('.cm-line'));
    await frame();
    return performance.now() - start;
  }, name);
  await sleep(1500);
  const opened = await run(() => view()?.state.doc.lines);
  if (opened !== lines) throw new Error(`opened ${opened} lines, expected ${lines}`);

  // Scroll in jumps of 5% of the document; frames over 50 ms are visible jank.
  const scroll = await run(async () => {
    const scroller = document.querySelector('.cm-scroller');
    const deltas = [];
    let last = performance.now();
    let stop = false;
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    for (let step = 1; step <= 20; step++) {
      scroller.scrollTop = (scroller.scrollHeight * step) / 20;
      await sleep(50);
    }
    await frame();
    stop = true;
    return { long: deltas.filter((d) => d > 50).length, worst: Math.max(...deltas) };
  });

  // Keystrokes at the end of the file: from the input event to the frame that shows it.
  await run(() => {
    const v = view();
    v.focus();
    v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true });
    window.__latencies = [];
    window.__frames = [];
    v.contentDOM.addEventListener('beforeinput', () => {
      const start = performance.now();
      requestAnimationFrame(() => setTimeout(() => window.__latencies.push(performance.now() - start)));
    });
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (!window.__stopFrames) requestAnimationFrame(tick);
    };
    window.__stopFrames = false;
    requestAnimationFrame(tick);
  });
  await sleep(300);
  await type('const typed = 1; // more typing', 60);
  const typing = await run(async () => {
    await sleep(200);
    window.__stopFrames = true;
    const latencies = [...window.__latencies].sort((a, b) => a - b);
    return {
      count: latencies.length,
      median: latencies[Math.floor(latencies.length / 2)],
      worst: latencies[latencies.length - 1],
      long: window.__frames.filter((d) => d > 50).length,
      typed: view().state.doc.line(view().state.doc.lines).text,
    };
  });
  if (!typing.typed.endsWith('const typed = 1; // more typing')) throw new Error(`typed text missing: ${typing.typed}`);

  results.push({
    lines,
    'paste (ms)': Math.round(pasted.pasteMs),
    'open (ms)': Math.round(openMs),
    'scroll jumps: long frames': scroll.long,
    'scroll: worst frame (ms)': Math.round(scroll.worst),
    'keystroke median (ms)': Math.round(typing.median),
    'keystroke worst (ms)': Math.round(typing.worst),
    'typing: long frames': typing.long,
  });
  await run(() => click('Close file'));
  await sleep(1500);
}

await toProjects();
await deleteProject();
console.log(`${device.agent}, ${device.screen}`);
console.table(results);
socket.close();
