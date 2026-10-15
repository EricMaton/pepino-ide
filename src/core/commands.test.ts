import { describe, expect, it, vi } from 'vitest';
import { CommandDispatcher, CommandRegistry, UnknownCommandError } from './commands';

const command = (id: string, run = () => {}) => ({ id, title: id, run });

describe('CommandRegistry', () => {
  it('lists commands in registration order', () => {
    const registry = new CommandRegistry();
    registry.register(command('b'));
    registry.register(command('a'));
    registry.register(command('c'));
    expect(registry.all.map((c) => c.id)).toEqual(['b', 'a', 'c']);
  });

  it('rejects duplicate ids', () => {
    const registry = new CommandRegistry();
    registry.register(command('x'));
    expect(() => registry.register(command('x'))).toThrow('Duplicate command id: x');
  });

  it('unregisters by id', () => {
    const registry = new CommandRegistry();
    registry.register(command('x'));
    expect(registry.unregister('x')).toBe(true);
    expect(registry.unregister('x')).toBe(false);
    expect(registry.find('x')).toBeUndefined();
  });

  it('returns a disposer that only removes its own registration', () => {
    const registry = new CommandRegistry();
    const dispose = registry.register(command('x'));
    dispose();
    const replacement = command('x');
    registry.register(replacement);
    dispose();
    expect(registry.find('x')).toBe(replacement);
  });
});

describe('CommandDispatcher', () => {
  it('runs the command', async () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register(command('x', run));
    await new CommandDispatcher(registry).execute('x');
    expect(run).toHaveBeenCalledOnce();
  });

  it('awaits async commands', async () => {
    const registry = new CommandRegistry();
    let done = false;
    registry.register(
      command('x', async () => {
        await Promise.resolve();
        done = true;
      }),
    );
    await new CommandDispatcher(registry).execute('x');
    expect(done).toBe(true);
  });

  it('rejects unknown ids', async () => {
    const dispatcher = new CommandDispatcher(new CommandRegistry());
    await expect(dispatcher.execute('nope')).rejects.toBeInstanceOf(UnknownCommandError);
  });

  it('propagates command failures', async () => {
    const registry = new CommandRegistry();
    registry.register(
      command('x', () => {
        throw new Error('boom');
      }),
    );
    await expect(new CommandDispatcher(registry).execute('x')).rejects.toThrow('boom');
  });
});
