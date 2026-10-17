import { describe, expect, it } from 'vitest';
import { controlCode, keySequence, TERMINAL_KEYS, withControl } from './keys';

describe('terminal keys (#40)', () => {
  it('turns a key into its control code with Ctrl', () => {
    expect(controlCode('c')).toBe('\x03');
    expect(controlCode('C')).toBe('\x03');
    expect(controlCode('d')).toBe('\x04');
    expect(controlCode('z')).toBe('\x1a');
    expect(controlCode('[')).toBe('\x1b');
    expect(controlCode('\\')).toBe('\x1c');
    expect(controlCode('@')).toBe('\x00');
    expect(controlCode(' ')).toBe('\x00');
    expect(controlCode('?')).toBe('\x7f');
    expect(controlCode('5')).toBeNull();
    expect(controlCode('é')).toBeNull();
    expect(controlCode('ab')).toBeNull();
  });

  it('applies Ctrl to the first character typed only', () => {
    expect(withControl('c')).toBe('\x03');
    expect(withControl('cat')).toBe('\x03at');
    expect(withControl('9')).toBe('9');
    expect(withControl('')).toBe('');
  });

  it('sends what xterm sends for each key', () => {
    expect(keySequence('esc')).toBe('\x1b');
    expect(keySequence('tab')).toBe('\t');
    expect(keySequence('up')).toBe('\x1b[A');
    expect(keySequence('left')).toBe('\x1b[D');
    expect(keySequence('home')).toBe('\x1b[H');
    expect(keySequence('pageDown')).toBe('\x1b[6~');
    expect(keySequence('|')).toBe('|');
    expect(keySequence('ctrl')).toBeNull();
  });

  it('arrows follow the program: application cursor mode, and Ctrl', () => {
    expect(keySequence('up', { applicationCursor: true })).toBe('\x1bOA');
    expect(keySequence('right', { ctrl: true })).toBe('\x1b[1;5C');
    expect(keySequence('pageUp', { ctrl: true })).toBe('\x1b[5;5~');
    // Ctrl with a symbol key: its control code when it has one
    expect(keySequence('~', { ctrl: true })).toBe('~');
    expect(keySequence('-', { ctrl: true })).toBe('-');
  });

  it('every key has a label and a name', () => {
    for (const key of TERMINAL_KEYS) {
      expect(key.label).not.toBe('');
      expect(key.title).not.toBe('');
    }
    expect(new Set(TERMINAL_KEYS.map((key) => key.id)).size).toBe(TERMINAL_KEYS.length);
  });
});
