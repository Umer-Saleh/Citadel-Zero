import { useState, useEffect } from 'react';
import { useVault } from '../context/VaultContext';
import { api } from '../api/client';
import { DEMO_MODE } from '../lib/demo';

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
  const { items } = useVault();
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!DEMO_MODE || !open || raw) return;

    let cancelled = false;
    api.get('/api/demo/stored-material')
      .then(d => { if (!cancelled) setRaw(d); })
      .catch(e => { if (!cancelled) setError(e.code || 'Could not load stored material.'); });

    return () => { cancelled = true; };
  }, [open, raw]);

  if (!DEMO_MODE) return null;

  // Pair each stored row with the decrypted item of the same id. The
  // vault list is already decrypted in memory, so nothing extra is
  // unsealed to render this.
  const byId = new Map(items.map(it => [it.id, it.data]));

  return (
    <section style={{ marginTop: 32 }}>
      <button
        onClick={() => setOpen(o => !o)}
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

          {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}
          {!raw && !error && (
            <div style={{ font: "500 12px 'Geist Mono', monospace", color: 'var(--muted)' }}>
              LOADING…
            </div>
          )}

          {raw && (
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

function Row({ label, stored, nonce, tag, plain, plainIsNote }) {
  const mono = {
    font: "500 11px 'Geist Mono', monospace",
    wordBreak: 'break-all', lineHeight: 1.5
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
            <div style={{ ...mono, color: 'var(--muted)', marginTop: 8 }}>
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
          <div style={{
            ...mono,
            color: plainIsNote ? 'var(--muted)' : 'var(--text)',
            whiteSpace: 'pre-wrap'
          }}>
            {plain}
          </div>
        </div>
      </div>
    </div>
  );
}
