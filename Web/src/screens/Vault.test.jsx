import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * A vault that could not be loaded must not be reported as an empty
 * vault.
 *
 * The bug: `loadItems().finally(() => setLoading(false))`. No catch. A
 * rejected load left `items` at its initial [], cleared the loading
 * flag, and fell through to the dashed empty state — so a dead network,
 * a 500, an expired session and a failed decrypt all told the owner of
 * a full vault that they had nothing saved. Of everything this app can
 * say wrongly, that is the worst.
 *
 * The assertion that matters is the negative one: EmptyState is NOT in
 * the tree. Asserting only that an error appears would still pass if
 * both rendered.
 */

vi.mock('react', async () => (await import('../test/hookShim.js')).reactMock);

const loadItems = vi.fn();
let items = [];

vi.mock('../context/VaultContext', () => ({
  useVault: () => ({ items, loadItems })
}));

// zxcvbn behind calcStrength is heavy and irrelevant here.
vi.mock('../lib/strength', () => ({ calcStrength: () => ({ score: 5, color: 'x', label: 'OK' }) }));
vi.mock('../lib/clipboard', () => ({ copySecret: () => () => {} }));

const { Vault } = await import('./Vault');
const {
  resetHooks, beginRender, pendingEffects, flush,
  componentNames, find, texts, walk, apiError
} = await import('../test/hookShim.js');

const PROPS = { onSelectItem: () => {}, onAddItem: () => {}, selectedId: null };

/** First render, run the load effect, settle it, render again. */
async function renderAfterLoad() {
  resetHooks();
  Vault(PROPS);
  pendingEffects().forEach(fn => fn());
  await flush();
  beginRender();
  return Vault(PROPS);
}

beforeEach(() => {
  vi.clearAllMocks();
  items = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the vault list distinguishes a failed load from an empty one', () => {
  test('a rejected load does NOT render the empty state', async () => {
    loadItems.mockRejectedValue(apiError('NETWORK_ERROR'));

    const tree = await renderAfterLoad();
    const names = componentNames(tree);

    // The whole point. `items` is [] either way, so before the fix
    // this is precisely what rendered.
    expect(names).not.toContain('EmptyState');
    expect(names).toContain('LoadFailed');
  });

  test('a load that succeeds with nothing in it still renders the empty state', async () => {
    // The control. Without it, "not EmptyState" could be satisfied by
    // a screen that never shows the empty state at all.
    loadItems.mockResolvedValue(undefined);

    const names = componentNames(await renderAfterLoad());

    expect(names).toContain('EmptyState');
    expect(names).not.toContain('LoadFailed');
  });

  test('the failure is announced, names the cause, and offers a retry', async () => {
    loadItems.mockRejectedValue(apiError('NETWORK_ERROR'));

    const tree = await renderAfterLoad();
    const failed = find(tree, n => n.type?.name === 'LoadFailed');

    // Render that one subtree: it takes no hooks and no context.
    const rendered = failed.type(failed.props);
    const copy = texts(rendered);

    expect(rendered.props.role).toBe('alert');
    expect(copy).toContain('VAULT UNREACHABLE');
    expect(copy).toContain('Cannot reach the server.');
    // Says, in words, the thing the empty state would have implied.
    expect(copy).toContain('not your vault being empty');
    expect(copy).toContain('RETRY');
  });

  test('an unmapped code is surfaced rather than swallowed', async () => {
    loadItems.mockRejectedValue(apiError('TOO_MANY_REQUESTS'));

    const failed = find(await renderAfterLoad(), n => n.type?.name === 'LoadFailed');

    expect(texts(failed.type(failed.props))).toContain('TOO_MANY_REQUESTS');
    expect(console.error).toHaveBeenCalled();
  });

  test('retry clears the error and re-runs the load', async () => {
    loadItems.mockRejectedValue(apiError('NETWORK_ERROR'));

    let tree = await renderAfterLoad();
    find(tree, n => n.type?.name === 'LoadFailed').props.onRetry();

    loadItems.mockResolvedValue(undefined);
    items = [];

    beginRender();
    Vault(PROPS);
    pendingEffects().forEach(fn => fn());
    await flush();
    beginRender();
    tree = Vault(PROPS);

    expect(loadItems).toHaveBeenCalledTimes(2);
    expect(componentNames(tree)).not.toContain('LoadFailed');
  });
});

/**
 * Every entry was a bare <div onClick>. No role, no tabIndex, no name.
 * Querying the whole list region for anything focusable returned
 * nothing, so no entry could be opened without a mouse and none was
 * announced as a control at all.
 *
 * These assert the attributes rather than a rendered ring, because the
 * attributes are what an assistive technology reads and what a future
 * edit would silently drop.
 */
describe('an entry row is reachable without a mouse', () => {
  const ENTRY = { id: 'a', data: { site: 'GitHub', username: 'octocat', password: 'p' } };

  /** The row's own rendered output, with onClick replaced by a spy. */
  async function renderRow(onClick = vi.fn()) {
    items = [ENTRY];
    const tree = await renderAfterLoad();
    const el = find(tree, n => n.type?.name === 'ItemRow');
    resetHooks();
    return { row: el.type({ ...el.props, onClick }), el, onClick };
  }

  // target === currentTarget means the row itself, not a chip inside it.
  const keyEvent = (key) => ({
    key, target: 'row', currentTarget: 'row', preventDefault: vi.fn()
  });

  test('it is a named control, not an anonymous div', async () => {
    const { row } = await renderRow();

    expect(row.props.role).toBe('button');
    expect(row.props.tabIndex).toBe(0);
    // Named for the entry, so a list of five is not five "button"s.
    expect(row.props['aria-label']).toContain('GitHub');
    expect(row.props['aria-label']).toContain('octocat');
  });

  /**
   * The same move AppShell.test.jsx makes with the `vk-r-hide` prefix:
   * assert the CLASS of defect, not the single element that showed it.
   *
   * The defect was never "this row is missing a role". It was that the
   * list contained something clickable which a keyboard could not
   * reach. So every clickable node in the rendered list is held to one
   * rule — be a native control, or carry a role AND a non-negative
   * tabIndex — and the failure names whatever broke it.
   *
   * A clickable div added to a row next year fails this without anyone
   * remembering this test exists, which is the whole point of writing
   * it this way round. The test above would not catch that.
   */
  test('nothing clickable in the list is unreachable by keyboard', async () => {
    items = [
      ENTRY,
      { id: 'b', data: { site: 'Northwind', username: 'teller', password: 'p' } }
    ];
    const tree = await renderAfterLoad();

    const NATIVE = new Set(['button', 'a', 'input', 'select', 'textarea']);
    const offenders = [];

    for (const el of [...walk(tree)].filter(n => n?.type?.name === 'ItemRow')) {
      // Rendered twice: at rest, and with focus inside it, because the
      // copy chips only exist in the second and are just as much part
      // of the list as the row is.
      resetHooks();
      const atRest = el.type(el.props);
      atRest.props.onFocusCapture();
      beginRender();
      const focused = el.type(el.props);

      for (const node of [...walk(atRest), ...walk(focused)]) {
        if (typeof node?.props?.onClick !== 'function') continue;
        if (typeof node.type !== 'string') continue;       // a component, not a DOM node
        if (NATIVE.has(node.type)) continue;
        if (node.props.role && (node.props.tabIndex ?? -1) >= 0) continue;
        offenders.push(`<${node.type}> role=${node.props.role ?? 'none'} tabIndex=${node.props.tabIndex ?? 'none'}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test.each(['Enter', ' '])('%s opens the entry', async (key) => {
    const { row, onClick } = await renderRow();

    row.props.onKeyDown(keyEvent(key));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('Space is prevented, so a focused list does not scroll the page', async () => {
    const { row } = await renderRow();
    const event = keyEvent(' ');

    row.props.onKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
  });

  test('an ordinary key does not open the entry', async () => {
    const { row, onClick } = await renderRow();

    row.props.onKeyDown(keyEvent('a'));

    expect(onClick).not.toHaveBeenCalled();
  });

  /**
   * The chips are real buttons inside the row. Without this guard,
   * Enter on "copy password" would copy AND open the entry, because
   * the keydown bubbles to the row's handler.
   */
  test('a keystroke from a copy chip does not also open the entry', async () => {
    const { row, onClick } = await renderRow();

    row.props.onKeyDown({
      key: 'Enter', target: 'chip', currentTarget: 'row', preventDefault: vi.fn()
    });

    expect(onClick).not.toHaveBeenCalled();
  });

  /**
   * The chips rendered on `hover` alone, so they were not in the DOM
   * for a keyboard user at all — the row could have been focusable and
   * Tab would still have stepped straight past them.
   */
  test('focus reveals the copy chips, and both are named', async () => {
    const { row, el } = await renderRow();

    expect(texts(row)).not.toContain('USER');

    row.props.onFocusCapture();
    beginRender();
    const focused = el.type({ ...el.props, onClick: vi.fn() });

    const labels = [...walk(focused)]
      .map(n => n?.props?.['aria-label'])
      .filter(Boolean);

    expect(labels).toContain('Copy username for GitHub');
    expect(labels).toContain('Copy password for GitHub');
  });
});
