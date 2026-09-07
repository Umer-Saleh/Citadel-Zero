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
vi.mock('../context/PixContext', () => ({ usePix: () => ({ pose: 'idle', says }) }));
vi.mock('../context/VaultContext', () => ({ useVault: () => ({ lock: vi.fn(), items: [] }) }));
vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggle: vi.fn() }) }));
vi.mock('../lib/health', () => ({ vaultHealth: () => null }));

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
