import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * The generator's copy control.
 *
 * There was none: REGENERATE and USE THIS were the only two buttons,
 * and the password itself was an inert div. A password generated for
 * something OUTSIDE the vault could not be got out of the screen except
 * by saving it as an entry first.
 *
 * WHAT IS PINNED, AND WHAT IS DELIBERATELY NOT
 * --------------------------------------------
 * Pinned: the control exists, carries a real accessible name, hands
 * copySecret the password that is actually on screen, and passes a tick
 * callback — which is what makes the countdown appear at all.
 *
 * Not pinned: the countdown itself. It is driven by a 1s interval
 * inside copySecret, whose pending session is module-level global state
 * with no reset hook. A test that let a real interval run would leak it
 * into whatever ran next, and one built on fake timers would be
 * asserting the mock rather than the meter. The meter was verified in a
 * browser instead. A bad test here would be worse than none.
 */

const copySecret = vi.fn(() => () => {});
vi.mock('../lib/clipboard', () => ({
  copySecret: (...args) => copySecret(...args),
  CLIP_SECONDS: 30
}));

vi.mock('react', async () => (await import('../test/hookShim.js')).reactMock);

const { Generator } = await import('./Generator');
const { resetHooks, walk, texts } = await import('../test/hookShim.js');

const render = () => {
  resetHooks();
  return Generator({ onUse: vi.fn() });
};

const copyControl = (tree) =>
  [...walk(tree)].find(n => n?.props?.['aria-label'] === 'Copy generated password');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('copying the generated password', () => {
  test('the control exists and is named for assistive technology', () => {
    const button = copyControl(render());

    // Icon is aria-hidden, so the glyph contributes nothing to the
    // name. Without the label the control would be announced as its
    // visible word alone, which does not say what gets copied.
    expect(button).toBeDefined();
    expect(button.props['aria-label']).toBe('Copy generated password');
    expect(texts(button.props.children)).toContain('COPY');
  });

  test('it copies the password that is on screen, not a stale one', () => {
    const tree = render();
    const onScreen = texts(tree);

    copyControl(tree).props.onClick();

    expect(copySecret).toHaveBeenCalledTimes(1);

    const [value] = copySecret.mock.calls[0];
    expect(typeof value).toBe('string');
    expect(value).toHaveLength(20);          // DEFAULT_LENGTH
    expect(onScreen).toContain(value);
  });

  /**
   * The countdown is the reason Stage 0 argued for copySecret's onTick
   * here rather than a bare copy: the clipboard is wiped at 30 seconds
   * either way, so a copy with no meter empties itself mid-paste on
   * another site with no warning. Passing the callback is what that
   * decision reduces to in code, so that is what is asserted — not the
   * timer it drives.
   */
  test('it asks for tick callbacks, which is what shows the countdown', () => {
    copyControl(render()).props.onClick();

    const [, onTick] = copySecret.mock.calls[0];
    expect(typeof onTick).toBe('function');
  });
});
