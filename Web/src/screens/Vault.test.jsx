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
  componentNames, find, texts, apiError
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
