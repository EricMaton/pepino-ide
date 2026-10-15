import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../core/storage';
import { createSessionStore, EMPTY_SESSION, MAX_EDITOR_STATES, parseSession, withEditorState } from './session';

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
  };
}

describe('parseSession', () => {
  it('returns an empty session for missing or corrupt data', () => {
    expect(parseSession(null)).toEqual(EMPTY_SESSION);
    expect(parseSession('{nope')).toEqual(EMPTY_SESSION);
    expect(parseSession('[1,2]')).toEqual(EMPTY_SESSION);
  });

  it('keeps valid fields and drops malformed ones', () => {
    const raw = JSON.stringify({
      project: 'app',
      explorer: { app: ['app', 'app/src'], bad: [1], empty: [] },
      openFile: 42,
      openFiles: { app: ['app/a.ts', 'app/b.ts'], bad: [1] },
      editors: {
        'app/a.ts': { anchor: 3, head: 5, scrollTop: 120, savedMillis: 1 },
        'app/b.ts': { anchor: 'x' },
      },
    });
    expect(parseSession(raw)).toEqual({
      project: 'app',
      explorer: { app: ['app', 'app/src'] },
      openFile: null,
      openFiles: { app: ['app/a.ts', 'app/b.ts'] },
      editors: { 'app/a.ts': { anchor: 3, head: 5, scrollTop: 120, savedMillis: 1 } },
    });
  });
});

describe('withEditorState', () => {
  it(`keeps the ${MAX_EDITOR_STATES} most recently saved files`, () => {
    let session = EMPTY_SESSION;
    for (let i = 0; i < MAX_EDITOR_STATES + 5; i++) {
      session = withEditorState(session, `f${i}`, { anchor: i, head: i, scrollTop: 0 }, i);
    }
    expect(Object.keys(session.editors)).toHaveLength(MAX_EDITOR_STATES);
    expect(session.editors.f0).toBeUndefined();
    expect(session.editors[`f${MAX_EDITOR_STATES + 4}`]).toMatchObject({ anchor: MAX_EDITOR_STATES + 4 });
  });
});

describe('createSessionStore', () => {
  it('persists updates across instances (restarts)', async () => {
    const store = memoryStore();
    await createSessionStore(store).update((s) => ({ ...s, project: 'app', openFile: 'app/main.ts' }));
    expect(await createSessionStore(store).load()).toMatchObject({ project: 'app', openFile: 'app/main.ts' });
  });

  it('applies back-to-back updates in order without losing any', async () => {
    const sessions = createSessionStore(memoryStore());
    await Promise.all([
      sessions.update((s) => ({ ...s, project: 'app' })),
      sessions.update((s) => ({ ...s, openFile: 'app/a.ts' })),
      sessions.update((s) => ({ ...s, explorer: { app: ['app', 'app/src'] } })),
    ]);
    expect(await sessions.load()).toEqual({
      project: 'app',
      openFile: 'app/a.ts',
      explorer: { app: ['app', 'app/src'] },
      openFiles: {},
      editors: {},
    });
  });
});
