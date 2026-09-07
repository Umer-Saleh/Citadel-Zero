import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * Operations that used to succeed in silence.
 *
 * A downloaded recovery kit, downloaded backup codes and a two-factor
 * switch-off all changed nothing on screen. The worst was the master
 * password: it succeeded, then locked, and the user was thrown to the
 * unlock screen with no way to tell success from a crash.
 *
 * Each test below is paired with the state before the operation, so a
 * component that showed the confirmation unconditionally would fail.
 */

// The download handlers reach for browser globals this environment
// does not have. URL is AUGMENTED rather than replaced — Vitest's own
// module loader constructs URLs, so stubbing the whole thing over
// breaks the import graph before a single test runs.
vi.stubGlobal('window', { location: { pathname: '/', assign: vi.fn() }, print: vi.fn() });
vi.stubGlobal('document', {
  createElement: () => ({ click: vi.fn(), set href(_v) {}, set download(_v) {} })
});
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};

vi.mock('react', async () => (await import('../test/hookShim.js')).reactMock);

const disable = vi.fn();
vi.mock('../api/totp', () => ({
  isEnabled: vi.fn(async () => true),
  beginEnrolment: vi.fn(),
  confirmEnrolment: vi.fn(),
  disable: (...a) => disable(...a)
}));

const changePassword = vi.fn();
const regenerateKit = vi.fn();
vi.mock('../context/VaultContext', () => ({
  useVault: () => ({
    email: 'a@b.test', kdfUpgradeAvailable: false,
    changePassword, upgradeKdf: vi.fn(), regenerateKit
  })
}));
vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggle: vi.fn() }) }));
vi.mock('../context/PixContext', () => ({ usePix: () => ({ react: vi.fn() }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }));
vi.mock('../lib/strength', () => ({ calcStrength: () => ({ score: 9, color: 'x', label: 'STRONG' }) }));

const { Settings } = await import('./Settings');
const {
  resetHooks, beginRender, pendingEffects, flush, find, walk, texts, componentNames
} = await import('../test/hookShim.js');

/** Every element of a given component type, with its props. */
const childrenOfType = (tree, name) =>
  [...walk(tree)].filter(n => n?.type?.name === name);

/**
 * The confirmations in a tree, as {label, detail}.
 *
 * SuccessNote is a component, so the shim leaves it uninvoked and its
 * label sits in props rather than in the rendered text. Read it there.
 */
const confirmations = (tree) =>
  childrenOfType(tree, 'SuccessNote')
    .map(n => ({ label: n.props.label, detail: texts(n.props.children) }));

/** A Button whose visible text contains `label`, icons and all. */
const buttonWith = (tree, label) =>
  [...walk(tree)].find(n =>
    n?.type?.name === 'Button' && texts(n.props.children).includes(label));

/** The child of Settings with this component name, plus its props. */
function child(name) {
  resetHooks();
  const node = find(Settings(), n => n.type?.name === name);
  return [node.type, node.props];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the recovery kit download', () => {
  test('says nothing before DOWNLOAD is pressed, and names the file after', async () => {
    const [RecoveryKitSection, props] = child('RecoveryKitSection');

    regenerateKit.mockResolvedValue({ recoveryKey: 'AAAA-BBBB' });

    resetHooks();
    let tree = RecoveryKitSection(props);

    // Get to the phase where DOWNLOAD exists. The confirm step really
    // does require the master password — run() refuses without it, so
    // skipping this leaves the section on 'confirm' and the assertion
    // below would be measuring the wrong screen.
    buttonWith(tree, 'ISSUE A NEW KEY').props.onClick();
    beginRender(); tree = RecoveryKitSection(props);

    childrenOfType(tree, 'Input')[0].props.onChange({ target: { value: 'master-password' } });
    beginRender(); tree = RecoveryKitSection(props);

    buttonWith(tree, 'ISSUE NEW KEY').props.onClick();
    await flush();
    beginRender(); tree = RecoveryKitSection(props);

    // Before: no confirmation.
    expect(componentNames(tree)).not.toContain('SuccessNote');

    buttonWith(tree, 'DOWNLOAD').props.onClick();

    beginRender(); tree = RecoveryKitSection(props);

    const [note] = confirmations(tree);
    expect(note.label).toBe('KEY DOWNLOADED');
    // Names the file rather than claiming the save landed — a page
    // cannot observe what the browser did with a download.
    expect(note.detail).toContain('citadel-zero-recovery-key.txt');
  });
});

describe('turning two-factor off', () => {
  test('acknowledges it, and does not acknowledge an account that was already off', async () => {
    const [TwoFactor, props] = child('TwoFactor');
    disable.mockResolvedValue(undefined);

    // An account that has 2FA ON.
    resetHooks();
    TwoFactor(props);
    pendingEffects().forEach(fn => fn());
    await flush();
    beginRender();
    let tree = TwoFactor(props);

    // Reach the disabling form, then confirm.
    expect(confirmations(tree)).toHaveLength(0);

    buttonWith(tree, 'TURN OFF').props.onClick();
    beginRender(); tree = TwoFactor(props);

    buttonWith(tree, 'TURN OFF').props.onClick();
    await flush();
    beginRender(); tree = TwoFactor(props);

    const [note] = confirmations(tree);
    expect(note.label).toBe('TWO-FACTOR TURNED OFF');
    expect(note.detail).toContain('only your master password');
  });

  test('an account that was never on says nothing', async () => {
    const totp = await import('../api/totp');
    totp.isEnabled.mockResolvedValue(false);

    const [TwoFactor, props] = child('TwoFactor');
    resetHooks();
    TwoFactor(props);
    pendingEffects().forEach(fn => fn());
    await flush();
    beginRender();

    // The off state is the ordinary state for such an account; a
    // confirmation here would be claiming something just happened.
    expect(confirmations(TwoFactor(props))).toHaveLength(0);
  });
});

describe('changing the master password', () => {
  test('hands the confirmation upward, because it cannot show one itself', async () => {
    // changePassword() locks on success, so this component is unmounted
    // before it could render anything. Reporting upward is the only way
    // the message reaches the screen the user actually lands on.
    const onPasswordChanged = vi.fn();
    changePassword.mockResolvedValue(undefined);

    resetHooks();
    const node = find(Settings({ onPasswordChanged }), n => n.type?.name === 'ChangePassword');
    const ChangePassword = node.type;

    resetHooks();
    let tree = ChangePassword(node.props);

    const inputs = childrenOfType(tree, 'Input');
    inputs[0].props.onChange({ target: { value: 'old-password-here' } });
    inputs[1].props.onChange({ target: { value: 'new-password-here-and-long' } });
    inputs[2].props.onChange({ target: { value: 'new-password-here-and-long' } });

    beginRender(); tree = ChangePassword(node.props);
    find(tree, n => n.props?.children === 'UPDATE PASSWORD').props.onClick();
    await flush();

    expect(changePassword).toHaveBeenCalledTimes(1);
    expect(onPasswordChanged).toHaveBeenCalledTimes(1);
  });

  test('a failed change reports nothing upward', async () => {
    const onPasswordChanged = vi.fn();
    changePassword.mockRejectedValue(Object.assign(new Error('x'), { code: 'INVALID_CREDENTIALS' }));

    resetHooks();
    const node = find(Settings({ onPasswordChanged }), n => n.type?.name === 'ChangePassword');
    const ChangePassword = node.type;

    resetHooks();
    let tree = ChangePassword(node.props);
    const inputs = childrenOfType(tree, 'Input');
    inputs[0].props.onChange({ target: { value: 'wrong-password' } });
    inputs[1].props.onChange({ target: { value: 'new-password-here-and-long' } });
    inputs[2].props.onChange({ target: { value: 'new-password-here-and-long' } });

    beginRender(); tree = ChangePassword(node.props);
    find(tree, n => n.props?.children === 'UPDATE PASSWORD').props.onClick();
    await flush();
    beginRender(); tree = ChangePassword(node.props);

    expect(onPasswordChanged).not.toHaveBeenCalled();

    // And the failure is still reported where it happened.
    const note = find(tree, n => n.type?.name === 'ErrorNote');
    expect(note.props.message).toBe('Current password is wrong.');
  });
});

describe('the post-lock notice on the unlock screen', () => {
  test('renders only while there is something to say', async () => {
    // The label is a literal, so SuccessNote's own empty-check cannot
    // catch this: without a guard on the notice itself, a bare
    // "PASSWORD CHANGED" heading with no sentence under it reappeared
    // after every later lock. Caught in the browser, not here — hence
    // the test.
    const { Unlock } = await import('./Unlock');

    resetHooks();
    const withNotice = Unlock({ notice: 'Your master password was changed.', onUnlocked: vi.fn() });
    expect(confirmations(withNotice)).toHaveLength(1);

    resetHooks();
    expect(confirmations(Unlock({ notice: '', onUnlocked: vi.fn() }))).toHaveLength(0);

    resetHooks();
    expect(confirmations(Unlock({ onUnlocked: vi.fn() }))).toHaveLength(0);
  });
});
