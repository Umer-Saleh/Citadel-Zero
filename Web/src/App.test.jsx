import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * Which greeting PIX gives when the vault opens.
 *
 * "WELCOME BACK." was fired from the isUnlocked transition alone, which
 * cannot tell a returning owner from an account that did not exist a
 * minute ago. Every route to a brand new vault ends at the unlock
 * screen — a demo provision, an ordinary signup, a recovery — so all
 * three were greeted as though they had been here before. There is no
 * "back".
 *
 * This file drives App as the plain function it is, through the hook
 * shim, and asserts the moment name handed to PIX. Each first-unlock
 * case is paired with the returning case, because a component that
 * always said 'firstUnlock' would satisfy every positive assertion.
 */

// App reads window.location.pathname at module scope. The test
// environment is node, so it must exist before App is imported.
vi.stubGlobal('window', { location: { pathname: '/', assign: vi.fn() } });

vi.mock('react', async () => (await import('./test/hookShim.js')).reactMock);

let isUnlocked = false;
vi.mock('./context/VaultContext', () => ({
  useVault: () => ({ isUnlocked })
}));

const pixReact = vi.fn();
vi.mock('./context/PixContext', () => ({ usePix: () => ({ react: pixReact }) }));

// zxcvbn and the QR encoder sit behind these and are irrelevant here.
vi.mock('./lib/policy', () => ({ checkPolicy: () => ({ passed: true, rules: [], strength: {} }) }));
vi.mock('./lib/strength', () => ({ calcStrength: () => ({ score: 5, color: 'x', label: 'OK' }) }));
vi.mock('./lib/clipboard', () => ({ copySecret: () => () => {} }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }));

const App = (await import('./App')).default;
const {
  resetHooks, beginRender, pendingEffects, find, componentNames
} = await import('./test/hookShim.js');

/** Render once and run whatever effects that render queued. */
function pass() {
  const tree = App();
  pendingEffects().forEach(fn => fn());
  return tree;
}

/** First render: mounts locked, and consumes the firstRender guard. */
function mountLocked() {
  isUnlocked = false;
  resetHooks();
  return pass();
}

/** Flip to unlocked and render again — the transition PIX reacts to. */
function unlock() {
  isUnlocked = true;
  beginRender();
  return pass();
}

/** And back out again, which is the only route to a pre-auth screen. */
function lock() {
  isUnlocked = false;
  beginRender();
  return pass();
}

const screenOf = (tree) => find(tree, n => typeof n.type === 'function')?.type.name;

beforeEach(() => {
  vi.clearAllMocks();
  isUnlocked = false;
});

describe('a vault that is being opened for the first time', () => {
  test('a demo provision is greeted as new, not as returning', () => {
    const tree = mountLocked();
    expect(screenOf(tree)).toBe('Unlock');

    // What startDemoVault reports before it begins the work.
    find(tree, n => n.type?.name === 'Unlock').props.onFreshVault(true);
    unlock();

    expect(pixReact).toHaveBeenCalledWith('firstUnlock');
    expect(pixReact).not.toHaveBeenCalledWith('unlock');
  });

  test('an ordinary signup is greeted as new, all the way to first unlock', () => {
    let tree = mountLocked();

    // The real route: unlock -> signup -> recovery kit -> unlock.
    find(tree, n => n.type?.name === 'Unlock').props.onGoSignup();
    beginRender();
    tree = pass();
    expect(screenOf(tree)).toBe('Signup');

    find(tree, n => n.type?.name === 'Signup').props.onComplete('KEY', 'a@b.test');
    beginRender();
    tree = pass();
    expect(screenOf(tree)).toBe('RecoveryKit');

    find(tree, n => n.type?.name === 'RecoveryKit').props.onContinue();
    beginRender();
    tree = pass();
    expect(screenOf(tree)).toBe('Unlock');

    // The user now types the password they just chose.
    unlock();

    expect(pixReact).toHaveBeenCalledWith('firstUnlock');
    expect(pixReact).not.toHaveBeenCalledWith('unlock');
  });

  test('a recovered vault is greeted as new', () => {
    let tree = mountLocked();

    find(tree, n => n.type?.name === 'Unlock').props.onGoRecovery();
    beginRender();
    tree = pass();
    expect(screenOf(tree)).toBe('Recover');

    find(tree, n => n.type?.name === 'Recover').props.onRecovered('KEY', 'a@b.test');
    beginRender();
    tree = pass();
    find(tree, n => n.type?.name === 'RecoveryKit').props.onContinue();
    beginRender();
    pass();

    unlock();

    expect(pixReact).toHaveBeenCalledWith('firstUnlock');
    expect(pixReact).not.toHaveBeenCalledWith('unlock');
  });
});

describe('a vault that has been opened before', () => {
  test('an ordinary unlock still says WELCOME BACK', () => {
    // The control. Without it every assertion above would pass on a
    // build that said 'firstUnlock' unconditionally.
    mountLocked();
    unlock();

    expect(pixReact).toHaveBeenCalledWith('unlock');
    expect(pixReact).not.toHaveBeenCalledWith('firstUnlock');
  });

  test('locking and unlocking again returns to WELCOME BACK', () => {
    const tree = mountLocked();
    find(tree, n => n.type?.name === 'Unlock').props.onFreshVault(true);
    unlock();
    expect(pixReact).toHaveBeenCalledWith('firstUnlock');

    lock();
    expect(pixReact).toHaveBeenCalledWith('lock');

    pixReact.mockClear();
    unlock();

    // The account is no longer new, and locking is the only way back to
    // a screen that could have minted another one.
    expect(pixReact).toHaveBeenCalledWith('unlock');
    expect(pixReact).not.toHaveBeenCalledWith('firstUnlock');
  });

  test('a failed provision withdraws the claim', () => {
    // Nothing unlocked, so it was never read — but left standing it
    // would greet whatever unlocked next as brand new, including
    // someone signing into an account they already had.
    const tree = mountLocked();
    const unlockScreen = find(tree, n => n.type?.name === 'Unlock');

    unlockScreen.props.onFreshVault(true);
    unlockScreen.props.onFreshVault(false);
    unlock();

    expect(pixReact).toHaveBeenCalledWith('unlock');
    expect(pixReact).not.toHaveBeenCalledWith('firstUnlock');
  });

  test('resuming a demo vault is a returning unlock', () => {
    // resumeDemo reopens a vault provisioned earlier in this tab and
    // deliberately does not report a fresh one.
    mountLocked();
    unlock();

    expect(pixReact).toHaveBeenCalledWith('unlock');
    expect(pixReact).not.toHaveBeenCalledWith('firstUnlock');
  });
});

describe('the not-found screen', () => {
  test('a real path renders the app, not the 404', () => {
    // The counterpart to App.notfound.test.jsx, which loads the same
    // module at an unknown path. Both are needed: the decision is made
    // once at module scope, so one file can only ever observe one side.
    expect(componentNames(mountLocked())).not.toContain('NotFound');
  });
});
