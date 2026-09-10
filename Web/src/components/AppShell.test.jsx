import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * PIX's line has to be reachable on a phone.
 *
 * It carried vk-r-hide-sm, which is `display: none` at <=640px — and
 * that span is the ONLY surface that renders SEALED!, REMOVED.,
 * GOT IT. and CLIP CLEARED. So at 375px, saving an entry, deleting one
 * and copying a password produced no visible feedback whatsoever, and
 * ItemDetail closing on save looked exactly like pressing Escape.
 *
 * The whole defect was one class name, which is why there is a test
 * about a class name: it is the thing that can silently come back.
 * How the row lays out is CSS and was verified in a browser at 320,
 * 375 and 1440; what is asserted here is that the line is not hidden.
 */

vi.mock('react', async () => (await import('../test/hookShim.js')).reactMock);

let says = null;
// Defaults to null so every test that predates the HUD renders exactly
// as it did: null is the "nothing to measure" case and the HUD is not
// rendered at all. The HUD tests set it.
let health = null;
vi.mock('../context/PixContext', () => ({ usePix: () => ({ pose: 'idle', says }) }));
vi.mock('../context/VaultContext', () => ({ useVault: () => ({ lock: vi.fn(), items: [] }) }));
vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggle: vi.fn() }) }));
vi.mock('../lib/health', () => ({ vaultHealth: () => health }));

const { AppShell } = await import('./AppShell');
const { resetHooks, find, texts } = await import('../test/hookShim.js');

const render = () => {
  resetHooks();
  return AppShell({ children: null, view: 'vault', onNavigate: vi.fn() });
};

const pixLine = (tree) => find(tree, n => n.props?.className === 'vk-r-pix-line');

beforeEach(() => {
  vi.clearAllMocks();
  says = null;
  health = null;
});

describe("PIX's line in the header", () => {
  test('is NOT hidden at mobile widths', () => {
    says = 'SEALED!';
    const line = pixLine(render());

    expect(line).toBeDefined();
    // The regression this file exists for.
    expect(line.props.className).not.toContain('vk-r-hide-sm');
    expect(texts(line)).toContain('SEALED!');
  });

  test('lives inside a brand group that can wrap', () => {
    // The row beneath the wordmark only exists if the group wraps;
    // without this the full flex-basis just squeezes the wordmark.
    says = 'GOT IT.';
    expect(find(render(), n => n.props?.className === 'vk-r-brand')).toBeDefined();
  });

  test('renders nothing at all when there is no moment', () => {
    // The row is deliberately not reserved — the header grows only
    // while a moment is live, then shrinks back.
    says = null;
    expect(pixLine(render())).toBeUndefined();
  });

  test.each(['SEALED!', 'REMOVED.', 'GOT IT.', 'CLIP CLEARED.', 'WELCOME BACK.', 'THE VAULT IS YOURS.'])(
    'carries %s',
    (moment) => {
      says = moment;
      expect(texts(pixLine(render()))).toContain(moment);
    }
  );
});

/**
 * The vault health HUD has to be reachable below 1025px.
 *
 * Exactly the same defect as PIX's line above, one breakpoint out. It
 * carried vk-r-hide-md — `display: none` at <=1024px — and this header
 * is the ONLY surface in the app that renders the vault average:
 * vaultHealth has one call site, and the per-item meters on the Vault
 * screen are a different quantity. So on every tablet and every phone
 * the readout was simply absent.
 *
 * Asserted here for the reason the file already gives for PIX: the
 * whole defect is one class name, and a class name is the thing that
 * can silently come back. The match is on the `vk-r-hide` prefix rather
 * than on `vk-r-hide-md`, so re-hiding it at any breakpoint fails.
 *
 * How the header reflows is CSS and was verified in a browser at 320,
 * 375, 768, 1024 and 1440; what is asserted here is that the element is
 * not hidden.
 */
describe('the vault health HUD', () => {
  const hud = (tree) => find(
    tree,
    n => n.props?.title === 'Average password strength across your vault'
  );

  test('is NOT hidden at tablet or mobile widths', () => {
    health = 7;
    const el = hud(render());

    expect(el).toBeDefined();
    // The regression this block exists for.
    expect(String(el.props.className ?? '')).not.toContain('vk-r-hide');
  });

  test('renders the average as a percentage', () => {
    health = 7;
    // `{health * 10}%` is two children, so texts() separates them.
    // Whitespace is collapsed rather than matched on.
    expect(texts(hud(render())).replace(/\s+/g, '')).toContain('70%');
  });

  test('renders nothing at all for a vault with nothing to measure', () => {
    // vaultHealth returns null for an empty vault — not 0, which would
    // read as "everything in here is weak".
    health = null;
    expect(hud(render())).toBeUndefined();
  });
});
