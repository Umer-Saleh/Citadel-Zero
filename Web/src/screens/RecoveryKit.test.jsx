import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * The one download that matters most, and the one that said nothing.
 *
 * Pressing DOWNLOAD here used to change nothing on screen — no note,
 * no label, not a character. Both sibling download buttons in Settings
 * already confirmed, so the screen that every new account passes
 * through, and the only one where losing the file loses the vault, was
 * the single one that gave no acknowledgement.
 *
 * This screen is also reached at the end of recovery, so the same
 * component carries the fix to both.
 *
 * What is asserted is deliberately narrow: that a note appears, that
 * it names the file, and that it goes away again. Whether the file
 * reached the disk is NOT assertable — a page cannot observe what the
 * browser did with a download — which is exactly why the copy names a
 * filename to look for instead of claiming a save.
 */

vi.mock('react', async () => (await import('../test/hookShim.js')).reactMock);
vi.mock('../lib/clipboard', () => ({ copySecret: () => () => {} }));

const { RecoveryKit } = await import('./RecoveryKit');
const {
  resetHooks, beginRender, pendingEffects, find, walk, texts, componentNames
} = await import('../test/hookShim.js');

const KEY = 'AC6Z-KS24-H0F9-WR1N-S8CK-FCYG-WC';

const props = () => ({ recoveryKey: KEY, email: 'you@example.com', onContinue: vi.fn() });

/** The download button, found the way a person finds it: by its label. */
const downloadButton = (tree) =>
  [...walk(tree)].find(n =>
    n?.type?.name === 'Button' && texts(n.props.children).includes('DOWNLOAD'));

const confirmation = (tree) => find(tree, n => n.type?.name === 'SuccessNote');

beforeEach(() => {
  vi.clearAllMocks();

  // jsdom is not present and the component builds a Blob URL and
  // clicks an anchor. Only those two seams are stubbed — the
  // component's own logic runs unmodified. URL is SPREAD rather than
  // replaced: handing vitest a bare object here breaks its module
  // loader, which needs the rest of the real URL API.
  vi.stubGlobal('URL', {
    ...globalThis.URL,
    createObjectURL: () => 'blob:stub',
    revokeObjectURL: () => {}
  });
  vi.stubGlobal('document', { createElement: () => ({ click() {} }) });
});

describe('the recovery-kit download', () => {
  test('says nothing before it is pressed', async () => {
    resetHooks();
    expect(componentNames(RecoveryKit(props()))).not.toContain('SuccessNote');
  });

  test('confirms, and names the file to look for', async () => {
    resetHooks();
    const p = props();
    let tree = RecoveryKit(p);

    downloadButton(tree).props.onClick();

    beginRender();
    tree = RecoveryKit(p);

    const note = confirmation(tree);
    expect(componentNames(tree)).toContain('SuccessNote');
    expect(note.props.label).toBe('KEY DOWNLOADED');

    // The filename is the actionable part: it is the only thing the
    // page can truthfully tell them to go and look for.
    expect(texts(note.props.children)).toContain('citadel-zero-recovery-key.txt');
  });

  test('the confirmation is transient, not furniture', async () => {
    vi.useFakeTimers();
    try {
      resetHooks();
      const p = props();
      let tree = RecoveryKit(p);

      downloadButton(tree).props.onClick();

      beginRender();
      tree = RecoveryKit(p);
      pendingEffects().forEach(fn => fn());
      expect(componentNames(tree)).toContain('SuccessNote');

      vi.advanceTimersByTime(6000);

      beginRender();
      expect(componentNames(RecoveryKit(p))).not.toContain('SuccessNote');
    } finally {
      vi.useRealTimers();
    }
  });

  test('the file carries the account and the key', async () => {
    // The download exists to be openable later by someone who has
    // forgotten everything, so the body has to identify which vault it
    // opens. Captured through the Blob the component actually builds.
    let captured = null;
    vi.stubGlobal('URL', {
      ...globalThis.URL,
      createObjectURL: (blob) => { captured = blob; return 'blob:stub'; },
      revokeObjectURL: () => {}
    });
    vi.stubGlobal('document', { createElement: () => ({ click() {} }) });

    resetHooks();
    const p = props();
    downloadButton(RecoveryKit(p)).props.onClick();

    const body = await captured.text();
    expect(body).toContain(KEY);
    expect(body).toContain('you@example.com');
  });
});
