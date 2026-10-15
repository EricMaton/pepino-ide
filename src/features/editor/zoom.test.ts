import { describe, expect, it } from 'vitest';
import { clampFontSize, DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE, pinchFontSize } from './zoom';

describe('editor zoom', () => {
  it('scales the font with the distance between the fingers', () => {
    expect(pinchFontSize(14, 100, 200)).toBe(28);
    expect(pinchFontSize(14, 200, 100)).toBe(MIN_FONT_SIZE);
    expect(pinchFontSize(16, 100, 125)).toBe(20);
  });

  it('stays within limits and snaps to half pixels', () => {
    expect(pinchFontSize(20, 100, 400)).toBe(MAX_FONT_SIZE);
    expect(clampFontSize(13.3)).toBe(13.5);
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_FONT_SIZE);
    expect(pinchFontSize(14, 0, 50)).toBe(14);
  });
});
