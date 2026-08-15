import { useState, useEffect, useRef } from 'react';
import { Card, Button } from '../components/ui';
import { Paladin } from '../components/Paladin';
import { Icon } from '../components/Icon';
import { copySecret } from '../lib/clipboard';

export function RecoveryKit({ recoveryKey, email, onContinue }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const labelTimer = useRef(null);
  const detachClip = useRef(null);

  // The recovery key is a secret like any other — it unwraps the DEK
  // on its own and can never be rotated. It goes through the same
  // route as passwords, so the 30s clear can't be forgotten here.
  // Clearing is safe: the key is still on screen to copy again.
  function copy() {
    detachClip.current?.();
    detachClip.current = copySecret(recoveryKey);

    setCopied(true);
    clearTimeout(labelTimer.current);
    labelTimer.current = setTimeout(() => setCopied(false), 1600);
  }

  useEffect(() => () => {
    clearTimeout(labelTimer.current);
    detachClip.current?.();          // stop the label; the clear still fires
  }, []);

  function download() {
    const body =
      `CITADEL ZERO RECOVERY KEY\n` +
      `=========================\n\n` +
      `Account: ${email}\n\n` +
      `Recovery key:\n${recoveryKey}\n\n` +
      `This key is the ONLY way back into your vault if you forget your\n` +
      `master password. Citadel Zero holds no copy and cannot reset it.\n` +
      `Store it offline, somewhere safe. Anyone with this key and your\n` +
      `email can take over your vault.\n`;

    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'citadel-zero-recovery-key.txt';
    a.click();

    // Revoking synchronously after click() can race the download in
    // some browsers — the URL dies before the fetch for it starts.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <section style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 24px', position: 'relative', zIndex: 1 }}>
      <div style={{ width: 560, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* PIX kneels in his solemn oath — this is the weighty moment */}
        <div className="vk-noprint" style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Paladin pose="oath" size={64} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 style={{ margin: 0, font: '700 26px Geist, sans-serif', color: 'var(--text)' }}>Your recovery kit</h1>
            <div style={{ fontSize: 15, color: 'var(--muted)', textWrap: 'pretty' }}>
              This key is shown once. It is the only way back into your vault if you
              forget your master password.
            </div>
          </div>
        </div>

        <Card className="vk-print" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Paper only. On screen this context is already carried by
              the heading above; on paper that heading isn't printed,
              and a bare key in a drawer is unidentifiable. */}
          <div className="vk-printonly" style={{ display: 'none' }}>
            <h2 style={{ margin: 0, font: '700 18px Geist, sans-serif' }}>Citadel Zero recovery key</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13 }}>{email}</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ font: "600 12px Geist, sans-serif", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Recovery key
            </span>
            <div className="vk-secret" style={{
              background: 'var(--bg)', border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
              padding: '28px 20px', textAlign: 'center',
              font: "600 19px 'Geist Mono', monospace", letterSpacing: '.2em', color: 'var(--text)',
              wordBreak: 'break-word'
            }}>
              {recoveryKey}
            </div>
          </div>

          {/* prototype's kit buttons are smaller than the default:
              12px type, 11px 16px padding */}
          <div className="vk-noprint" style={{ display: 'flex', gap: 12 }}>
            <Button variant="secondary" onClick={copy} style={kitBtn}>
              {copied ? <><Icon name="check" /> COPIED</> : <><Icon name="copy" /> COPY</>}
            </Button>
            <Button variant="secondary" onClick={download} style={kitBtn}>
              <Icon name="download" /> DOWNLOAD
            </Button>
            <Button variant="secondary" onClick={() => window.print()} style={kitBtn}>
              <Icon name="printer" /> PRINT
            </Button>
          </div>

          {/* The unmissable warning — printed too: it's the part that
              explains what the sheet is and why it matters. */}
          <div style={{
            border: '1px solid color-mix(in srgb, var(--amber) 55%, var(--edge))',
            borderRadius: 'var(--radius)', padding: '16px 20px',
            display: 'flex', gap: 14, alignItems: 'flex-start'
          }}>
            <span style={{ color: 'var(--amber)', marginTop: 2 }}><Icon name="shield" size={18} /></span>
            <div style={{ fontSize: 14, lineHeight: 1.55, textWrap: 'pretty' }}>
              <strong>If you lose both your master password and this key, your vault is gone.</strong>
              <br />
              <span style={{ color: 'var(--muted)' }}>
                We hold no copy and cannot reset it — that's what zero-knowledge means.
                Store this key offline, somewhere safe.
              </span>
            </div>
          </div>

          {/* Required confirmation gates the continue button */}
          <div className="vk-noprint">
            <PixelCheckbox checked={saved} onChange={setSaved}>
              I've saved my recovery key somewhere safe.
            </PixelCheckbox>
          </div>

          {/* No glow on this button, unlike every other primary action.
              This screen is a warning, not a celebration — the same
              reason PIX kneels instead of cheering. */}
          <div className="vk-noprint">
            <Button
              onClick={onContinue}
              disabled={!saved}
              style={{
                width: '100%', padding: '14px 24px', letterSpacing: '.12em',
                boxShadow: '0 3px 0 var(--green-deep)'
              }}
            >
              CONTINUE TO MY VAULT
            </Button>
          </div>
        </Card>
      </div>
    </section>
  );
}

/**
 * Pixel checkbox. A real <input> stays in the DOM for keyboard focus
 * and screen readers — it's just visually hidden, with the drawn box
 * rendered beside it. An OS checkbox would be the only stock control
 * in an app of hand-built furniture, on its most important screen.
 */
function PixelCheckbox({ checked, onChange, children }) {
  return (
    <label style={{ display: 'flex', gap: 14, alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        // Visually hidden, NOT display:none — that would remove it
        // from the tab order and from the accessibility tree.
        style={{
          position: 'absolute', opacity: 0, width: 24, height: 24,
          margin: 0, cursor: 'pointer'
        }}
      />
      <span style={{
        width: 24, height: 24, flexShrink: 0,
        border: `1px solid ${checked ? 'var(--green)' : 'var(--edge)'}`,
        borderRadius: 2,
        background: checked ? 'var(--green)' : 'var(--bg)',
        display: 'grid', placeItems: 'center',
        color: 'var(--on-green)',
        boxShadow: '0 2px 0 var(--edge)',
        transition: 'background .15s, border-color .15s'
      }}>
        {checked ? <Icon name="check" size={14} /> : ''}
      </span>
      <span style={{ fontSize: 15 }}>{children}</span>
    </label>
  );
}

const kitBtn = {
  flex: 1,
  justifyContent: 'center',
  font: '600 12px Geist, sans-serif',
  letterSpacing: '.1em',
  padding: '11px 16px'
};