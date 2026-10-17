import { describe, expect, it } from 'vitest';
import { createSandbox, DEFAULT_SANDBOX_OPTIONS, type SandboxHost } from '../../features/plugins/sandbox';
import main from './main.js?raw';

/*
 * The snippets plugin (#53) as the app runs it, its main.js in the sandbox,
 * with a host that plays the editor, the user and the storage.
 */
function setUp(path: string) {
  const state = {
    path,
    selection: '',
    storage: {} as Record<string, unknown>,
    snippets: [] as string[],
    messages: [] as string[],
    /** What the quick pick offered last. */
    offered: [] as { label: string; detail?: string }[],
    title: '' as string | undefined,
    choose: (items: { label: string }[]): number | null => (items.length ? 0 : null),
    name: 'my snippet' as string | null,
  };
  const host: SandboxHost = {
    async call(method, args) {
      switch (method) {
        case 'editor.getPath':
          return state.path;
        case 'editor.getSelection':
          return state.selection;
        case 'editor.insertSnippet':
          state.snippets.push(String(args[0]));
          return undefined;
        case 'window.showMessage':
          state.messages.push(String(args[0]));
          return undefined;
        case 'window.showQuickPick': {
          state.offered = args[0] as { label: string; detail?: string }[];
          state.title = (args[1] as { title?: string }).title;
          return state.choose(state.offered);
        }
        case 'window.showInput':
          return state.name;
        case 'storage.get':
          return state.storage[String(args[0])] ?? null;
        case 'storage.set':
          state.storage[String(args[0])] = args[1];
          return undefined;
      }
      throw new Error(`No ${method} here`);
    },
    log: () => undefined,
  };
  const run = async (command: string) => {
    const sandbox = await createSandbox(main, {}, host, DEFAULT_SANDBOX_OPTIONS);
    try {
      await sandbox.activate();
      await sandbox.runCommand(command);
    } finally {
      sandbox.dispose();
    }
  };
  return { state, run };
}

describe('snippets plugin (#53)', () => {
  it('offers the open file’s language’s snippets, and inserts the one chosen', async () => {
    const { state, run } = setUp('app/src/main.ts');
    state.choose = (items) => items.findIndex((item) => item.label === 'interface');
    await run('insert');

    expect(state.title).toBe('TypeScript snippets');
    expect(state.offered[0]).toEqual({ label: 'console.log', detail: 'console.log();' });
    expect(state.snippets).toEqual(['interface $0 {\n\t\n}']);
  });

  it('dismissed, inserts nothing; for a file with none of its own, says how to make one', async () => {
    const dismissed = setUp('a.css');
    dismissed.state.choose = () => null;
    await dismissed.run('insert');
    expect(dismissed.state.snippets).toEqual([]);

    const unknown = setUp('notes.txt');
    await unknown.run('insert');
    expect(unknown.state.messages).toEqual(['No snippets for this file yet: select some code and save it as one']);
  });

  it('saves the selection, its shared indent dropped and its own as tabs, and offers it first', async () => {
    const { state, run } = setUp('app/a.js');
    state.selection = '    if (ok) {\n        go();\n    }\n';
    state.name = '  if ok ';
    await run('save');

    expect(state.storage.snippets).toEqual([{ name: 'if ok', language: 'javascript', body: 'if (ok) {\n\tgo();\n}' }]);
    expect(state.messages).toEqual(['Saved "if ok" for JavaScript: Insert snippet offers it']);

    await run('insert');
    expect(state.offered[0]).toEqual({ label: 'if ok', detail: 'Mine · if (ok) {' });
    expect(state.snippets).toEqual(['if (ok) {\n\tgo();\n}']);

    // Not offered in another language
    state.path = 'app/a.py';
    await run('insert');
    expect(state.offered.map((item) => item.label)).not.toContain('if ok');
  });

  it('needs a selection to save, and a name', async () => {
    const empty = setUp('a.js');
    await empty.run('save');
    expect(empty.state.messages).toEqual(['Select the code to save first']);

    const unnamed = setUp('a.js');
    unnamed.state.selection = 'x';
    unnamed.state.name = null;
    await unnamed.run('save');
    expect(unnamed.state.storage).toEqual({});
  });

  it('deletes one of your own', async () => {
    const { state, run } = setUp('a.js');
    state.storage.snippets = [
      { name: 'a', language: 'javascript', body: 'a()' },
      { name: 'b', language: null, body: 'b()' },
    ];
    state.choose = () => 1;
    await run('delete');

    expect(state.offered).toEqual([
      { label: 'a', detail: 'JavaScript · a()' },
      { label: 'b', detail: 'Any file · b()' },
    ]);
    expect(state.storage.snippets).toEqual([{ name: 'a', language: 'javascript', body: 'a()' }]);
    expect(state.messages).toEqual(['Deleted "b"']);
  });
});
