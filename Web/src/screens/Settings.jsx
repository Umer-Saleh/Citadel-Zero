import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { useVault } from '../context/VaultContext';
import { useTheme } from '../context/ThemeContext';
import { usePix } from '../context/PixContext';
import { Card, Input, Button, Meter, Switch, DeriveBar, ErrorNote, SuccessNote } from '../components/ui';
import { codeToMessage } from '../lib/errors';
import { calcStrength } from '../lib/strength';
import { Icon } from '../components/Icon';
import * as totpApi from '../api/totp';

// The props object is defaulted so the screen can be called with no
// arguments at all — a test, a future embed. Same tolerance usePix
// applies for the same reason: a settings page should not throw over a
// missing optional callback.
export function Settings({ onPasswordChanged } = {}) {
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

      <ChangePassword email={email} changePassword={changePassword}
        onPasswordChanged={onPasswordChanged} />

      <TwoFactor email={email} />

      <RecoveryKitSection email={email} />

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
// RECOVERY KIT — rotate the key without a full recovery.
// ---------------------------------------------------------------
function RecoveryKitSection({ email }) {
  const { regenerateKit } = useVault();
  const [phase, setPhase] = useState('idle');   // 'idle' | 'confirm' | 'working' | 'done'
  const [pw, setPw] = useState('');
  const [newKey, setNewKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // DOWNLOAD used to do its work in complete silence: a Blob, an
  // anchor, a click, and no change on screen at all. On a browser that
  // saves without prompting, nothing whatsoever happened as far as the
  // person could tell — for the one file they are being told to keep.
  const [downloaded, setDownloaded] = useState(false);

  async function run() {
    setError('');
    if (!pw) return setError('Enter your master password.');
    setPhase('working');
    try {
      const { recoveryKey } = await regenerateKit(email, pw);
      setPw('');
      setNewKey(recoveryKey);
      setPhase('done');
    } catch (e) {
      setPhase('confirm');
      setError(codeToMessage(e, 'Could not issue a new kit', {
        INVALID_CREDENTIALS: 'Wrong master password.'
      }));
    }
  }

  function download() {
    const body =
      `CITADEL ZERO RECOVERY KEY\n=========================\n\n` +
      `Account: ${email}\n\nRecovery key:\n${newKey}\n\n` +
      `This replaces any earlier recovery key, which no longer works.\n` +
      `It is the ONLY way back into your vault if you forget your\n` +
      `master password. Store it offline, somewhere safe.\n`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'citadel-zero-recovery-key.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);

    // Names the file rather than claiming the save succeeded. A page
    // cannot observe what the browser did with a download — it may go
    // to a folder, a prompt, or nowhere — so "check for this filename"
    // is the strongest thing that is actually true.
    setDownloaded(true);
  }

  // Transient: a confirmation that never leaves stops being one and
  // becomes furniture. Inline and adjacent, not a floating layer.
  useEffect(() => {
    if (!downloaded) return;
    const t = setTimeout(() => setDownloaded(false), 6000);
    return () => clearTimeout(t);
  }, [downloaded]);

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2 style={{ margin: 0, font: '600 19px Geist, sans-serif', color: 'var(--text)' }}>
        Recovery kit
      </h2>

      {phase !== 'done' && (
        <div className="vk-justify" style={{ fontSize: 13, color: 'var(--muted)', textWrap: 'pretty' }}>
          If you think someone has seen your recovery key, replace it. The old key
          stops working immediately. Your master password and every entry are
          unchanged — only the second door gets a new lock.
        </div>
      )}

      {phase === 'idle' && (
        <div>
          <Button onClick={() => setPhase('confirm')}
            style={{ padding: '12px 28px', letterSpacing: '.12em' }}>
            ISSUE A NEW KEY
          </Button>
        </div>
      )}

      {phase === 'confirm' && (
        <>
          {/* A valid session isn't enough — this mints a permanent
              credential to the vault. */}
          <Input label="Confirm master password" mono revealable
            autoComplete="current-password" name="vk-kit-confirm"
            value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()} />
          <ErrorNote message={error} />
          <div style={{ display: 'flex', gap: 12 }}>
            <Button variant="secondary" onClick={() => { setPhase('idle'); setPw(''); setError(''); }}
              style={{ font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
              CANCEL
            </Button>
            <Button onClick={run} style={{ padding: '12px 24px', letterSpacing: '.12em' }}>
              ISSUE NEW KEY
            </Button>
          </div>
        </>
      )}

      {phase === 'working' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: 'var(--text)' }}>
            RESEALING<span style={{ animation: 'blinkCur 1s steps(1) infinite' }}>_</span>
          </span>
          <DeriveBar />
        </div>
      )}

      {phase === 'done' && (
        <>
          <div className="vk-print" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="vk-printonly" style={{ display: 'none' }}>
              <h2 style={{ margin: 0, font: '700 18px Geist, sans-serif' }}>Citadel Zero recovery key</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13 }}>{email}</p>
            </div>

            <div style={{
              border: '1px solid color-mix(in srgb, var(--amber) 55%, var(--edge))',
              borderRadius: 'var(--radius)', padding: '16px 20px',
              display: 'flex', gap: 14, alignItems: 'flex-start'
            }}>
              <span style={{ color: 'var(--amber)', marginTop: 2 }}><Icon name="shield" size={18} /></span>
              <div style={{ fontSize: 14, lineHeight: 1.55, textWrap: 'pretty' }}>
                <strong>Save this now — it is shown once.</strong>
                <br />
                <span style={{ color: 'var(--muted)' }}>
                  Your previous recovery key no longer works. We hold no copy of this
                  one and cannot show it again.
                </span>
              </div>
            </div>

            <div className="vk-secret" style={{
              background: 'var(--bg)', border: '1px solid var(--edge)',
              borderRadius: 'var(--radius)', padding: '24px 20px', textAlign: 'center',
              font: "600 17px 'Geist Mono', monospace", letterSpacing: '.18em',
              color: 'var(--text)', wordBreak: 'break-word'
            }}>
              {newKey}
            </div>
          </div>

          <div className="vk-noprint" style={{ display: 'flex', gap: 12 }}>
            <Button variant="secondary" onClick={download}
              style={{ font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
              <Icon name="download" /> DOWNLOAD
            </Button>
            <Button variant="secondary" onClick={() => window.print()}
              style={{ font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
              <Icon name="printer" /> PRINT
            </Button>
          </div>

          {downloaded && (
            <SuccessNote label="KEY DOWNLOADED" style={{ marginTop: -8 }}>
              Look for <code style={{ color: 'var(--text)' }}>citadel-zero-recovery-key.txt</code> wherever
              your browser saves downloads.
            </SuccessNote>
          )}

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
            <span style={{ fontSize: 15 }}>I've saved my new recovery key somewhere safe.</span>
          </label>

          <div className="vk-noprint">
            <Button onClick={() => { setNewKey(''); setSaved(false); setPhase('idle'); }}
              disabled={!saved}
              style={{ padding: '12px 28px', letterSpacing: '.12em', boxShadow: '0 3px 0 var(--green-deep)' }}>
              DONE
            </Button>
          </div>
        </>
      )}
    </Card>
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
      // This handler was already the model for the others: four codes,
      // and the only place VALIDATION_FAILED had human copy. Its
      // specific wording is kept as overrides; the rest now comes from
      // the shared map rather than being re-typed.
      setError(codeToMessage(e, 'Upgrade failed', {
        INVALID_CREDENTIALS: 'Wrong master password.',
        WEAK_KDF_PARAMS: 'The server refused these parameters as too weak. Check DEFAULT_KDF_PARAMS in the client.',
        VALIDATION_FAILED: 'The upgrade request was malformed. This is a bug, not something you did.'
      }));
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
            <span className="vk-justify" style={{ fontSize: 14, color: 'var(--muted)', textWrap: 'pretty' }}>
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
                <ErrorNote message={error} />
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
function ChangePassword({ email, changePassword, onPasswordChanged }) {
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

      // changePassword() calls lock() on success, so this component is
      // already being unmounted and CANNOT show its own confirmation —
      // the user is thrown to the unlock screen mid-sentence. That is
      // why success here was indistinguishable from a crash: the app
      // simply logged them out and said nothing.
      //
      // So the message is handed upwards, to be shown on the screen
      // they actually land on. Delaying the lock instead would be
      // worse: the server has already revoked every session, so the
      // vault on screen would be backed by dead tokens.
      onPasswordChanged?.();
    } catch (e) {
      setBusy(false);
      setError(codeToMessage(e, 'Could not change password', {
        INVALID_CREDENTIALS: 'Current password is wrong.',
        WEAK_KDF_PARAMS: 'The server rejected the proposed key-derivation parameters.'
      }));
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

      {/* Enter submits from any of the three, matching every other
          field in this file. run() opens with its own `if (busy)
          return`, so this cannot double-submit past the disabled
          button. */}
      <Input label="Current" mono type={pwType} autoComplete="off"
        name="vk-current-master"
        value={cur} onChange={e => setCur(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && run()} />

      <div className="vk-r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Input label="New" mono type={pwType} autoComplete="new-password"
          value={next} onChange={e => setNext(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()} />
        <Input label="Confirm" mono type={pwType} autoComplete="new-password"
          value={confirm} onChange={e => setConfirm(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()}
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

      <ErrorNote message={error} />

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
  // 'loading' | 'unknown' | 'off' | 'scanning' | 'codes' | 'on' | 'disabling'
  //
  // 'unknown' is not a nicety. The probe below used to fail into 'off',
  // which is a claim — and for the user it most matters to, a false
  // one: someone with 2FA ON, on a flaky connection, was shown a
  // section saying it was off and inviting them to enable it. Enrolment
  // from there returns TOTP_ALREADY_ENABLED and reads as a broken app.
  // "We could not check" and "it is off" are different facts and now
  // render differently.
  const [phase, setPhase] = useState('loading');
  const [secret, setSecret] = useState('');
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Same silence as the recovery kit: the backup codes downloaded with
  // no acknowledgement at all.
  const [codesDownloaded, setCodesDownloaded] = useState(false);

  // Turning two-factor OFF used to re-render the section as "off" and
  // say nothing. Switching a security control off is exactly the
  // operation that deserves to be stated out loud, not inferred from a
  // heading that quietly changed.
  const [justDisabled, setJustDisabled] = useState(false);

  // Why the status check failed. Separate from `error`, which belongs
  // to an action the user took — nobody pressed anything to get this
  // one, and the two are never on screen together.
  const [probeError, setProbeError] = useState('');

  // Both confirmations are transient, for the same reason the recovery
  // kit's is: one that never leaves stops being a confirmation.
  useEffect(() => {
    if (!codesDownloaded) return;
    const t = setTimeout(() => setCodesDownloaded(false), 6000);
    return () => clearTimeout(t);
  }, [codesDownloaded]);

  useEffect(() => {
    if (!justDisabled) return;
    const t = setTimeout(() => setJustDisabled(false), 8000);
    return () => clearTimeout(t);
  }, [justDisabled]);

  // Bumping this re-runs the probe. RECHECK goes through the effect so
  // a second failure takes the same path as the first.
  const [probeNonce, setProbeNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    totpApi.isEnabled(email)
      .then(on => { if (alive) setPhase(on ? 'on' : 'off'); })
      .catch(e => {
        console.error('[totp] status check failed:', e);
        if (!alive) return;
        setProbeError(
          e?.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
          : `The check failed${e?.code ? ` (${e.code})` : ''}.`
        );
        setPhase('unknown');
      });
    // `alive` guards against setting state after the user navigates
    // away mid-request.
    return () => { alive = false; };
  }, [email, probeNonce]);

  function recheck() {
    setProbeError('');
    setPhase('loading');
    setProbeNonce(n => n + 1);
  }

  // TOTP_NOT_ENABLED is reachable from turnOff and had no copy
  // anywhere before; it comes from the shared map now, along with the
  // three that were already handled here.
  function fail(e, fallback) {
    setError(codeToMessage(e, fallback));
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
      setJustDisabled(true);
    } catch (e) {
      fail(e, 'Could not turn off two-factor');
    } finally {
      setBusy(false);
    }
  }

  function downloadCodes() {
    const body =
      `CITADEL ZERO BACKUP CODES\n` +
      `=========================\n\n` +
      `Account: ${email}\n\n` +
      backupCodes.join('\n') + '\n\n' +
      `Each code works ONCE, in place of a code from your authenticator\n` +
      `app. Keep them somewhere safe and offline — anyone holding one of\n` +
      `these and your master password can open your vault.\n`;

    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'citadel-zero-backup-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);

    setCodesDownloaded(true);
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

      {/* ---- UNKNOWN — the status check failed ----
          Amber, not red, and no ENABLE button. Nothing is broken and
          the user did nothing wrong; we simply do not know the answer,
          and a control that acts on an unknown state is how the old
          behaviour turned one failed request into a confusing
          TOTP_ALREADY_ENABLED. RECHECK is the only thing on offer. */}
      {phase === 'unknown' && (
        <>
          <div
            role="alert"
            style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              border: '1px solid color-mix(in srgb, var(--amber) 55%, var(--edge))',
              borderRadius: 'var(--radius)', padding: '14px 16px'
            }}
          >
            <span style={{ color: 'var(--amber)', marginTop: 2, flexShrink: 0 }}>
              <Icon name="shield" size={16} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ font: "600 11px 'Geist Mono', monospace", letterSpacing: '.16em', color: 'var(--amber)' }}>
                STATUS UNKNOWN
              </span>
              {/* Deliberately NOT justified. Two lines at this
                  measure stretch to 1.62x — one visible gap band on
                  an error message, which is the last place to spend
                  a tidy right edge. It also opens with {probeError},
                  so its length is not even fixed. */}
              <span style={{ fontSize: 13, color: 'var(--muted)', textWrap: 'pretty' }}>
                {probeError} We could not check whether two-factor is on for this
                account, so nothing is offered here until we can. This does not
                change your current setting either way.
              </span>
            </div>
          </div>

          <div>
            <Button variant="secondary" onClick={recheck}
              style={{ font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
              RECHECK
            </Button>
          </div>
        </>
      )}

      {/* ---- OFF ---- */}
      {phase === 'off' && (
        <>
          {/* Only after an actual disable — not every time this section
              happens to render in the off state, which is the ordinary
              case for an account that never had two-factor on. */}
          {justDisabled && (
            <SuccessNote label="TWO-FACTOR TURNED OFF">
              Signing in now needs only your master password. Your backup codes
              have been discarded and will not work again.
            </SuccessNote>
          )}

          <div className="vk-justify" style={{ fontSize: 13, color: 'var(--muted)', textWrap: 'pretty' }}>
            Adds a code from your phone to every login. This protects your account,
            not your vault — your entries are already sealed under your master
            password, which never reaches the server. What it stops is someone with
            a stolen password downloading the encrypted vault at all.
          </div>
          <ErrorNote message={error} />
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
          <div className="vk-justify" style={{ fontSize: 13, color: 'var(--muted)', textWrap: 'pretty' }}>
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
          <ErrorNote message={error} />

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
              <h2 style={{ margin: 0, font: '700 18px Geist, sans-serif' }}>Citadel Zero backup codes</h2>
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

          {codesDownloaded && (
            <SuccessNote label="CODES DOWNLOADED" style={{ marginTop: -8 }}>
              Look for <code style={{ color: 'var(--text)' }}>citadel-zero-backup-codes.txt</code> wherever
              your browser saves downloads.
            </SuccessNote>
          )}

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
          <div className="vk-justify" style={{ fontSize: 13, color: 'var(--muted)', textWrap: 'pretty' }}>
            Every login asks for a code from your authenticator app. If you've just
            enrolled, wait for the next code — the one you set up with has already
            been used and can't be reused.
          </div>
          <ErrorNote message={error} />
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
          <ErrorNote message={error} />
          <div style={{ display: 'flex', gap: 12 }}>
            <Button variant="secondary" onClick={() => { setPhase('on'); setCode(''); setError(''); }}
              style={{ font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
              CANCEL
            </Button>
            <Button onClick={turnOff} disabled={busy || !code}
              style={{
                padding: '12px 28px', letterSpacing: '.12em',
                background: 'var(--red-deep)', borderColor: 'var(--red-deep)', color: '#fff',
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