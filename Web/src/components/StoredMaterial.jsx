import { useState, useEffect } from 'react';
import { useVault } from '../context/VaultContext';
import { api } from '../api/client';
import { DEMO_MODE } from '../lib/demo';
import { ErrorNote } from './ui';
import { codeToMessage } from '../lib/errors';

/**
 * "What the server actually stores."
 *
 * The README asks a reader to run
 *
 *     SELECT encrypted_data, nonce FROM vault_items;
 *
 * and compare it against what the client shows. That comparison is
 * the entire claim of this project, and on a hosted demo nobody has a
 * psql prompt. So this puts the two side by side: the rows exactly as
 * they sit on disk, and the plaintext this browser decrypted from
 * them a moment ago with a key the server has never held.
 *
 * Demo instances only. The endpoint is not mounted otherwise, and
 * this component is dropped from an ordinary build along with it.
 */
export function StoredMaterial() {
  const { items, email } = useVault();
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  // Read the server again whenever there is a reason to.
  //
  // The guard used to include `raw`, which meant the fetch happened
  // ONCE per mount and never again. Add an entry, reopen the panel,
  // and it still showed the old set of rows — while the paragraph
  // above them claimed to be showing "the row exactly as Postgres
  // holds it". The row was in Postgres. The panel was not looking.
  // That is the one thing this component may never do, because
  // comparing stale ciphertext against freshly decrypted plaintext is
  // not the comparison it says it is making.
  //
  // `items` is the dependency that matters. VaultContext gives it a
  // new identity on every add, update and delete and on the initial
  // load, and on nothing else — so this re-reads exactly when the
  // vault has actually changed underneath it, including while the
  // panel is open.
  useEffect(() => {
    if (!DEMO_MODE || !open) return;

    let cancelled = false;

    api.get('/api/demo/stored-material')
      // Clearing the previous failure is part of succeeding.
      //
      // It never happened, so the panel could render a full, correct
      // set of rows with "Cannot reach the server." still sitting in
      // red above them — telling the reader two contradictory things
      // at once, on the screen whose entire purpose is being believed.
      //
      // Cleared HERE rather than when the request starts, which also
      // works but blanks the message for the length of every retry and
      // puts a setState in the effect body for no benefit. A failure
      // that is still failing should keep saying so.
      .then(d => { if (!cancelled) { setRaw(d); setError(''); } })
      // e.code used to be the WHOLE message, so a visitor read the
      // bare string "INTERNAL_ERROR" in red with no sentence around
      // it — the rawest surfacing anywhere in the client.
      .catch(e => { if (!cancelled) setError(codeToMessage(e, 'Could not load the stored material')); });

    return () => { cancelled = true; };
  }, [open, items]);

  if (!DEMO_MODE) return null;

  // Pair each stored row with the decrypted item of the same id. The
  // vault list is already decrypted in memory, so nothing extra is
  // unsealed to render this.
  const byId = new Map(items.map(it => [it.id, it.data]));

  // ---------------------------------------------------------------
  // THE PANEL MUST NOT COMPARE TWO DIFFERENT ACCOUNTS.
  //
  // This is not hypothetical. Production served a build of
  // /api/demo/stored-material that predated ownership scoping — still
  // pinned to one shared DEMO_EMAIL account rather than reading the
  // caller's own rows — against a current client that provisions a
  // per-visitor vault. Every id in `raw.items` therefore belonged to a
  // different account than the one this browser had unlocked, every
  // row fell to the "(not loaded in this session)" branch below, and
  // the panel rendered a confident, plausible, WRONG answer for as
  // long as that skew lasted.
  //
  // A silent wrong answer is the worst failure available to this
  // component specifically. Every other screen that misreports is
  // merely broken; this one is the project's evidence that the
  // ciphertext on the left really does correspond to the plaintext on
  // the right, and evidence that quietly compares unrelated rows is
  // worse than no evidence at all. So it refuses out loud instead.
  //
  // Compared case-insensitively and trimmed: the server stores the
  // address as it was given, with no normalisation, so an account
  // could legitimately differ from what was typed by case alone.
  //
  // Both sides must be present to claim a mismatch. A missing `email`
  // means we cannot tell, and "cannot tell" must not render as
  // "wrong" — that would be the same class of overclaiming this guard
  // exists to prevent.
  // ---------------------------------------------------------------
  const sessionEmail = (email || '').trim().toLowerCase();
  const panelEmail = (raw?.account?.email || '').trim().toLowerCase();
  const accountMismatch = Boolean(sessionEmail && panelEmail && sessionEmail !== panelEmail);

  // Closing forgets what was read.
  //
  // The effect above already re-reads on the next open, so this is not
  // what makes the panel fresh — it removes the window where the OLD
  // rows are painted for the fraction of a second before the new ones
  // land. On any other panel that flicker would be a nicety. Here the
  // stale frame is the exact false claim this component exists to
  // avoid making, so it is worth the LOADING… beat instead.
  const toggle = () => {
    if (open) { setRaw(null); setError(''); }
    setOpen(!open);
  };

  return (
    <section style={{ marginTop: 32 }}>
      <button
        onClick={toggle}
        aria-expanded={open}
        className="vk-r-touch-y"
        style={{
          width: '100%', textAlign: 'left', cursor: 'pointer',
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '16px 18px', borderRadius: 'var(--radius)',
          border: '1px dashed var(--edge)', background: 'transparent',
          color: 'var(--text)'
        }}
      >
        <span style={{
          fontFamily: "'Press Start 2P', monospace", fontSize: 10,
          color: 'var(--green)', marginTop: 2
        }}>
          {open ? '▾' : '▸'}
        </span>

        <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            font: "600 12px 'Geist Mono', monospace", letterSpacing: '.14em'
          }}>
            WHAT THE SERVER ACTUALLY STORES
            <span style={{
              font: "600 9px 'Geist Mono', monospace", letterSpacing: '.14em',
              color: 'var(--amber)', border: '1px solid var(--amber)',
              borderRadius: 'var(--radius)', padding: '2px 6px'
            }}>
              DEMO ACCOUNT
            </span>
          </span>

          {/* The point of the panel, stated before it is opened. It was
              previously only visible after expanding, which made the
              row read as a debug toggle. */}
          <span style={{
            font: "400 12px Geist, sans-serif", color: 'var(--muted)',
            letterSpacing: 0, textWrap: 'pretty'
          }}>
            Side by side: the exact rows sitting in Postgres, and the plaintext
            this browser decrypted from them with a key the server has never
            held. {open ? 'Tap to hide.' : 'Tap to see them.'}
          </span>
        </span>
      </button>

      {open && (
        <div style={{
          marginTop: 12, padding: 20,
          border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
          background: 'var(--surface)',
          animation: 'riseIn .3s cubic-bezier(.2,.9,.3,1) both'
        }}>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 20px', textWrap: 'pretty', maxWidth: '72ch' }}>
            <strong style={{ color: 'var(--text)' }}>On disk</strong> is the row exactly
            as Postgres holds it. <strong style={{ color: 'var(--text)' }}>In this browser</strong> is
            what was decrypted from that row, using a key derived from the master
            password — which the server has never received and cannot derive.
            Nothing on the left can produce anything on the right without that
            password.
          </p>

          <ErrorNote message={error} />
          {!raw && !error && (
            <div style={{ font: "500 12px 'Geist Mono', monospace", color: 'var(--muted)' }}>
              LOADING…
            </div>
          )}

          {/* Refused, and the account rows are refused with it. They
              are the same wrong account's material — showing them
              would be the identical error one row further up. */}
          {raw && accountMismatch && (
            <AccountMismatch sessionEmail={email} panelEmail={raw.account.email} />
          )}

          {raw && !accountMismatch && (
            <>
              <Row
                label="wrapped_dek"
                stored={raw.account.wrappedDek.ciphertext}
                nonce={raw.account.wrappedDek.nonce}
                tag={raw.account.wrappedDek.authTag}
                plain="the 32-byte data key — sealed under a key derived from the master password, so this row is what the server holds and cannot open"
                plainIsNote
              />
              <Row
                label="kdf_salt / kdf_params"
                stored={raw.account.kdfSalt}
                plain={`m=${raw.account.kdfParams.m} KiB, t=${raw.account.kdfParams.t}, p=${raw.account.kdfParams.p} — public by design, the client needs them to derive`}
                plainIsNote
              />

              {raw.items.map(row => {
                const data = byId.get(row.id);
                return (
                  <Row
                    key={row.id}
                    label={`vault_items · ${row.id.slice(0, 8)}`}
                    stored={row.encryptedData}
                    nonce={row.nonce}
                    tag={row.authTag}
                    plain={data
                      ? `${data.site}\n${data.username}\n${data.password}`
                      : '(not loaded in this session)'}
                  />
                );
              })}

              <p style={{
                fontSize: 12, color: 'var(--muted)', margin: '20px 0 0',
                textWrap: 'pretty', maxWidth: '72ch'
              }}>
                Not shown, because the server does not expose them anywhere:
                <code style={{ color: 'var(--text)' }}> auth_hash</code> and
                <code style={{ color: 'var(--text)' }}> totp_secret</code>. Note also
                that every ciphertext above is one of a few fixed lengths — items are
                padded into power-of-two buckets before encryption, so the stored size
                does not reveal how long a password is.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The endpoint answered for an account this browser has not unlocked.
 *
 * Says which two accounts, because the whole value of catching this is
 * that the next person sees the cause instead of rediscovering it: the
 * two addresses side by side name a server/client version skew
 * immediately. Both are demo addresses on a demo instance — this
 * component does not render on any other build.
 */
function AccountMismatch({ sessionEmail, panelEmail }) {
  // Typography only, same reasoning as Row: the addresses below carry
  // .vk-r-break themselves, and a blanket break-all here would also
  // have applied to the labels beside them.
  const mono = { font: "500 11px 'Geist Mono', monospace" };

  return (
    <div
      role="alert"
      style={{
        border: '1px solid var(--red)', borderRadius: 'var(--radius)',
        padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12
      }}
    >
      <div style={{
        font: "600 11px 'Geist Mono', monospace", letterSpacing: '.16em',
        color: 'var(--red)'
      }}>
        COMPARISON REFUSED — ACCOUNT MISMATCH
      </div>

      <div style={{ fontSize: 13, color: 'var(--muted)', textWrap: 'pretty', maxWidth: '72ch' }}>
        The server returned stored material for a different account than the one
        this browser has unlocked, so nothing here can be lined up against
        anything. Showing the rows anyway would be a comparison between two
        unrelated vaults, which is exactly the claim this panel exists to make
        honestly — so it makes none.
      </div>

      {/* Stacks with the same class the Row grid uses, so the two
          addresses stay readable at 375px instead of being squeezed
          into two unreadable columns. */}
      <div className="vk-r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ ...mono, color: 'var(--muted)', marginBottom: 4 }}>SERVER ANSWERED FOR</div>
          <div className="vk-r-break" style={{ ...mono, color: 'var(--text)' }}>{panelEmail}</div>
        </div>
        <div>
          <div style={{ ...mono, color: 'var(--muted)', marginBottom: 4 }}>THIS BROWSER UNLOCKED</div>
          <div className="vk-r-break" style={{ ...mono, color: 'var(--text)' }}>{sessionEmail}</div>
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--muted)', textWrap: 'pretty', maxWidth: '72ch' }}>
        This is a deployment fault, not something you did — the API and the
        frontend are running different versions. Your vault is unaffected.
      </div>
    </div>
  );
}

function Row({ label, stored, nonce, tag, plain, plainIsNote }) {
  // Typography only. `word-break: break-all` used to live here and was
  // spread onto every div below, including the right-hand explanation
  // — which is PROSE, and which it duly split as "the master passwo /
  // rd" and "cannot deri / ve". break-all breaks mid-word whether or
  // not it needs to; that is right for a 180-character base64 blob and
  // wrong for a sentence.
  //
  // Breaking is opt-in now, via .vk-r-break, which is overflow-wrap:
  // anywhere — it breaks a word only when the word genuinely cannot
  // fit. Note the inline rule was also DEFEATING that class on the
  // ciphertext div: inline styles beat class selectors, so the
  // considered rule lost to the blanket one.
  const mono = {
    font: "500 11px 'Geist Mono', monospace",
    lineHeight: 1.5
  };

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        font: "600 10px 'Geist Mono', monospace", letterSpacing: '.14em',
        color: 'var(--green)', marginBottom: 6
      }}>
        {label}
      </div>

      {/* Stacks on mobile rather than shrinking to two ~99px columns.
          The pairing survives because each half keeps its ON DISK /
          IN THIS BROWSER label and they stay adjacent — losing the
          comparison would remove the only reason this panel exists. */}
      <div className="vk-r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{
          padding: 12, borderRadius: 'var(--radius)',
          background: 'var(--bg)', border: '1px solid var(--edge)'
        }}>
          <div style={{ ...mono, color: 'var(--muted)', marginBottom: 6 }}>ON DISK</div>
          <div className="vk-r-break" style={{ ...mono, color: 'var(--text)' }}>
            {stored.length > 180 ? stored.slice(0, 180) + '…' : stored}
          </div>
          {nonce && (
            <div className="vk-r-break" style={{ ...mono, color: 'var(--muted)', marginTop: 8 }}>
              nonce {nonce}<br />tag {tag}
            </div>
          )}
        </div>

        <div style={{
          padding: 12, borderRadius: 'var(--radius)',
          background: 'var(--bg)',
          border: `1px solid ${plainIsNote ? 'var(--edge)' : 'var(--green)'}`
        }}>
          <div style={{ ...mono, color: 'var(--muted)', marginBottom: 6 }}>
            {plainIsNote ? 'WHAT IT IS' : 'IN THIS BROWSER'}
          </div>
          {/* The two halves of this panel hold different KINDS of
              string. On a note row this is a sentence explaining what
              the row is, and it must break at spaces like any other
              prose. On an item row it is the decrypted entry — a
              password among other things — which has no spaces to
              break at and must be allowed to break anywhere. */}
          <div
            className={plainIsNote ? undefined : 'vk-r-break'}
            style={{
              ...mono,
              color: plainIsNote ? 'var(--muted)' : 'var(--text)',
              whiteSpace: 'pre-wrap'
            }}
          >
            {plain}
          </div>
        </div>
      </div>
    </div>
  );
}
