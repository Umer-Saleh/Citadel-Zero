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
const { MAX_ITEM_BYTES } = await import('../crypto/cipher');
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

/**
 * The failure message, wherever it is rendered.
 *
 * The inline note became the shared <ErrorNote>, which the shim does
 * not invoke — its role and its text live inside that component, not in
 * the tree App returns. So render it on demand. The assertions below
 * are unchanged; only the way the test reaches the string is.
 */
const alertText = (tree) => {
  const note = find(tree, n => n.type?.name === 'ErrorNote');
  if (!note) return '';

  const rendered = note.type(note.props);
  if (!rendered) return '';

  // Still announced — the whole reason the component exists.
  expect(rendered.props.role).toBe('alert');
  return texts(rendered);
};

beforeEach(() => {
  vi.clearAllMocks();
  items = [ENTRY];
  onDone = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a save that fails', () => {
  test('says so inline and leaves the panel open', async () => {
    // INTERNAL_ERROR, because this test is about the GENERIC branch:
    // a code this handler has no sentence for still produces a
    // sentence, with the code named in brackets. It used to use
    // TOO_MANY_REQUESTS, which now has copy of its own and would no
    // longer exercise this path. Every assertion below is unchanged.
    updateItem.mockRejectedValue(apiError('INTERNAL_ERROR'));

    resetHooks();
    saveButton(render()).props.onClick();
    await flush();

    beginRender();
    const tree = render();

    const message = alertText(tree);
    expect(message).toContain('Could not save this entry');
    expect(message).toContain('INTERNAL_ERROR');

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

  test('a rate-limited save explains itself, and keeps the draft', async () => {
    // The shared map has had a sentence for this all along; this
    // handler just never reached it, so the message was the code in
    // brackets standing in for an explanation that already existed.
    updateItem.mockRejectedValue(apiError('TOO_MANY_REQUESTS'));

    resetHooks();
    saveButton(render()).props.onClick();
    await flush();

    beginRender();
    const message = alertText(render());

    expect(message).toContain('Too many requests from this network recently.');
    // The reassurance is why this is not routed through the shared
    // map: the shared sentence cannot say the draft survived.
    expect(message).toContain('Your changes are still here');
    // And the bare code is gone from the visible text.
    expect(message).not.toContain('(TOO_MANY_REQUESTS)');
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

describe('the size limit an entry actually has', () => {
  test('a refused entry is told the boundary that bit it, not the body cap', async () => {
    // This message has quoted THREE dead numbers. 64 KB was the
    // request cap reported as an entry cap. 32 KB was correct while
    // the body limit was 64 KB, because only the 32768 bucket could
    // travel. 65,000 characters was correct in ASCII and nowhere else
    // — the cap is 65,532 BYTES, and a newline or an Arabic letter
    // costs two of them, a CJK character three, an emoji four.
    //
    // ALL THREE guards stay. The '65,000' one was a toContain until
    // this change and is inverted rather than removed: the figure left
    // the copy because no single number is honest across scripts, so
    // what is worth pinning is that it does not come back.
    updateItem.mockRejectedValue(apiError('PAYLOAD_TOO_LARGE'));

    resetHooks();
    saveButton(render()).props.onClick();
    await flush();

    beginRender();
    const message = alertText(render());

    expect(message).not.toContain('64 KB');
    expect(message).not.toContain('32 KB');
    expect(message).not.toContain('65,000');
    // All fields share one encrypted blob, so trimming the notes is
    // the actionable part but not the whole truth.
    expect(message).toContain('all its fields together');
    expect(message).toContain('Your changes are still here');
    // The number lives in the meter now, and the sentence says where.
    expect(message).toContain('size meter under the notes field');
  });

  test('the client refusal says the same thing the server 413 does', async () => {
    // ITEM_TOO_LARGE is what actually fires now — crypto/cipher.js
    // refuses before a request is built. It shares a branch with
    // PAYLOAD_TOO_LARGE precisely so the two cannot drift into quoting
    // different boundaries at the same person. Both now quote none.
    //
    // Note this is ItemDetail's OWN sentence, not the shared map's —
    // the two shared sentences differ from each other and from this
    // one on purpose, and errors.test.js pins those separately.
    updateItem.mockRejectedValue(apiError('ITEM_TOO_LARGE'));

    resetHooks();
    saveButton(render()).props.onClick();
    await flush();

    beginRender();
    const message = alertText(render());

    expect(message).not.toContain('64 KB');
    expect(message).not.toContain('32 KB');
    expect(message).not.toContain('65,000');
    expect(message).toContain('all its fields together');
    expect(message).toContain('Your changes are still here');
    expect(message).toContain('size meter under the notes field');
  });

  test('an oversized entry is stopped before it is sent, not after', async () => {
    // The bug this closes: a long note could be typed in full, saved,
    // and refused by the server with no size at which it would ever
    // succeed. The fix is not a better error — it is not reaching the
    // network at all.
    items = [{
      id: 'i1',
      data: { ...ENTRY.data, notes: 'x'.repeat(MAX_ITEM_BYTES) }
    }];

    resetHooks();
    const tree = render();

    // SAVE refuses, and says why rather than sitting there greyed out.
    expect(saveButton(tree).props.disabled).toBe(true);
    expect(texts(tree)).toContain('This entry is too large to store.');

    // And pressing it anyway does nothing — the handler checks too,
    // rather than trusting the disabled attribute.
    saveButton(tree).props.onClick();
    await flush();
    expect(updateItem).not.toHaveBeenCalled();
  });

  test('the budget meter is silent on an ordinary entry', () => {
    // It is shown only in the last quarter of the budget. A credential
    // spends a fraction of a percent, and a meter on every entry in the
    // vault would be noise warning about a case almost nobody meets.
    resetHooks();
    const meter = find(render(), n => n.type?.name === 'SizeMeter');

    expect(meter).toBeDefined();
    expect(meter.type(meter.props)).toBeNull();
  });

  test('the budget meter appears, and counts every field not just notes', () => {
    // Bytes of the whole serialised entry. Someone who trims the notes
    // to fit and still cannot save has to know the title and URL are
    // spending from the same budget.
    const notes = 'x'.repeat(Math.floor(MAX_ITEM_BYTES * 0.95));
    items = [{ id: 'i1', data: { ...ENTRY.data, notes } }];

    resetHooks();
    const meter = find(render(), n => n.type?.name === 'SizeMeter');
    const rendered = meter.type(meter.props);

    expect(rendered).not.toBeNull();

    // The remaining budget is smaller than the notes alone would
    // suggest, because the other fields have already spent from it.
    expect(meter.props.used).toBeGreaterThan(notes.length);
    expect(meter.props.limit).toBe(MAX_ITEM_BYTES);
    expect(texts(rendered)).toContain('LEFT');
  });
});
