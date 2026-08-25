import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useVault } from '../context/VaultContext';
import { usePix } from '../context/PixContext';
import { copySecret } from '../lib/clipboard';
import { Icon } from '../components/Icon';

const EMPTY = { site: '', username: '', password: '', url: '', notes: '' };

export function ItemDetail({ itemId, onDone, injectedPassword, onInjected }) {
  const { items, addItem, updateItem, deleteItem } = useVault();
  const { react } = usePix();

  const existing = itemId ? items.find(it => it.id === itemId) : null;
  const base = existing ? existing.data : EMPTY;

  const [form, setForm] = useState(base);
  const [revealed, setRevealed] = useState(false);

  // Separate flags: DELETE and SAVE used to share one `busy`, so
  // confirming a delete made the save button read "SAVING…" too.
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = saving || deleting;

  const [confirmDelete, setConfirmDelete] = useState(false);

  // Seconds left before the clipboard is wiped, and which field is on
  // it. null = nothing of ours is there, so no meter renders.
  const [copyLeft, setCopyLeft] = useState(null);
  const [copyField, setCopyField] = useState('');
  const detachClip = useRef(null);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  // Name uniqueness is enforced client-side, and can only be enforced
  // there: the server holds ciphertext and has no idea what an entry
  // is called. Case-insensitive, since "GitHub" and "github" are the
  // same site to a person looking for it.
  const nameTaken = items.some(it =>
    it.id !== itemId &&
    (it.data.site || '').trim().toLowerCase() === form.site.trim().toLowerCase()
  );

  // A soft warning, not a rule.
  //
  // This can ONLY happen client-side, and only for items currently
  // loaded. The server stores ciphertext and cannot compare it — two
  // identical passwords encrypt to completely different bytes, because
  // every encryption gets a fresh nonce. That's the design working
  // correctly; it just means reuse detection has to live here.
  const passwordReused = form.password.length > 0 && items.some(it =>
    it.id !== itemId && it.data.password === form.password
  );

  async function save() {
    if (nameTaken) return;   // the button is disabled, but don't rely on that alone
    setSaving(true);
    try {
      // Encryption happens inside addItem/updateItem (VaultContext),
      // using the in-memory DEK. Plaintext never leaves this function.
      if (itemId) await updateItem(itemId, form);
      else await addItem(form);
      react('save');
      onDone();
    } catch {
      setSaving(false);
    }
  }

  async function remove() {
    // Nothing to delete on an unsaved entry. The button is already
    // gated on itemId, but a stale id reaching here would send a
    // DELETE for someone else's row.
    if (!itemId) { setConfirmDelete(false); return; }
    setDeleting(true);
    try {
      await deleteItem(itemId);
      // Solemn, not celebratory — an acknowledgement that something
      // irreversible happened, which is worth more here than anywhere.
      react('remove');
      onDone();
    } catch {
      setDeleting(false);
    }
  }

  // The 30s clear is guaranteed app-wide by copySecret; this component
  // only renders the countdown it reports.
  function copy(field, value) {
    detachClip.current?.();
    setCopyField(field);
    react('copy');

    detachClip.current = copySecret(value, (left) => {
      setCopyLeft(left);
      // null means the clipboard was just wiped. The one moment where
      // the clear becomes visible rather than merely promised.
      if (left === null) react('clipClear');
    });
  }

  // Detach UI updates only. Do NOT cancel — if the user navigates away
  // right after copying, the clear must still happen.
  useEffect(() => () => detachClip.current?.(), []);

  // A password arrived from the forge. Merge it into whatever the user
  // has already typed, rather than remounting to seed it — a remount
  // would deliver the password at the cost of the entire draft.
  //
  // Reveal it too: this value has never been shown, and a row of dots
  // gives no way to know it landed.
  //
  // The rule is right in general and wrong here: this merges an
  // external value into state built from user input, so there's
  // nothing to derive it from. The two previous times this fired,
  // there was a better shape available. This time there isn't.
  useEffect(() => {
    if (injectedPassword == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(f => ({ ...f, password: injectedPassword }));
    setRevealed(true);
    onInjected?.();
  }, [injectedPassword, onInjected]);

  const title = form.site || (itemId ? 'Untitled' : 'New entry');
  const letter = form.site ? form.site.charAt(0).toUpperCase() : '+';

  return (
    <div style={{ animation: 'riseIn .22s cubic-bezier(.2,.9,.3,1) both' }}>
      <div className="vk-r-pad" style={panel}>

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <PanelInput
              value={form.site} onChange={set('site')} placeholder="e.g. GitHub"
              font="600 15px Geist, sans-serif"
              name="vk-entry-name"
              autoComplete="off"
              invalid={nameTaken}
            />
            {nameTaken && (
              <span style={{ fontSize: 12, color: 'var(--red)' }}>
                You already have an entry with this name.
              </span>
            )}
          </div>
        </Field>

        {/* ---- USERNAME + copy, meter directly beneath ---- */}
        <Field label="Username">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <PanelInput
                value={form.username} onChange={set('username')} placeholder="you@example.com"
                font="400 14px 'Geist Mono', monospace"
                // Chrome fills anything that looks like a login. These
                // fields hold OTHER sites' credentials, so a saved
                // Citadel Zero login appearing here is actively wrong.
                // The unusual name matters as much as the attribute —
                // Chrome's heuristics key off both.
                name="vk-entry-username"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
              />
              <IconButton title="Copy username" onClick={() => copy('username', form.username)}>
                <Icon name="copy" />
              </IconButton>
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
                name="vk-entry-secret"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
              />
              <IconButton title="Show / hide" onClick={() => setRevealed(r => !r)}>
                <Icon name={revealed ? 'eyeoff' : 'eye'} size={15} />
              </IconButton>
              <IconButton title="Copy password" onClick={() => copy('password', form.password)}>
                <Icon name="copy" />
              </IconButton>
            </div>
            <ClipMeter left={copyField === 'password' ? copyLeft : null} />

            {passwordReused && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--amber)', marginTop: 1 }}>
                  <Icon name="shield" size={14} />
                </span>
                <span style={{ fontSize: 12, color: 'var(--amber)', textWrap: 'pretty' }}>
                  Another entry uses this password. If one site is breached, both
                  accounts are exposed.
                </span>
              </div>
            )}
          </div>
        </Field>

        {/* ---- URL ---- */}
        <Field label="URL">
          <PanelInput
            value={form.url} onChange={set('url')} placeholder="https://"
            font="400 14px 'Geist Mono', monospace"
            name="vk-entry-url"
            autoComplete="off"
          />
        </Field>

        {/* ---- NOTES — sans, not mono: it's prose, not a secret ---- */}
        <Field label="Notes">
          <PanelTextarea value={form.notes} onChange={set('notes')} name="vk-entry-notes" />
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
              <Icon name="trash" /> DELETE
            </PressButton>
          )}
          <div style={{ flex: 1 }} />
          <PressButton
            onClick={save} disabled={busy || !form.site.trim() || nameTaken}
            depth={3}
            style={{
              font: '600 13px Geist, sans-serif', letterSpacing: '.12em',
              padding: '12px 28px', border: '1px solid var(--green-deep)',
              background: 'var(--green)', color: 'var(--on-green)',
              boxShadow: '0 3px 0 var(--green-deep), 0 14px 28px -10px var(--glow)'
            }}
          >
            {saving ? 'SAVING…' : 'SAVE'}
          </PressButton>
        </div>
      </div>

      {/* Portalled to body. A transformed ancestor — riseIn's animation
          on the wrapper above — makes itself the containing block for
          position:fixed, so the modal was centring on the 380px panel
          instead of the viewport. */}
      {confirmDelete && createPortal(
        <DeleteModal
          site={form.site}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
          busy={deleting}
        />,
        document.body
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
 * Clipboard countdown. Rendered under whichever field is currently on
 * the clipboard — and only that one. There is a single system
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

function PanelInput({ font, tracking, invalid, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        flex: 1, minWidth: 0, width: '100%', boxSizing: 'border-box',
        background: 'var(--bg)',
        border: `1px solid ${invalid ? 'var(--red)' : focused ? 'var(--green)' : 'var(--edge)'}`,
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
        display: 'grid', placeItems: 'center',
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
      <div className="vk-r-fluid" style={{
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
        <div className="vk-r-col" style={{ display: 'flex', gap: 12 }}>
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