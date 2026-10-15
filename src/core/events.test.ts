import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './events';

type TestEvents = {
  'counter.changed': { count: number };
  'file.saved': { path: string };
};

describe('EventBus', () => {
  it('delivers payloads to subscribers of the topic only', () => {
    const bus = new EventBus<TestEvents>();
    const counter = vi.fn();
    const saved = vi.fn();
    bus.subscribe('counter.changed', counter);
    bus.subscribe('file.saved', saved);

    bus.publish('counter.changed', { count: 1 });

    expect(counter).toHaveBeenCalledWith({ count: 1 });
    expect(saved).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('counter.changed', handler);
    unsubscribe();
    bus.publish('counter.changed', { count: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps delivering when a handler throws', () => {
    const onError = vi.fn();
    const bus = new EventBus<TestEvents>(onError);
    const second = vi.fn();
    bus.subscribe('counter.changed', () => {
      throw new Error('boom');
    });
    bus.subscribe('counter.changed', second);

    bus.publish('counter.changed', { count: 2 });

    expect(second).toHaveBeenCalledWith({ count: 2 });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'counter.changed');
  });

  it('tolerates handlers unsubscribing while publishing', () => {
    const bus = new EventBus<TestEvents>();
    const later = vi.fn();
    const unsubscribe = bus.subscribe('counter.changed', () => unsubscribe());
    bus.subscribe('counter.changed', later);
    bus.publish('counter.changed', { count: 3 });
    expect(later).toHaveBeenCalledOnce();
  });
});
