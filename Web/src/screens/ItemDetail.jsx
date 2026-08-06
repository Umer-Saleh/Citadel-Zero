import { useState, useEffect, useRef } from 'react';
import { useVault } from '../context/VaultContext';
import { Card, Input, Button } from '../components/ui';

const EMPTY = { site: '', username: '', password: '', url: '', notes: '' };

export function ItemDetail({ itemId, onDone }) {
  const { items, addItem, updateItem, deleteItem } = useVault();

  const existing = itemId ? items.find(it => it.id === itemId) : null;
  const [form, setForm] = useState(existing ? existing.data : EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copiedField, setCopiedField] = useState(null);

  const clearTimer = useRef(null);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    try {
      if (itemId) await updateItem(itemId, form);
      else await addItem(form);
      onDone();
    } catch {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteItem(itemId);
      onDone();
    } catch {
      setBusy(false);
    }
  }

  // Copy a field, then clear the clipboard after 30 seconds.
  function copy(field, value) {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedField(field);
    clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      navigator.clipboard.writeText('')
        .then(() => console.log('clipboard cleared'))
        .catch(err => console.log('clipboard clear FAILED:', err.name, err.message));
      setCopiedField(null);
    }, 30000);
  }

  useEffect(() => () => clearTimeout(clearTimer.current), []);

  return (
    <div style={{ maxWidth: 560 }}>
      <button
        onClick={onDone}
        style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', font: '500 14px Geist', marginBottom: 16, padding: 0 }}
      >
        ← Back to vault
      </button>

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h1 style={{ margin: 0, font: '700 22px Geist, sans-serif', color: 'var(--text)' }}>
          {itemId ? 'Edit entry' : 'New entry'}
        </h1>

        <Input label="Site / name" placeholder="github.com" value={form.site} onChange={set('site')} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input label="Username" placeholder="you@example.com" value={form.username} onChange={set('username')} mono />
          {form.username && (
            <button onClick={() => copy('username', form.username)} style={copyBtn}>
              {copiedField === 'username' ? '✓ copied · will clear in 30 seconds if this tab stays focused' : 'copy username'}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input label="Password" revealable mono placeholder="••••••••" value={form.password} onChange={set('password')} />
          {form.password && (
            <button onClick={() => copy('password', form.password)} style={copyBtn}>
              {copiedField === 'password' ? '✓ copied · will clear in 30 seconds if this tab stays focused' : 'copy password'}
            </button>
          )}
        </div>

        <Input label="URL" placeholder="https://…" value={form.url} onChange={set('url')} mono />

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ font: "600 12px Geist, sans-serif", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Notes</span>
          <textarea
            value={form.notes} onChange={set('notes')} rows={3}
            style={{
              background: 'var(--bg)', border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
              padding: '12px 14px', font: "400 14px 'Geist Mono', monospace", color: 'var(--text)',
              resize: 'vertical', outline: 'none'
            }}
          />
        </label>

        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          <Button onClick={save} disabled={busy || !form.site} style={{ flex: 1 }}>
            {busy ? 'SAVING…' : itemId ? 'SAVE CHANGES' : 'SAVE ENTRY'}
          </Button>
          {itemId && (
            <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
              DELETE
            </Button>
          )}
        </div>
      </Card>

      {confirmDelete && (
        <DeleteModal
          site={form.site}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
          busy={busy}
        />
      )}
    </div>
  );
}

const copyBtn = {
  alignSelf: 'flex-start', background: 'none', border: 'none',
  color: 'var(--green)', cursor: 'pointer',
  font: "500 12px 'Geist Mono', monospace", padding: 0
};

function DeleteModal({ site, onCancel, onConfirm, busy }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
      display: 'grid', placeItems: 'center', zIndex: 50, padding: 24
    }}>
      <Card style={{ width: 400, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h2 style={{ margin: 0, font: '700 19px Geist, sans-serif', color: 'var(--text)' }}>Delete this entry?</h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
          <strong style={{ color: 'var(--text)' }}>{site || 'This entry'}</strong> will be permanently removed. This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <Button variant="secondary" onClick={onCancel} style={{ flex: 1 }}>CANCEL</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy} style={{ flex: 1 }}>
            {busy ? 'DELETING…' : 'DELETE'}
          </Button>
        </div>
      </Card>
    </div>
  );
}