import { useState } from 'react';
import { Icon } from './Icon';

const radius = 'var(--radius)';

// ---------------------------------------------------------------
// BUTTON — primary (filled green), secondary (outlined), danger, text.
// The press-down depth shadow is the arcade signature.
// ---------------------------------------------------------------
export function Button({ variant = 'primary', children, style, ...props }) {
  const [active, setActive] = useState(false);

  const base = {
    // Flex so an icon and its label centre against each other rather
    // than sitting on the text baseline. Every button in the app is
    // either icon+label or label-only, so this is safe globally.
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    font: "600 13px Geist, sans-serif",
    letterSpacing: '.1em',
    padding: '13px 22px',
    borderRadius: radius,
    cursor: props.disabled ? 'not-allowed' : 'pointer',
    opacity: props.disabled ? 0.5 : 1,
    transition: 'transform .05s, box-shadow .05s, filter .15s',
    border: '1px solid',
    ...style
  };

  const variants = {
    primary: {
      background: 'var(--green)', color: 'var(--on-green)', borderColor: 'var(--green-deep)',
      boxShadow: active ? '0 0 0 var(--green-deep)' : '0 3px 0 var(--green-deep), 0 12px 24px -10px var(--glow)',
      transform: active ? 'translateY(3px)' : 'none'
    },
    secondary: {
      background: 'transparent', color: 'var(--text)', borderColor: 'var(--edge)',
      boxShadow: active ? '0 0 0 var(--edge)' : '0 2px 0 var(--edge)',
      transform: active ? 'translateY(2px)' : 'none'
    },
    danger: {
      background: 'var(--red)', color: '#fff', borderColor: 'var(--red)',
      boxShadow: active ? '0 0 0 var(--red)' : '0 3px 0 rgba(0,0,0,.25)',
      transform: active ? 'translateY(3px)' : 'none'
    },
    text: {
      background: 'transparent', color: 'var(--green)', border: '1px solid transparent',
      padding: '8px 12px'
    }
  };

  return (
    <button
      // Before the spread, so a caller can still pass type="submit".
      // Without it, <button> defaults to submit — harmless while there
      // are no forms in the app, but it would turn every button into a
      // submit button the day one appears.
      type="button"
      {...props}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      onMouseLeave={() => setActive(false)}
      style={{ ...base, ...variants[variant] }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------
// INPUT — labelled, pixel-bordered, green focus glow. Optional
// secret type with a reveal toggle.
// ---------------------------------------------------------------
export function Input({ label, error, revealable, value, onChange, mono, ...props }) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [eyeDown, setEyeDown] = useState(false);

  const inputStyle = {
    flex: 1, minWidth: 0, width: '100%',
    background: 'var(--bg)',
    border: `1px solid ${error ? 'var(--red)' : focused ? 'var(--green)' : 'var(--edge)'}`,
    borderRadius: radius,
    padding: '12px 14px',
    font: mono ? "500 16px 'Geist Mono', monospace" : "500 15px Geist, sans-serif",
    letterSpacing: mono ? '.06em' : 'normal',
    color: 'var(--text)',
    caretColor: 'var(--green)',
    boxShadow: focused ? '0 0 0 3px var(--glow)' : 'none',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color .15s, box-shadow .15s'
  };

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {label && (
        <span style={{ font: "600 12px Geist, sans-serif", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          {label}
        </span>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          {...props}
          type={revealable ? (revealed ? 'text' : 'password') : props.type}
          value={value}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={inputStyle}
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setRevealed(r => !r)}
            onMouseDown={() => setEyeDown(true)}
            onMouseUp={() => setEyeDown(false)}
            onMouseLeave={() => setEyeDown(false)}
            title={revealed ? 'Hide' : 'Show'}
            // Matches ItemDetail's IconButton: centred, with the same
            // depth shadow and press-down. Without them it read as a
            // flat, dead control beside its siblings.
            style={{
              display: 'grid', placeItems: 'center',
              background: 'none', border: '1px solid var(--edge)', borderRadius: radius,
              padding: '0 12px', color: 'var(--muted)', cursor: 'pointer',
              boxShadow: eyeDown ? '0 0 0 var(--edge)' : '0 2px 0 var(--edge)',
              transform: eyeDown ? 'translateY(2px)' : 'none',
              transition: 'transform .05s, box-shadow .05s'
            }}
          >
            <Icon name={revealed ? 'eyeoff' : 'eye'} size={15} />
          </button>
        )}
      </div>
      {error && <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>}
    </label>
  );
}

// ---------------------------------------------------------------
// CARD — soft shadow + crisp pixel border, the signature hybrid.
// ---------------------------------------------------------------
export function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--edge)',
      borderRadius: radius,
      boxShadow: '0 14px 32px -16px var(--shadow)',
      padding: 32,
      ...style
    }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------
// METER — segmented pixel bar at 14x10. Used for password strength
// and generator entropy. The clipboard countdown (11x8) and the
// header health HUD (7x8) draw their own at different sizes, so this
// is not the one place segments live.
// ---------------------------------------------------------------
export function Meter({ score, max = 10, color }) {
  const fill = color || (score < 4 ? 'var(--red)' : score < 7 ? 'var(--amber)' : 'var(--green)');

  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {Array.from({ length: max }, (_, i) => (
        <div key={i} style={{
          width: 14, height: 10, borderRadius: 1,
          background: i < score ? fill : 'var(--edge)',
          transition: 'background .25s'
        }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------
// DERIVE BAR — indeterminate activity for Argon2id waits.
//
// DELIBERATELY NOT PROGRESS. A lit band sweeps and repeats; it does
// not track how far the derivation has got, because the derivation
// doesn't report that. A bar that fills on a timer would finish
// early on a slow machine and sit full while the user waits.
//
// If hash-wasm turns out to expose a progress callback, replace this
// with real segments driven off it.
// ---------------------------------------------------------------
export function DeriveBar({ done }) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} style={{
          width: 16, height: 12, borderRadius: 1,
          background: done ? 'var(--green)' : 'var(--edge)',
          transition: 'background .15s',
          ...(done ? {} : {
            animation: 'deriveSweep 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.1}s`
          })
        }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------
// SWITCH — 52x28 pixel toggle with a sliding knob. Replaces stock
// checkboxes and emoji-labelled buttons for on/off preferences.
// ---------------------------------------------------------------
export function Switch({ on, onToggle, label }) {
  const [down, setDown] = useState(false);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onMouseLeave={() => setDown(false)}
      style={{
        width: 52, height: 28, padding: 0, position: 'relative', flexShrink: 0,
        border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
        background: 'var(--bg)', cursor: 'pointer',
        boxShadow: down ? '0 0 0 var(--edge)' : '0 2px 0 var(--edge)',
        transform: down ? 'translateY(2px)' : 'none',
        transition: 'transform .05s, box-shadow .05s'
      }}
    >
      <span style={{
        position: 'absolute', top: 4, left: 4, width: 18, height: 18,
        borderRadius: 2,
        background: on ? 'var(--green)' : 'var(--muted)',
        transform: on ? 'translateX(24px)' : 'translateX(0)',
        transition: 'transform .2s, background .2s'
      }} />
    </button>
  );
}