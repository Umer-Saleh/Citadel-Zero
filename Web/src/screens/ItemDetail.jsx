import { useState, useEffect, useRef } from 'react';
import { useVault } from '../context/VaultContext';
import { copySecret } from '../lib/clipboard';

const EMPTY = { site: '', username: '', password: '', url: '', notes: '' };

export function ItemDetail({ itemId, onDone, injectedPassword, onInjected }) {
  const { items, addItem, updateItem, deleteItem } = useVault();

  const existing = itemId ? items.find(it => it.id === itemId) : null;
  const [form, setForm] = useState(existing ? existing.data : EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // Seconds left before the clipboard is wiped. null = nothing of
  // ours is on the clipboard, so the meter stays hidden.
  const [copyLeft, setCopyLeft] = useState(null);
  const [copyField, setCopyField] = useState('');    // NEW — "PASSWORD" / "USERNAME"
  const detachClip = useRef(null);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    try {
      // Encryption happens inside addItem/updateItem (VaultContext),
      // using the in-memory DEK. Plaintext never leaves this function.
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

  // The clear is guaranteed by copySecret; this component only
  // renders the countdown it reports.
  function copy(label, value) {
    detachClip.current?.();
    setCopyField(label);
    detachClip.current = copySecret(value, setCopyLeft);
  }

  // Detach UI updates only. Do NOT cancel — if the user navigates
  // away right after copying, the clear must still happen.
  useEffect(() => () => detachClip.current?.(), []);

  // A password arrived from the forge. Fill it in and reveal it — the
  // user hasn't seen this value yet, and a row of dots would give them
  // no way to know it landed.
  //
  // This can't be a useState initialiser: the panel may already be
  // mounted and editing an entry when the value arrives, so there's no
  // fresh render to seed. onInjected() tells App to drop its copy.
  useEffect(() => {
    if (injectedPassword == null) return;
    setForm(f => ({ ...f, password: injectedPassword }));
    setRevealed(true);
    onInjected?.();
  }, [injectedPassword, onInjected]);

  const title = form.site || (itemId ? 'Untitled' : 'New entry');
  const letter = form.site ? form.site.charAt(0).toUpperCase() : '+';

  return (
    <div style={{ animation: 'riseIn .5s cubic-bezier(.2,.9,.3,1) both', animationDelay: '.1s' }}>
      <div style={panel}>

        {/* ---- HEADER: 48px avatar + name + url, divider beneath ---- */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          paddingBottom: 14, borderBottom: '1px solid var(--edge)'
        }}>
          <div style={avatar}>{letter}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <h2 style={{
              margin: 0, font: '600 19px Geist, sans-serif',
              color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>
              {title}
            </h2>
            {form.url && (
              <a href={form.url} target="_blank" rel="noreferrer" style={{
                font: "400 12px 'Geist Mono', monospace", color: 'var(--muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textDecoration: 'none'
              }}>
                {form.url}
              </a>
            )}
          </div>
        </div>

        {/* ---- NAME ---- */}
        <Field label="Name">
          <PanelInput
            value={form.site} onChange={set('site')} placeholder="e.g. GitHub"
            font="600 15px Geist, sans-serif"
          />
        </Field>

        {/* ---- USERNAME + copy, meter directly beneath ---- */}
        <Field label="Username">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <PanelInput
                value={form.username} onChange={set('username')} placeholder="you@example.com"
                font="400 14px 'Geist Mono', monospace"
              />
              <IconButton title="Copy username" onClick={() => copy('username', form.username)}>⧉</IconButton>
            </div>
            <ClipMeter left={copyField === 'username' ? copyLeft : null} />
          </div>
        </Field>

        {/* ---- PASSWORD + reveal + copy, meter directly beneath ---- */}
        <Field label="Password">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <PanelInput
                value={form.password} onChange={set('password')}
                type={revealed ? 'text' : 'password'}
                font="500 16px 'Geist Mono', monospace" tracking=".08em"
              />
              <IconButton title="Show / hide" onClick={() => setRevealed(r => !r)}>
                {revealed ? '🙈' : '👁'}
              </IconButton>
              <IconButton title="Copy password" onClick={() => copy('password', form.password)}>⧉</IconButton>
            </div>
            <ClipMeter left={copyField === 'password' ? copyLeft : null} />
          </div>
        </Field>

        {/* ---- URL ---- */}
        <Field label="URL">
          <PanelInput
            value={form.url} onChange={set('url')} placeholder="https://"
            font="400 14px 'Geist Mono', monospace"
          />
        </Field>

        {/* ---- NOTES — sans, not mono: it's prose, not a secret ---- */}
        <Field label="Notes">
          <PanelTextarea value={form.notes} onChange={set('notes')} />
        </Field>

        {/* ---- ACTIONS: delete left, save right, spacer between ---- */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 4 }}>
          {itemId && (
            <PressButton
              onClick={() => setConfirmDelete(true)} disabled={busy}
              depth={2}
              style={{
                font: '600 12px Geist, sans-serif', letterSpacing: '.1em',
                padding: '11px 16px', border: '1px solid var(--edge)',
                background: 'transparent', color: 'var(--red)',
                boxShadow: '0 2px 0 var(--edge)'
              }}
            >
              ✖ DELETE
            </PressButton>
          )}
          <div style={{ flex: 1 }} />
          <PressButton
            onClick={save} disabled={busy || !form.site}
            depth={3}
            style={{
              font: '600 13px Geist, sans-serif', letterSpacing: '.12em',
              padding: '12px 28px', border: '1px solid var(--green-deep)',
              background: 'var(--green)', color: 'var(--on-green)',
              boxShadow: '0 3px 0 var(--green-deep), 0 14px 28px -10px var(--glow)'
            }}
          >
            {busy ? 'SAVING…' : 'SAVE'}
          </PressButton>
        </div>
      </div>

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

/* ================= local primitives =================
   These live here rather than in ui.jsx because the panel has its own
   typographic scale — four different field fonts. Generalising
   <Input> to cover them would make it worse everywhere else it's used.
   ==================================================== */

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{
        font: '600 12px Geist, sans-serif', letterSpacing: '.1em',
        textTransform: 'uppercase', color: 'var(--muted)'
      }}>
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * Clipboard countdown. Rendered under whichever field is currently
 * on the clipboard — and only that one. There is a single system
 * clipboard, so only a single meter can ever be truthful. Copying a
 * second field moves this meter rather than starting a second one.
 */
function ClipMeter({ left }) {
  if (left === null) return null;

  const segsLit = Math.ceil(left / 3);   // 10 segments across 30 seconds

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} style={{
            width: 11, height: 8, borderRadius: 1,
            background: i < segsLit ? 'var(--amber)' : 'var(--edge)',
            transition: 'background .3s'
          }} />
        ))}
      </div>
      <span style={{
        font: "500 11px 'Geist Mono', monospace",
        letterSpacing: '.12em', color: 'var(--muted)'
      }}>
        CLEARS IN {left}S
      </span>
    </div>
  );
}

function PanelInput({ font, tracking, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        flex: 1, minWidth: 0, width: '100%', boxSizing: 'border-box',
        background: 'var(--bg)',
        border: `1px solid ${focused ? 'var(--green)' : 'var(--edge)'}`,
        borderRadius: 'var(--radius)',
        padding: '11px 13px',
        font,
        letterSpacing: tracking || 'normal',
        color: 'var(--text)',
        caretColor: 'var(--green)',
        boxShadow: focused ? '0 0 0 3px var(--glow)' : 'none',
        outline: 'none',
        transition: 'border-color .15s, box-shadow .15s'
      }}
    />
  );
}

function PanelTextarea(props) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      {...props} rows={3}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: '100%', boxSizing: 'border-box', resize: 'vertical',
        background: 'var(--bg)',
        border: `1px solid ${focused ? 'var(--green)' : 'var(--edge)'}`,
        borderRadius: 'var(--radius)',
        padding: '11px 13px',
        font: '400 14px Geist, sans-serif',
        color: 'var(--text)', caretColor: 'var(--green)',
        boxShadow: focused ? '0 0 0 3px var(--glow)' : 'none',
        outline: 'none',
        transition: 'border-color .15s, box-shadow .15s'
      }}
    />
  );
}

function IconButton({ children, ...props }) {
  const [down, setDown] = useState(false);
  return (
    <button
      type="button" {...props}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onMouseLeave={() => setDown(false)}
      style={{
        background: 'none', border: '1px solid var(--edge)',
        borderRadius: 'var(--radius)', padding: '0 12px',
        color: 'var(--muted)', cursor: 'pointer',
        boxShadow: down ? '0 0 0 var(--edge)' : '0 2px 0 var(--edge)',
        transform: down ? 'translateY(2px)' : 'none',
        transition: 'transform .05s, box-shadow .05s'
      }}
    >
      {children}
    </button>
  );
}

// Shared press-down behaviour so DELETE and SAVE get the arcade feel
// without duplicating the mouse-state logic.
function PressButton({ children, style, depth = 3, ...props }) {
  const [down, setDown] = useState(false);
  return (
    <button
      {...props}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onMouseLeave={() => setDown(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderRadius: 'var(--radius)',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
        transition: 'transform .05s, box-shadow .05s, filter .15s',
        ...style,
        ...(down && !props.disabled ? { transform: `translateY(${depth}px)`, boxShadow: 'none' } : {})
      }}
    >
      {children}
    </button>
  );
}

function DeleteModal({ site, onCancel, onConfirm, busy }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
      display: 'grid', placeItems: 'center', zIndex: 50, padding: 24
    }}>
      <div style={{
        width: 400, maxWidth: '90vw',
        background: 'var(--raised)', border: '1px solid var(--edge)',
        borderRadius: 'var(--radius)', boxShadow: '0 24px 48px -16px var(--shadow)',
        padding: 32, display: 'flex', flexDirection: 'column', gap: 16
      }}>
        <h2 style={{ margin: 0, font: '700 19px Geist, sans-serif', color: 'var(--text)' }}>
          Delete this entry?
        </h2>
        <p style={{ margin: 0, font: '400 14px Geist, sans-serif', color: 'var(--muted)' }}>
          <strong style={{ color: 'var(--text)' }}>{site || 'This entry'}</strong> will be
          permanently removed. This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <PressButton onClick={onCancel} depth={2} style={{
            flex: 1, justifyContent: 'center',
            font: '600 13px Geist, sans-serif', letterSpacing: '.1em', padding: '12px 20px',
            border: '1px solid var(--edge)', background: 'transparent',
            color: 'var(--text)', boxShadow: '0 2px 0 var(--edge)'
          }}>
            CANCEL
          </PressButton>
          <PressButton onClick={onConfirm} disabled={busy} depth={3} style={{
            flex: 1, justifyContent: 'center',
            font: '600 13px Geist, sans-serif', letterSpacing: '.1em', padding: '12px 20px',
            border: '1px solid var(--red)', background: 'var(--red)',
            color: '#fff', boxShadow: '0 3px 0 rgba(0,0,0,.25)'
          }}>
            {busy ? 'DELETING…' : 'DELETE'}
          </PressButton>
        </div>
      </div>
    </div>
  );
}

const panel = {
  background: 'var(--surface)',
  border: '1px solid var(--edge)',
  borderRadius: 'var(--radius)',
  boxShadow: '0 14px 32px -16px var(--shadow)',
  padding: 28,
  display: 'flex',
  flexDirection: 'column',
  gap: 18
};

const avatar = {
  width: 48, height: 48, flexShrink: 0,
  background: 'var(--raised)', border: '1px solid var(--edge)',
  borderRadius: 'var(--radius)',
  display: 'grid', placeItems: 'center',
  fontFamily: "'Press Start 2P', monospace", fontSize: 14, color: 'var(--green)'
};