import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { useVault } from '../context/VaultContext';
import { useTheme } from '../context/ThemeContext';
import { usePix } from '../context/PixContext';
import { Card, Input, Button, Meter, Switch, DeriveBar } from '../components/ui';
import { calcStrength } from '../lib/strength';
import { Icon } from '../components/Icon';
import * as totpApi from '../api/totp';

export function Settings() {
  const { email, kdfUpgradeAvailable, changePassword, upgradeKdf } = useVault();
  const { theme, toggle } = useTheme();

  return (
    <div style={{
      maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24,
      animation: 'riseIn .4s cubic-bezier(.2,.9,.3,1) both'
    }}>

      <h1 style={{ margin: 0, font: '700 26px Geist, sans-serif', color: 'var(--text)' }}>Account settings</h1>

      {/* KDF upgrade — only shown when the account's params are stale */}
      {kdfUpgradeAvailable && <KdfUpgrade email={email} upgradeKdf={upgradeKdf} />}

      <ChangePassword email={email} changePassword={changePassword} />

      <TwoFactor email={email} />

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <h2 style={{ margin: 0, font: '600 19px Geist, sans-serif', color: 'var(--text)' }}>Preferences</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 15, flex: 1 }}>Theme</span>
          <span style={{ font: "500 11px 'Geist Mono', monospace", letterSpacing: '.14em', color: 'var(--muted)' }}>
            {theme === 'dark' ? 'DARK' : 'LIGHT'}
          </span>
          <Switch on={theme === 'dark'} onToggle={toggle} label="Dark theme" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15 }}>Lock after idle</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              The vault locks itself and the key leaves memory.
            </span>
          </div>
          <span style={{ font: "500 11px 'Geist Mono', monospace", letterSpacing: '.14em', color: 'var(--muted)' }}>
            5 MIN
          </span>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------
// KDF UPGRADE — requires the master password, since we can only
// re-derive while the user proves they hold it.
//
// The prototype leads this banner with a shield, not the mascot.
// PIX's level-up reaction goes to the header's pixSays line.
// ---------------------------------------------------------------
function KdfUpgrade({ email, upgradeKdf }) {
  const [pw, setPw] = useState('');
  const [phase, setPhase] = useState('prompt');   // 'prompt' | 'confirm' | 'working' | 'done'
  const [error, setError] = useState('');
  const { react } = usePix();

  async function run() {
    setError('');
    if (!pw) return setError('Enter your master password to upgrade.');
    setPhase('working');
    try {
      await upgradeKdf(email, pw);
      setPhase('done');
      react('levelup');
    } catch (e) {
      setPhase('confirm');
      setError(
        e.code === 'INVALID_CREDENTIALS' ? 'Wrong master password.'
        : e.code === 'WEAK_KDF_PARAMS' ? 'The server refused these parameters as too weak. Check DEFAULT_KDF_PARAMS in the client.'
        : e.code === 'VALIDATION_FAILED' ? 'The upgrade request was malformed. This is a bug, not something you did.'
        : e.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
        // Surface unmapped codes rather than swallowing them. The
        // backend returns machine-readable codes precisely so this
        // screen doesn't have to guess — throwing them away wastes
        // the design.
        : `Upgrade failed${e.code ? ` (${e.code})` : ''}.`
      );
    }
  }

  const done = phase === 'done';

  // Banner, not a card: a bordered row that sits above the real
  // settings rather than competing with them.
  return (
    <div style={{
      border: `1px solid color-mix(in srgb, ${done ? 'var(--green)' : 'var(--amber)'} 55%, var(--edge))`,
      borderRadius: 'var(--radius)', background: 'var(--surface)',
      padding: '20px 24px', display: 'flex', gap: 16, alignItems: 'center'
    }}>
      <span style={{ color: done ? 'var(--green)' : 'var(--amber)' }}>
        <Icon name="shield" size={24} />
      </span>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {done ? (
          <>
            <span style={{ font: "600 11px 'Geist Mono', monospace", letterSpacing: '.16em', color: 'var(--green)' }}>
              SECURITY UPGRADED
            </span>
            <span style={{ fontSize: 14, color: 'var(--muted)', textWrap: 'pretty' }}>
              Your key now uses stronger derivation parameters. Your password and every
              entry are unchanged.
            </span>
          </>
        ) : (
          <>
            <span style={{ font: "600 11px 'Geist Mono', monospace", letterSpacing: '.16em', color: 'var(--amber)' }}>
              SECURITY UPGRADE AVAILABLE
            </span>
            {/* Precise, and true of the implementation: upgrading
                re-wraps the 32-byte key and leaves the vault alone.
                The prototype's "takes about a minute" is not — the
                real derivation is a couple of seconds. */}
            <span style={{ fontSize: 14, color: 'var(--muted)', textWrap: 'pretty' }}>
              Your account was created with weaker key-derivation settings. Upgrading
              re-wraps your vault key under stronger ones — your password stays the same
              and your entries are never re-encrypted. Takes a few seconds.
            </span>

            {phase === 'confirm' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                <Input label="Confirm master password" mono type="password"
                  autoComplete="current-password"
                  value={pw} onChange={e => setPw(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && run()} />
                {error && <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>}
                <Button onClick={run} style={{ alignSelf: 'flex-start', font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
                  UPGRADE NOW
                </Button>
              </div>
            )}

            {phase === 'working' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: 'var(--text)' }}>
                  UPGRADING<span style={{ animation: 'blinkCur 1s steps(1) infinite' }}>_</span>
                </span>
                <DeriveBar />
              </div>
            )}
          </>
        )}
      </div>

      {phase === 'prompt' && (
        <Button variant="secondary" onClick={() => setPhase('confirm')}
          style={{ flexShrink: 0, font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
          UPGRADE
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// CHANGE MASTER PASSWORD — re-wraps the DEK, then forces re-login
// (the server revokes all sessions on success).
// ---------------------------------------------------------------
function ChangePassword({ email, changePassword }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // One toggle for the whole section. Input's own `revealable` eye is
  // deliberately unused here — three of them, or one floating between
  // two columns, both read as broken.
  const [revealed, setRevealed] = useState(false);
  const pwType = revealed ? 'text' : 'password';

  const strength = calcStrength(next);
  const mismatch = confirm.length > 0 && confirm !== next;

  async function run() {
    if (busy) return;
    setError('');
    if (!cur || !next) return setError('Fill in every field.');
    if (next !== confirm) return setError("New passwords don't match.");
    if (strength.score < 4) return setError('Choose a stronger new password.');

    setBusy(true);
    try {
      await changePassword(email, cur, next);
      // changePassword() calls lock() on success → App drops to unlock.
    } catch (e) {
      setBusy(false);
      setError(
        e.code === 'INVALID_CREDENTIALS' ? 'Current password is wrong.'
        : e.code === 'WEAK_KDF_PARAMS' ? 'The server rejected the proposed key-derivation parameters.'
        : e.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
        : `Could not change password${e.code ? ` (${e.code})` : ''}.`
      );
    }
  }

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h2 style={{ margin: 0, flex: 1, font: '600 19px Geist, sans-serif', color: 'var(--text)' }}>
          Change master password
        </h2>
        <RevealToggle on={revealed} onToggle={() => setRevealed(r => !r)} />
      </div>

      <div style={{ fontSize: 13, color: 'var(--muted)', textWrap: 'pretty' }}>
        Your vault key is re-wrapped under the new password — your entries are never
        re-encrypted. You'll be signed out and need to unlock again.
      </div>

      <Input label="Current" mono type={pwType} autoComplete="off"
        name="vk-current-master"
        value={cur} onChange={e => setCur(e.target.value)} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Input label="New" mono type={pwType} autoComplete="new-password"
          value={next} onChange={e => setNext(e.target.value)} />
        <Input label="Confirm" mono type={pwType} autoComplete="new-password"
          value={confirm} onChange={e => setConfirm(e.target.value)}
          error={mismatch ? "Doesn't match yet." : ''} />
      </div>

      {next && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Meter score={strength.score} color={strength.color} />
          <span style={{ font: "600 11px 'Geist Mono', monospace", letterSpacing: '.14em', color: strength.color }}>
            {strength.label}
          </span>
        </div>
      )}

      {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}

      <div>
        <Button onClick={run} disabled={busy} style={{ padding: '12px 28px', letterSpacing: '.12em' }}>
          {busy ? 'CHANGING…' : 'UPDATE PASSWORD'}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------
// TWO-FACTOR AUTHENTICATION
//
// Worth being precise about what this protects: the API, not the
// vault. The vault is sealed under a key derived from the master
// password, which the server never sees — a server-side check can't
// gate a key that never arrives. What it does gate is the encrypted
// blobs: a stolen password alone can no longer pull them down.
// ---------------------------------------------------------------
function TwoFactor({ email }) {
  // 'loading' | 'off' | 'scanning' | 'codes' | 'on' | 'disabling'
  const [phase, setPhase] = useState('loading');
  const [secret, setSecret] = useState('');
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    totpApi.isEnabled(email)
      .then(on => { if (alive) setPhase(on ? 'on' : 'off'); })
      .catch(() => { if (alive) setPhase('off'); });
    // `alive` guards against setting state after the user navigates
    // away mid-request.
    return () => { alive = false; };
  }, [email]);

  function fail(e, fallback) {
    setError(
      e.code === 'INVALID_TOTP_CODE' ? 'That code was not accepted. Codes change every 30 seconds — try the current one.'
      : e.code === 'TOTP_ALREADY_ENABLED' ? 'Two-factor is already on for this account.'
      : e.code === 'TOTP_NOT_STARTED' ? 'Start enrolment again — no setup is in progress.'
      : e.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
      : `${fallback}${e.code ? ` (${e.code})` : ''}.`
    );
  }

  async function begin() {
    setError(''); setBusy(true);
    try {
      const { secret: s, uri } = await totpApi.beginEnrolment();
      setSecret(s);
      // Fixed dark-on-white regardless of theme. A QR needs real
      // contrast to scan in poor light, and the dark palette's
      // --bg/--text pair is too close for comfort.
      setQr(await QRCode.toDataURL(uri, {
        margin: 2, width: 200,
        color: { dark: '#1A1E17', light: '#FFFFFF' }
      }));
      setPhase('scanning');
    } catch (e) {
      fail(e, 'Could not start enrolment');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setError(''); setBusy(true);
    try {
      const { backupCodes: codes } = await totpApi.confirmEnrolment(code);
      setBackupCodes(codes);
      setCode('');
      setPhase('codes');
    } catch (e) {
      fail(e, 'Could not confirm');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setError(''); setBusy(true);
    try {
      await totpApi.disable(code);
      setCode('');
      setPhase('off');
    } catch (e) {
      fail(e, 'Could not turn off two-factor');
    } finally {
      setBusy(false);
    }
  }

  function downloadCodes() {
    const body =
      `VAULTKEEP BACKUP CODES\n` +
      `======================\n\n` +
      `Account: ${email}\n\n` +
      backupCodes.join('\n') + '\n\n' +
      `Each code works ONCE, in place of a code from your authenticator\n` +
      `app. Keep them somewhere safe and offline — anyone holding one of\n` +
      `these and your master password can open your vault.\n`;

    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vaultkeep-backup-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const codeInput = (label, onSubmit) => (
    <Input
      label={label} mono placeholder="000000"
      inputMode="numeric" autoComplete="one-time-code" maxLength={10}
      value={code}
      onChange={e => setCode(e.target.value.replace(/[\s-]/g, ''))}
      onKeyDown={e => e.key === 'Enter' && onSubmit()}
    />
  );

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0, flex: 1, font: '600 19px Geist, sans-serif', color: 'var(--text)' }}>
          Two-factor authentication
        </h2>
        {phase === 'on' && (
          <span style={{ font: "600 11px 'Geist Mono', monospace", letterSpacing: '.14em', color: 'var(--green)' }}>
            ON
          </span>
        )}
      </div>

      {phase === 'loading' && (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Checking…</div>
      )}

      {/* ---- OFF ---- */}
      {phase === 'off' && (
        <>
          <div style={{ fontSize: 13, color: 'var(--muted)', textWrap: 'pretty' }}>
            Adds a code from your phone to every login. This protects your account,
            not your vault — your entries are already sealed under your master
            password, which never reaches the server. What it stops is someone with
            a stolen password downloading the encrypted vault at all.
          </div>
          {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}
          <div>
            <Button onClick={begin} disabled={busy} style={{ padding: '12px 28px', letterSpacing: '.12em' }}>
              {busy ? 'STARTING…' : 'ENABLE'}
            </Button>
          </div>
        </>
      )}

      {/* ---- SCANNING ---- */}
      {phase === 'scanning' && (
        <>
          <div style={{ fontSize: 13, color: 'var(--muted)', textWrap: 'pretty' }}>
            Scan this with Google Authenticator, Authy, or any TOTP app, then enter
            the code it shows, or scan the qr code. If you lose your phone, you'll need one of the backup codes to log in.
          </div>

          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <img src={qr} alt="Scan this QR code with your authenticator app" width={200} height={200}
              style={{ background: '#fff', padding: 8, border: '1px solid var(--edge)', borderRadius: 'var(--radius)' }} />

            <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ font: '600 12px Geist, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                Or enter this key by hand
              </span>
              <div style={{
                background: 'var(--bg)', border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
                padding: '12px 14px', font: "500 13px 'Geist Mono', monospace",
                letterSpacing: '.08em', color: 'var(--text)', wordBreak: 'break-all'
              }}>
                {secret}
              </div>
            </div>
          </div>

          {codeInput('Code from your app', confirm)}
          {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 12 }}>
            <Button variant="secondary" onClick={() => { setPhase('off'); setCode(''); setError(''); }}
              style={{ font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
              CANCEL
            </Button>
            <Button onClick={confirm} disabled={busy || !code}
              style={{ padding: '12px 28px', letterSpacing: '.12em' }}>
              {busy ? 'VERIFYING…' : 'CONFIRM'}
            </Button>
          </div>
        </>
      )}

      {/* ---- BACKUP CODES — shown once ---- */}
      {phase === 'codes' && (
        <>
          {/* Everything inside vk-print goes on paper together. A sheet
              of ten hex strings with no heading is unidentifiable in a
              drawer a year later. */}
          <div className="vk-print" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="vk-printonly" style={{ display: 'none' }}>
              <h2 style={{ margin: 0, font: '700 18px Geist, sans-serif' }}>VaultKeep backup codes</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13 }}>{email}</p>
            </div>

            <div style={{
              border: '1px solid color-mix(in srgb, var(--amber) 55%, var(--edge))',
              borderRadius: 'var(--radius)', padding: '16px 20px',
              display: 'flex', gap: 14, alignItems: 'flex-start'
            }}>
              <span style={{ color: 'var(--amber)', marginTop: 2 }}><Icon name="shield" size={18} /></span>
              <div style={{ fontSize: 14, lineHeight: 1.55, textWrap: 'pretty' }}>
                <strong>Save these now — they are shown once.</strong>
                <br />
                <span style={{ color: 'var(--muted)' }}>
                  Each works once, in place of a code from your app. Without them, losing
                  your phone means losing access to this account.
                </span>
              </div>
            </div>

            <div className="vk-secret" style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8,
              background: 'var(--bg)', border: '1px solid var(--edge)',
              borderRadius: 'var(--radius)', padding: 16
            }}>
              {backupCodes.map(c => (
                <span key={c} style={{ font: "500 14px 'Geist Mono', monospace", letterSpacing: '.08em', color: 'var(--text)' }}>
                  {c}
                </span>
              ))}
            </div>
          </div>

          <div className="vk-noprint" style={{ display: 'flex', gap: 12 }}>
            <Button variant="secondary" onClick={downloadCodes}
              style={{ font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
              <Icon name="download" /> DOWNLOAD
            </Button>
            <Button variant="secondary" onClick={() => window.print()}
              style={{ font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
              <Icon name="printer" /> PRINT
            </Button>
          </div>

          <label className="vk-noprint" style={{ display: 'flex', gap: 14, alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)}
              style={{ position: 'absolute', opacity: 0, width: 24, height: 24, margin: 0, cursor: 'pointer' }} />
            <span style={{
              width: 24, height: 24, flexShrink: 0,
              border: `1px solid ${saved ? 'var(--green)' : 'var(--edge)'}`, borderRadius: 2,
              background: saved ? 'var(--green)' : 'var(--bg)',
              display: 'grid', placeItems: 'center', color: 'var(--on-green)',
              boxShadow: '0 2px 0 var(--edge)', transition: 'background .15s, border-color .15s'
            }}>
              {saved ? <Icon name="check" size={14} /> : ''}
            </span>
            <span style={{ fontSize: 15 }}>I've saved my backup codes somewhere safe.</span>
          </label>

          <div className="vk-noprint">
            {/* No glow: this is a warning screen, not a celebration —
                the same reason PIX kneels on the recovery kit. */}
            <Button onClick={() => { setBackupCodes([]); setSaved(false); setPhase('on'); }}
              disabled={!saved}
              style={{ padding: '12px 28px', letterSpacing: '.12em', boxShadow: '0 3px 0 var(--green-deep)' }}>
              DONE
            </Button>
          </div>
        </>
      )}

      {/* ---- ON ---- */}
      {phase === 'on' && (
        <>
          <div style={{ fontSize: 13, color: 'var(--muted)', textWrap: 'pretty' }}>
            Every login asks for a code from your authenticator app. If you've just
            enrolled, wait for the next code — the one you set up with has already
            been used and can't be reused.
          </div>
          {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}
          <div>
            <Button variant="secondary" onClick={() => { setPhase('disabling'); setError(''); }}
              style={{ font: '600 12px Geist, sans-serif', padding: '11px 18px', color: 'var(--red)' }}>
              TURN OFF
            </Button>
          </div>
        </>
      )}

      {/* ---- DISABLING ---- */}
      {phase === 'disabling' && (
        <>
          <div style={{ fontSize: 13, color: 'var(--muted)', textWrap: 'pretty' }}>
            Enter a current code to turn two-factor off. Requiring one stops anyone
            who borrowed an unlocked session from quietly removing it.
          </div>
          {codeInput('Code from your app', turnOff)}
          {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 12 }}>
            <Button variant="secondary" onClick={() => { setPhase('on'); setCode(''); setError(''); }}
              style={{ font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
              CANCEL
            </Button>
            <Button onClick={turnOff} disabled={busy || !code}
              style={{
                padding: '12px 28px', letterSpacing: '.12em',
                background: 'var(--red)', borderColor: 'var(--red)', color: '#fff',
                boxShadow: '0 3px 0 rgba(0,0,0,.25)'
              }}>
              {busy ? 'TURNING OFF…' : 'TURN OFF'}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Section-level reveal. Labelled rather than a bare eye, because a
 * lone icon by a heading doesn't say what it applies to.
 */
function RevealToggle({ on, onToggle }) {
  const [down, setDown] = useState(false);

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onMouseLeave={() => setDown(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        font: '600 11px Geist, sans-serif', letterSpacing: '.1em',
        padding: '8px 12px', borderRadius: 'var(--radius)',
        border: '1px solid var(--edge)', background: 'transparent',
        color: on ? 'var(--green)' : 'var(--muted)', cursor: 'pointer',
        boxShadow: down ? '0 0 0 var(--edge)' : '0 2px 0 var(--edge)',
        transform: down ? 'translateY(2px)' : 'none',
        transition: 'transform .05s, box-shadow .05s, color .15s'
      }}
    >
      <Icon name={on ? 'eyeoff' : 'eye'} size={15} />
      {on ? 'HIDE' : 'SHOW'}
    </button>
  );
}