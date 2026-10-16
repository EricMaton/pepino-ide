import { describe, expect, it } from 'vitest';
import { saveSettled, trackSave } from './pendingSaves';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('pending saves', () => {
  it('resolves right away when nothing is saving', async () => {
    await expect(saveSettled('a.ts')).resolves.toBeUndefined();
  });

  it('waits for the save of the same path only', async () => {
    const save = deferred();
    trackSave('a.ts', save.promise);
    const order: string[] = [];
    const reading = saveSettled('a.ts').then(() => order.push('read a'));
    await saveSettled('b.ts').then(() => order.push('read b'));
    save.resolve();
    order.push('saved a');
    await reading;
    expect(order).toEqual(['read b', 'saved a', 'read a']);
  });

  it('settles when the save fails too', async () => {
    const save = deferred();
    trackSave(
      'a.ts',
      save.promise.catch(() => Promise.reject(new Error('disk full'))),
    );
    save.reject(new Error('disk full'));
    await expect(saveSettled('a.ts')).resolves.toBeUndefined();
  });
});
