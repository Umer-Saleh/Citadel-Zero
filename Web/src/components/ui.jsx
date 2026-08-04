import { useState } from 'react';

const radius = 'var(--radius)';

// ---------------------------------------------------------------
// BUTTON — primary (filled green), secondary (outlined), danger, text.
// The press-down depth shadow is the arcade signature.
// ---------------------------------------------------------------
export function Button({ variant = 'primary', children, style, ...props }) {
  const [active, setActive] = useState(false);

  const base = {
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
    boxSizing: 'border-box'
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
            title={revealed ? 'Hide' : 'Show'}
            style={{ background: 'none', border: '1px solid var(--edge)', borderRadius: radius, padding: '0 12px', color: 'var(--muted)', cursor: 'pointer' }}
          >
            {revealed ? '🙈' : '👁'}
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
// METER — the reusable segmented pixel bar. Strength, entropy,
// vault health, copy-countdown all use this.
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