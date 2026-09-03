import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * The seam between React state and a long-lived async caller.
 *
 * A collaborator taken out of the context is a closure. Something that
 * grabs one BEFORE unlocking and calls it AFTER — provisioning a demo
 * vault holds addItem across its own login() — still holds the version
 * captured while the vault was locked. When the DEK lived only in
 * state, that version closed over null and every write threw inside
 * crypto.subtle.importKey before a request was ever sent: five silent
 * failures and an empty vault.
 *
 * There is no DOM and no render-testing library here, and adding one is
 * a dependency this project does not carry. Instead React itself is
 * mocked down to the four hooks VaultProvider uses, and the provider is
 * called as the plain function it is. That is not a simplification of
 * the thing under test — it is the real VaultContext module, running
 * its real login/lock/addItem — and it models the failure precisely,
 * because the provider is invoked ONCE and never re-rendered. The
 * callbacks the test holds are therefore exactly the stale ones.
 */

// Hook state, indexed by call order across the single render.
let stateSlots, stateIndex, refSlots, refIndex;

vi.mock('react', () => ({
  useState: (initial) => {
    const i = stateIndex++;
    if (!(i in stateSlots)) {
      stateSlots[i] = typeof initial === 'function' ? initial() : initial;
    }
    return [
      stateSlots[i],
      (next) => {
        stateSlots[i] = typeof next === 'function' ? next(stateSlots[i]) : next;
      }
    ];
  },
  useRef: (initial) => {
    const i = refIndex++;
    if (!(i in refSlots)) refSlots[i] = { current: initial };
    return refSlots[i];
  },
  useCallback: (fn) => fn,
  useEffect: () => {},
  createContext: () => ({ Provider: ({ value }) => value }),
  useContext: () => null
}));

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  upgradeKdf: vi.fn(),
  regenerateRecoveryKit: vi.fn()
}));

vi.mock('../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setSessionLostHandler: vi.fn()
}));

vi.mock('../crypto', () => ({
  // Mirrors crypto.subtle.importKey, which rejects a null key. Without
  // this the test would pass on a null DEK and prove nothing.
  encryptItem: vi.fn(async (obj, key) => {
    if (!key) throw new TypeError('key is not of type BufferSource');
    return { ciphertext: 'c', nonce: 'n', authTag: 't' };
  }),
  decryptItem: vi.fn(async () => ({ site: 'x' }))
}));

const { VaultProvider } = await import('./VaultContext');
const auth = await import('../api/auth');
const { api } = await import('../api/client');
const { encryptItem } = await import('../crypto');

/**
 * Render once and hand back the context value.
 *
 * VaultProvider returns a real React element — react/jsx-runtime is
 * NOT mocked, only the hooks are — so the value is read off its props
 * rather than by invoking the Provider.
 */
function render() {
  stateSlots = {}; stateIndex = 0;
  refSlots = {};   refIndex = 0;
  return VaultProvider({ children: null }).props.value;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.post.mockResolvedValue({ id: 'item-1' });
});

describe('a collaborator captured before login', () => {
  test('still writes after login — the DEK is read at call time', async () => {
    const ctx = render();

    // Captured while locked. This is the exact reference
    // provisionDemoVault holds for the whole of its run.
    const addItem = ctx.addItem;

    const key = new Uint8Array(32).fill(7);
    auth.login.mockResolvedValue({ dek: key, kdfUpgradeAvailable: false });

    await ctx.login('demo@demo.invalid', 'pw');

    // The provider was never re-rendered, so `addItem` is stale by
    // construction — the situation that produced five silent failures.
    await addItem({ site: 'GitHub' });

    // It reached the network, which it could not do before the fix.
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/vault', expect.anything());

    // And it encrypted under the REAL key, not null.
    expect(encryptItem).toHaveBeenCalledWith({ site: 'GitHub' }, key);
  });
});

describe('lock clears the key everywhere it is held', () => {
  test('the ref is cleared and its bytes zeroed, not just the state', async () => {
    const ctx = render();
    const addItem = ctx.addItem;

    const key = new Uint8Array(32).fill(7);
    auth.login.mockResolvedValue({ dek: key, kdfUpgradeAvailable: false });
    await ctx.login('demo@demo.invalid', 'pw');

    ctx.lock();

    // Zeroed in place: no reachable copy of the key material survives.
    expect(Array.from(key)).toEqual(Array(32).fill(0));

    // And the ref itself is dropped, so a stale collaborator cannot
    // keep writing against a vault the user has locked. This is the
    // property a ref could silently break — it has its own lifetime
    // and would otherwise outlive the state.
    api.post.mockClear();
    await expect(addItem({ site: 'GitHub' })).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });
});
