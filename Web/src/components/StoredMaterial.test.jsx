import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * The panel must never compare two different accounts.
 *
 * What happened on production: the API was serving a build of
 * /api/demo/stored-material that predated ownership scoping — pinned
 * to one shared DEMO_EMAIL account instead of reading the caller's own
 * rows — while the frontend was current and provisioning a per-visitor
 * vault. Verified against the live site: the endpoint answered for
 * demo@citadelzero.site while the browser held
 * demo-3a5aa1bcfae2c423cb17@demo.invalid, the two id sets had zero
 * overlap, and all five rows rendered "(not loaded in this session)".
 *
 * The panel showed a plausible, confident, wrong answer. In the one
 * component whose entire purpose is being evidence rather than
 * assertion, that is the worst available failure — so it now refuses
 * out loud.
 *
 * The negative assertions carry the weight here: on a mismatch NO Row
 * may render, including the account rows, because those are the same
 * wrong account's material one line further up.
 */

vi.mock('react', async () => (await import('../test/hookShim.js')).reactMock);

// DEMO_MODE is `import.meta.env.VITE_DEMO_MODE === 'true'`, which is
// undefined under vitest — the component would return null and every
// test would pass vacuously.
vi.mock('../lib/demo', () => ({ DEMO_MODE: true }));

const apiGet = vi.fn();
vi.mock('../api/client', () => ({ api: { get: (...a) => apiGet(...a) } }));

let vault = { items: [], email: null };
vi.mock('../context/VaultContext', () => ({ useVault: () => vault }));

const { StoredMaterial } = await import('./StoredMaterial');
const {
  resetHooks, beginRender, pendingEffects, flush, componentNames, find, walk, texts
} = await import('../test/hookShim.js');

// The shim does not invoke child components — they sit in the tree as
// their function `type` with props attached. So a child's own output
// is rendered on demand, and a child's inputs are read off its props.
const renderChild = (tree, name) => {
  const node = find(tree, n => n.type?.name === name);
  return node ? node.type(node.props) : null;
};

const rowProps = (tree) =>
  [...walk(tree)]
    .filter(n => typeof n === 'object' && n.type?.name === 'Row')
    .map(n => n.props);

const ITEM_ID = '93db52af-25bc-4f9f-a343-c7f11747dd59';

const decrypted = (id = ITEM_ID) => ({
  id,
  data: { site: 'GitHub', username: 'demo-reviewer', password: 'X7#mQv2$Ld9pRt4Wz!Kn' }
});

const payload = (email, itemId = ITEM_ID) => ({
  account: {
    email,
    kdfSalt: 'c2FsdA==',
    kdfParams: { m: 131072, t: 2, p: 1 },
    wrappedDek: { ciphertext: 'Y2lwaGVy', nonce: 'bm9uY2U=', authTag: 'dGFn' }
  },
  items: [{ id: itemId, encryptedData: 'ZW5jcnlwdGVk', nonce: 'bm9uY2U=', authTag: 'dGFn' }]
});

/** Expand the panel, let the fetch settle, render again. */
async function openPanel() {
  resetHooks();
  let tree = StoredMaterial();

  // The disclosure button is the only control before it opens.
  find(tree, n => n.props?.['aria-expanded'] === false).props.onClick();

  beginRender();
  StoredMaterial();
  pendingEffects().forEach(fn => fn());
  await flush();

  beginRender();
  return StoredMaterial();
}

beforeEach(() => {
  vi.clearAllMocks();
  vault = { items: [], email: null };
});

describe('the account guard', () => {
  test('refuses the comparison when the server answers for another account', async () => {
    vault = { items: [decrypted()], email: 'demo-3a5aa1bc@demo.invalid' };
    apiGet.mockResolvedValue(payload('demo@citadelzero.site'));

    const tree = await openPanel();
    expect(componentNames(tree)).toContain('AccountMismatch');

    const copy = texts(renderChild(tree, 'AccountMismatch'));
    expect(copy).toContain('COMPARISON REFUSED — ACCOUNT MISMATCH');

    // Names both sides, so the version skew is diagnosable from the
    // screen instead of being rediscovered.
    expect(copy).toContain('demo@citadelzero.site');
    expect(copy).toContain('demo-3a5aa1bc@demo.invalid');
  });

  test('renders NO rows at all on a mismatch, account rows included', async () => {
    vault = { items: [decrypted()], email: 'demo-3a5aa1bc@demo.invalid' };
    apiGet.mockResolvedValue(payload('demo@citadelzero.site'));

    const tree = await openPanel();

    // The assertion that matters. wrapped_dek and kdf_salt rendered
    // correctly all through the incident precisely because they never
    // consult the join — and they were the WRONG ACCOUNT'S key
    // material the whole time.
    expect(componentNames(tree)).not.toContain('Row');
    expect(rowProps(tree)).toHaveLength(0);

    // And the misleading string that started this is gone.
    const plains = rowProps(tree).map(p => p.plain);
    expect(plains).not.toContain('(not loaded in this session)');
  });

  test('announces the refusal', async () => {
    vault = { items: [decrypted()], email: 'demo-3a5aa1bc@demo.invalid' };
    apiGet.mockResolvedValue(payload('demo@citadelzero.site'));

    const rendered = renderChild(await openPanel(), 'AccountMismatch');
    expect(find(rendered, n => n.props?.role === 'alert')).toBeDefined();
  });
});

describe('the guard does not fire when it should not', () => {
  test('a matching account renders the comparison, with plaintext', async () => {
    // The control. Without it every negative assertion above would
    // pass on a panel that refuses unconditionally.
    vault = { items: [decrypted()], email: 'demo-3a5aa1bc@demo.invalid' };
    apiGet.mockResolvedValue(payload('demo-3a5aa1bc@demo.invalid'));

    const tree = await openPanel();
    const props = rowProps(tree);

    expect(componentNames(tree)).not.toContain('AccountMismatch');
    expect(props.map(p => p.label)).toEqual([
      'wrapped_dek',
      'kdf_salt / kdf_params',
      `vault_items · ${ITEM_ID.slice(0, 8)}`
    ]);

    // The comparison itself: the item row carries the plaintext this
    // browser decrypted, not the fallback.
    const item = props[2];
    expect(item.plain).toBe('GitHub\ndemo-reviewer\nX7#mQv2$Ld9pRt4Wz!Kn');
    expect(item.plainIsNote).toBeUndefined();
    expect(item.stored).toBe('ZW5jcnlwdGVk');
  });

  test('case and surrounding space are not a mismatch', async () => {
    // The server stores the address as given, with no normalisation,
    // so this difference is legitimate and must not be reported as a
    // different account.
    vault = { items: [decrypted()], email: '  Demo-3A5AA1BC@Demo.Invalid ' };
    apiGet.mockResolvedValue(payload('demo-3a5aa1bc@demo.invalid'));

    const tree = await openPanel();

    expect(componentNames(tree)).not.toContain('AccountMismatch');
    expect(rowProps(tree).at(-1).plain).toContain('GitHub');
  });

  test('an unknown session email is not treated as a mismatch', async () => {
    // "Cannot tell" must not render as "wrong" — that would be the
    // same overclaiming the guard exists to prevent.
    vault = { items: [decrypted()], email: null };
    apiGet.mockResolvedValue(payload('demo@citadelzero.site'));

    const tree = await openPanel();

    expect(componentNames(tree)).not.toContain('AccountMismatch');
    expect(componentNames(tree)).toContain('Row');
  });

  test('a row missing from this session still says so, per row', async () => {
    // Same account, but one stored row is not in client state — an
    // entry deleted after the panel cached its payload, say. That is
    // a per-row fact, not a broken panel, and the existing wording
    // stays.
    vault = { items: [], email: 'demo-3a5aa1bc@demo.invalid' };
    apiGet.mockResolvedValue(payload('demo-3a5aa1bc@demo.invalid'));

    const tree = await openPanel();

    expect(componentNames(tree)).not.toContain('AccountMismatch');
    expect(rowProps(tree).at(-1).plain).toBe('(not loaded in this session)');
  });
});
