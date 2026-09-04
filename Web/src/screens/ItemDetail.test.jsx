import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * A save or delete that failed must not look like one that never
 * happened.
 *
 * Both handlers were bare `catch { setSaving(false) }` — no message, no
 * console line, no PIX reaction. The button un-busied and the panel
 * stayed open, which is pixel-identical to the state before the button
 * was pressed. The user's natural next move was to press it again
 * against a server that had just refused.
 *
 * So each test here asserts the pair: the failure says something, AND
 * the panel does not close the way a success closes it.
 */

vi.mock('react', async () => (await import('../test/hookShim.js')).reactMock);

// ItemDetail portals the delete confirmation to document.body. There is
// no DOM here; the component only needs the property to exist.
vi.stubGlobal('document', { body: {} });
vi.mock('react-dom', () => ({ createPortal: (node) => node }));

const addItem = vi.fn();
const updateItem = vi.fn();
const deleteItem = vi.fn();
let items = [];

vi.mock('../context/VaultContext', () => ({
  useVault: () => ({ items, addItem, updateItem, deleteItem })
}));

const pixReact = vi.fn();
vi.mock('../context/PixContext', () => ({ usePix: () => ({ react: pixReact }) }));
vi.mock('../lib/clipboard', () => ({ copySecret: () => () => {} }));

const { ItemDetail } = await import('./ItemDetail');
const {
  resetHooks, beginRender, flush, find, texts, apiError
} = await import('../test/hookShim.js');

const ENTRY = {
  id: 'i1',
  data: { site: 'GitHub', username: 'u', password: 'p', url: '', notes: '' }
};

let onDone;

function render() {
  return ItemDetail({ itemId: 'i1', onDone, injectedPassword: null, onInjected: () => {} });
}

const saveButton = (tree) =>
  find(tree, n => n.type?.name === 'PressButton' && n.props.children === 'SAVE');

const deleteButton = (tree) =>
  find(tree, n => n.type?.name === 'PressButton'
    && Array.isArray(n.props.children)
    && n.props.children.includes(' DELETE'));

const alertText = (tree) => {
  const el = find(tree, n => n.props?.role === 'alert');
  return el ? texts(el) : '';
};

beforeEach(() => {
  vi.clearAllMocks();
  items = [ENTRY];
  onDone = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a save that fails', () => {
  test('says so inline and leaves the panel open', async () => {
    updateItem.mockRejectedValue(apiError('TOO_MANY_REQUESTS'));

    resetHooks();
    saveButton(render()).props.onClick();
    await flush();

    beginRender();
    const tree = render();

    const message = alertText(tree);
    expect(message).toContain('Could not save this entry');
    expect(message).toContain('TOO_MANY_REQUESTS');

    // The two ways a failure used to be invisible.
    expect(onDone).not.toHaveBeenCalled();
    expect(pixReact).not.toHaveBeenCalledWith('save');

    // And the exception itself is recoverable from the console, which
    // matters most for the codeless DOMException out of crypto.subtle.
    expect(console.error).toHaveBeenCalled();

    // The button is pressable again rather than stuck on SAVING…
    expect(saveButton(tree)).toBeDefined();
  });

  test('a save that succeeds closes the panel and shows no error', async () => {
    updateItem.mockResolvedValue(undefined);

    resetHooks();
    saveButton(render()).props.onClick();
    await flush();

    beginRender();
    const tree = render();

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(pixReact).toHaveBeenCalledWith('save');
    expect(alertText(tree)).toBe('');
  });

  test('a network failure is named rather than shown as a code', async () => {
    updateItem.mockRejectedValue(apiError('NETWORK_ERROR'));

    resetHooks();
    saveButton(render()).props.onClick();
    await flush();

    beginRender();
    expect(alertText(render())).toContain('Cannot reach the server — nothing was saved.');
  });
});

describe('a delete that fails', () => {
  /** Open the confirmation, then confirm it. */
  async function confirmDelete() {
    resetHooks();
    deleteButton(render()).props.onClick();

    beginRender();
    const modal = find(render(), n => n.type?.name === 'DeleteModal');
    modal.props.onConfirm();
    await flush();

    beginRender();
    return render();
  }

  test('says so inline, closes the confirmation, and keeps the entry', async () => {
    deleteItem.mockRejectedValue(apiError('INTERNAL_ERROR'));

    const tree = await confirmDelete();

    const message = alertText(tree);
    expect(message).toContain('Could not delete this entry');
    expect(message).toContain('INTERNAL_ERROR');
    expect(message).toContain('still in your vault');

    // The modal is gone, so the message underneath is actually visible
    // and a red DELETE button is not re-offered on top of it.
    expect(find(tree, n => n.type?.name === 'DeleteModal')).toBeUndefined();

    expect(onDone).not.toHaveBeenCalled();
    expect(pixReact).not.toHaveBeenCalledWith('remove');
    expect(console.error).toHaveBeenCalled();
  });

  test('a delete that succeeds closes the panel and shows no error', async () => {
    deleteItem.mockResolvedValue(undefined);

    const tree = await confirmDelete();

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(pixReact).toHaveBeenCalledWith('remove');
    expect(alertText(tree)).toBe('');
  });
});
