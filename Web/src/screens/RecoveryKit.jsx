import { useState } from 'react';
import { Card, Button } from '../components/ui';
import { Paladin } from '../components/Paladin';

export function RecoveryKit({ recoveryKey, email, onContinue }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(recoveryKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function download() {
    const body =
      `VAULTKEEP RECOVERY KEY\n` +
      `======================\n\n` +
      `Account: ${email}\n\n` +
      `Recovery key:\n${recoveryKey}\n\n` +
      `This key is the ONLY way back into your vault if you forget your\n` +
      `master password. VaultKeep holds no copy and cannot reset it.\n` +
      `Store it offline, somewhere safe. Anyone with this key and your\n` +
      `email can take over your vault.\n`;

    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vaultkeep-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 24px' }}>
      <div style={{ width: 560, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* PIX kneels in his solemn oath — this is the weighty moment */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Paladin pose="oath" size={64} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 style={{ margin: 0, font: '700 26px Geist, sans-serif', color: 'var(--text)' }}>Your recovery kit</h1>
            <div style={{ fontSize: 15, color: 'var(--muted)' }}>
              This key is shown once. It is the only way back into your vault if you
              forget your master password.
            </div>
          </div>
        </div>

        <Card style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ font: "600 12px Geist, sans-serif", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Recovery key
            </span>
            <div style={{
              background: 'var(--bg)', border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
              padding: '28px 20px', textAlign: 'center',
              font: "600 19px 'Geist Mono', monospace", letterSpacing: '.2em', color: 'var(--text)',
              wordBreak: 'break-word'
            }}>
              {recoveryKey}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <Button variant="secondary" onClick={copy} style={{ flex: 1 }}>
              {copied ? '✓ COPIED' : 'COPY'}
            </Button>
            <Button variant="secondary" onClick={download} style={{ flex: 1 }}>
              DOWNLOAD
            </Button>
            <Button variant="secondary" onClick={() => window.print()} style={{ flex: 1 }}>
              PRINT
            </Button>
          </div>

          {/* The unmissable warning */}
          <div style={{
            border: '1px solid color-mix(in srgb, var(--amber) 55%, var(--edge))',
            borderRadius: 'var(--radius)', padding: '16px 20px',
            display: 'flex', gap: 14, alignItems: 'flex-start'
          }}>
            <span style={{ color: 'var(--amber)', fontSize: 18, marginTop: 2 }}>⚠</span>
            <div style={{ fontSize: 14, lineHeight: 1.55 }}>
              <strong>If you lose both your master password and this key, your vault is gone.</strong>
              <br />
              <span style={{ color: 'var(--muted)' }}>
                We hold no copy and cannot reset it — that's what zero-knowledge means.
                Store this key offline, somewhere safe.
              </span>
            </div>
          </div>

          {/* Required confirmation gates the continue button */}
          <label style={{ display: 'flex', gap: 14, alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={saved}
              onChange={e => setSaved(e.target.checked)}
              style={{ width: 20, height: 20, accentColor: 'var(--green)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 15 }}>I've saved my recovery key somewhere safe.</span>
          </label>

          <Button onClick={onContinue} disabled={!saved}>
            CONTINUE TO MY VAULT
          </Button>
        </Card>
      </div>
    </section>
  );
}