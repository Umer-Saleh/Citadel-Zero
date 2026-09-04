import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * "We could not check" is not "it is off".
 *
 * The status probe was `.catch(() => setPhase('off'))`. Any failure —
 * a dropped connection, a 500, an expired session — rendered the
 * section as two-factor being OFF, complete with an ENABLE button. For
 * the user it matters most to, that was a false statement about their
 * own security settings: someone with 2FA on, on a flaky connection,
 * was told it was off and invited to turn it on. Enrolling from there
 * returns TOTP_ALREADY_ENABLED and reads as a broken app.
 *
 * TwoFactor is not exported. It does not need to be — Settings returns
 * it as an element, and an element's `type` is the component function
 * itself, so the test reaches it without widening the module's surface
 * for the sake of being tested.
 */

vi.mock('react', async () => (await import('../test/hookShim.js')).reactMock);

const isEnabled = vi.fn();
vi.mock('../api/totp', () => ({
  isEnabled: (...a) => isEnabled(...a),
  beginEnrolment: vi.fn(),
  confirmEnrolment: vi.fn(),
  disable: vi.fn()
}));

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }));
vi.mock('../lib/strength', () => ({ calcStrength: () => ({ score: 5, color: 'x', label: 'OK' }) }));

vi.mock('../context/VaultContext', () => ({
  useVault: () => ({
    email: 'a@b.test', kdfUpgradeAvailable: false,
    changePassword: vi.fn(), upgradeKdf: vi.fn(), regenerateKit: vi.fn()
  })
}));
vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggle: vi.fn() }) }));
vi.mock('../context/PixContext', () => ({ usePix: () => ({ react: vi.fn() }) }));

const { Settings } = await import('./Settings');
const {
  resetHooks, beginRender, pendingEffects, flush, find, texts, apiError
} = await import('../test/hookShim.js');

/** The TwoFactor component and the props Settings gives it. */
function twoFactor() {
  resetHooks();
  const node = find(Settings(), n => n.type?.name === 'TwoFactor');
  return [node.type, node.props];
}

/** Render TwoFactor, run its probe effect, settle it, render again. */
async function renderAfterProbe() {
  const [TwoFactor, props] = twoFactor();

  // Settings itself uses no hooks, but the slots it would have used
  // must not be inherited by the child.
  resetHooks();
  TwoFactor(props);
  pendingEffects().forEach(fn => fn());
  await flush();
  beginRender();

  return { tree: TwoFactor(props), TwoFactor, props };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the two-factor status probe', () => {
  test('a failed check renders STATUS UNKNOWN, not OFF', async () => {
    isEnabled.mockRejectedValue(apiError('NETWORK_ERROR'));

    const copy = texts((await renderAfterProbe()).tree);

    expect(copy).toContain('STATUS UNKNOWN');
    expect(copy).toContain('Cannot reach the server.');
    expect(copy).toContain('does not change your current setting');
    expect(console.error).toHaveBeenCalled();
  });

  test('a failed check does NOT offer enrolment', async () => {
    isEnabled.mockRejectedValue(apiError('INTERNAL_ERROR'));

    const { tree } = await renderAfterProbe();
    const copy = texts(tree);

    // The control that made the false "off" actionable.
    expect(copy).not.toContain('ENABLE');
    // And the sentence that used to sit above it, arguing for it.
    expect(copy).not.toContain('Adds a code from your phone');

    // What is offered instead.
    expect(copy).toContain('RECHECK');
  });

  test('the unknown state is announced', async () => {
    isEnabled.mockRejectedValue(apiError('NETWORK_ERROR'));

    const { tree } = await renderAfterProbe();
    expect(find(tree, n => n.props?.role === 'alert')).toBeDefined();
  });

  test('a check that succeeds with false still renders OFF and ENABLE', async () => {
    // The control. Without it, "not ENABLE" would pass on a section
    // that never offers enrolment at all.
    isEnabled.mockResolvedValue(false);

    const copy = texts((await renderAfterProbe()).tree);

    expect(copy).toContain('ENABLE');
    expect(copy).toContain('Adds a code from your phone');
    expect(copy).not.toContain('STATUS UNKNOWN');
  });

  test('a check that succeeds with true renders ON', async () => {
    isEnabled.mockResolvedValue(true);

    const copy = texts((await renderAfterProbe()).tree);

    expect(copy).toContain('ON');
    expect(copy).not.toContain('STATUS UNKNOWN');
    // Not the off branch either — 'ON' alone is a loose match.
    expect(copy).not.toContain('Adds a code from your phone');
  });

  test('recheck re-runs the probe and can resolve the unknown state', async () => {
    isEnabled.mockRejectedValue(apiError('NETWORK_ERROR'));

    const { tree, TwoFactor, props } = await renderAfterProbe();

    const recheck = find(tree, n => n.props?.children === 'RECHECK');
    recheck.props.onClick();

    isEnabled.mockResolvedValue(true);

    beginRender();
    TwoFactor(props);
    pendingEffects().forEach(fn => fn());
    await flush();
    beginRender();

    const copy = texts(TwoFactor(props));

    expect(isEnabled).toHaveBeenCalledTimes(2);
    expect(copy).not.toContain('STATUS UNKNOWN');
    expect(copy).toContain('ON');
  });
});
