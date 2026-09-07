import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * An address that is not the application.
 *
 * Web/nginx.conf answers every unmatched path with index.html, so the
 * browser gets HTTP 200 and the whole app at /anything. With no router,
 * App's final unconditional return drew the unlock screen — a mistyped
 * URL, or a scanner probing /wp-admin, was answered with a password
 * prompt.
 *
 * A SEPARATE FILE from App.test.jsx on purpose. The decision is made
 * once at module scope, from window.location.pathname, so a single
 * module instance can only ever observe one side of it. Each file
 * stubs a different path and gets its own registry; between them they
 * cover both. Faking it through resetModules instead would hand App a
 * different hookShim instance than the test holds.
 */

vi.stubGlobal('window', {
  location: { pathname: '/anything', assign: vi.fn() }
});

vi.mock('react', async () => (await import('./test/hookShim.js')).reactMock);

vi.mock('./context/VaultContext', () => ({ useVault: () => ({ isUnlocked: false }) }));
vi.mock('./context/PixContext', () => ({ usePix: () => ({ react: vi.fn() }) }));
vi.mock('./lib/policy', () => ({ checkPolicy: () => ({ passed: true, rules: [], strength: {} }) }));
vi.mock('./lib/strength', () => ({ calcStrength: () => ({ score: 5, color: 'x', label: 'OK' }) }));
vi.mock('./lib/clipboard', () => ({ copySecret: () => () => {} }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }));

const App = (await import('./App')).default;
const { NotFound } = await import('./screens/NotFound');
const {
  resetHooks, pendingEffects, componentNames, find, texts
} = await import('./test/hookShim.js');

function renderApp() {
  resetHooks();
  const tree = App();
  pendingEffects().forEach(fn => fn());
  return tree;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('an unknown path', () => {
  test('renders the not-found screen', () => {
    expect(componentNames(renderApp())).toContain('NotFound');
  });

  test('does NOT render the unlock screen', () => {
    // The whole point. Before this, /anything answered with a password
    // prompt, which reads as though the address is real and protected.
    const names = componentNames(renderApp());

    expect(names).not.toContain('Unlock');
    expect(names).not.toContain('Signup');
    expect(names).not.toContain('Recover');
    expect(names).not.toContain('AppShell');
  });
});

describe('the not-found screen itself', () => {
  const rendered = () => NotFound();

  test('says there is nothing here, in the terminal voice', () => {
    const copy = texts(rendered());

    // Whitespace-stripped: the wordmark is 4<span>0</span>4 so the
    // middle digit can take --green, and the shim's text walker joins
    // leaf nodes with spaces. The elements are inline with no
    // whitespace between them in the JSX, so the browser renders "404"
    // contiguously — this is a joiner artifact, not a layout one.
    expect(copy.replace(/\s+/g, '')).toContain('404');
    expect(copy).toContain('NOTHING AT THIS ADDRESS');
  });

  test('offers a way back to the vault', () => {
    const tree = rendered();
    const button = find(tree, n => n.type?.name === 'Button');

    expect(button).toBeDefined();
    expect(button.props.children).toBe('GO TO THE VAULT');

    button.props.onClick();
    expect(window.location.assign).toHaveBeenCalledWith('/');
  });

  test('does not echo the path back into the page', () => {
    // Attacker-controlled text on a page carrying this project's name:
    // /Your-session-has-expired-call-… would render as though the site
    // said it. React escapes it, so this is not about injection — it is
    // about not lending the wordmark to a stranger's sentence.
    expect(texts(rendered())).not.toContain('/anything');
  });

  test('uses only the shared responsive classes, so it needs no new CSS', () => {
    const tree = rendered();

    expect(find(tree, n => n.props?.className === 'vk-r-pad')).toBeDefined();
    expect(find(tree, n => n.props?.className === 'vk-r-fluid')).toBeDefined();
  });
});
