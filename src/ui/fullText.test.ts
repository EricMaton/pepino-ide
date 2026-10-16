import { describe, expect, it } from 'vitest';
import { bubblePlacement, cutTexts } from './fullText';

const viewport = { width: 400, height: 800 };
const bubble = { width: 200, height: 60 };

describe('bubblePlacement', () => {
  it('goes above the text, centred on it, the arrow at its centre', () => {
    const place = bubblePlacement({ top: 300, left: 100, width: 100, height: 20 }, bubble, viewport);
    expect(place).toEqual({ top: 300 - 10 - 60, left: 50, below: false, arrow: 100 });
  });

  it('stays on screen at either edge, the arrow still pointing at the text', () => {
    const atLeft = bubblePlacement({ top: 300, left: 0, width: 40, height: 20 }, bubble, viewport);
    expect(atLeft.left).toBe(12);
    expect(atLeft.arrow).toBe(16); // as close to the text's centre (20 - 12) as the corner lets it
    const atRight = bubblePlacement({ top: 300, left: 360, width: 40, height: 20 }, bubble, viewport);
    expect(atRight.left).toBe(400 - 12 - 200);
    expect(atRight.arrow).toBe(200 - 16); // the text's centre is past the corner: as far as it goes
  });

  it('goes below when there is no room above (the top bar)', () => {
    const place = bubblePlacement({ top: 20, left: 100, width: 100, height: 24 }, bubble, viewport);
    expect(place).toMatchObject({ below: true, top: 20 + 24 + 10 });
  });

  it('a bubble wider than the screen starts at the margin', () => {
    expect(
      bubblePlacement({ top: 300, left: 0, width: 400, height: 20 }, { width: 500, height: 60 }, viewport).left,
    ).toBe(12);
  });
});

/** A fake element: [cut] when its text does not fit; [closest] finds itself or an ancestor by kind. */
function fake(kind: 'ellipsis' | 'row' | 'other', text = '', cut = false, children: unknown[] = []) {
  const element: Record<string, unknown> = {
    textContent: text,
    clientWidth: 100,
    scrollWidth: cut ? 250 : 100,
    parent: null,
    querySelectorAll: () => children,
  };
  element.closest = (selector: string) => {
    for (let at: Record<string, unknown> | null = element; at; at = at.parent as Record<string, unknown> | null) {
      const kindOf = at.kind;
      if (selector === '.ellipsis' ? kindOf === 'ellipsis' : kindOf === 'row') return at;
    }
    return null;
  };
  element.kind = kind;
  for (const child of children as Record<string, unknown>[]) child.parent = element;
  return element;
}

describe('cutTexts', () => {
  it('shows a held text that is cut, and nothing for one that fits', () => {
    const name = fake('ellipsis', 'a-really-long-name.ts', true);
    expect(cutTexts(name as never)).toEqual({ anchor: name, texts: ['a-really-long-name.ts'] });
    const short = fake('ellipsis', 'main.ts', false);
    fake('row', '', false, [short]);
    expect(cutTexts(short as never)).toBeNull();
  });

  it('holding a row shows every cut text in it, in order', () => {
    const name = fake('ellipsis', 'pepino-ide-with-a-long-name', true);
    const fits = fake('ellipsis', 'main', false);
    const path = fake('ellipsis', '~/projects/work/clients/pepino-ide-with-a-long-name', true);
    const row = fake('row', '', false, [name, fits, path]);
    const icon = fake('other');
    icon.parent = row;
    expect(cutTexts(icon as never)).toEqual({
      anchor: name,
      texts: ['pepino-ide-with-a-long-name', '~/projects/work/clients/pepino-ide-with-a-long-name'],
    });
  });

  it('nothing outside a text or an item', () => {
    expect(cutTexts(null)).toBeNull();
    expect(cutTexts(fake('other') as never)).toBeNull();
  });
});
