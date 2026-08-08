import { useState, useRef, useEffect } from 'react';
import { Card, Button } from '../components/ui';
import { Paladin } from '../components/Paladin';

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  number: '0123456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.<>?'
};

// Defaults live at module scope so the lazy useState initialiser below
// can generate the first password during the very first render.
const DEFAULT_LENGTH = 20;
const DEFAULT_SETS = { lower: true, upper: true, number: true, symbol: true };

/**
 * Cryptographically secure random integer in [0, max), free of modulo
 * bias. We reject values in the final incomplete band of the random
 * range so every output is uniformly likely — Math.random would be
 * both biased and predictable, which is exactly wrong for key material.
 */
function secureIndex(max) {
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

function generate(length, sets) {
  const pool = Object.keys(sets).filter(k => sets[k]).map(k => SETS[k]).join('');
  if (!pool) return '';
  let out = '';
  for (let i = 0; i < length; i++) out += pool[secureIndex(pool.length)];
  return out;
}

function entropyBits(length, sets) {
  const poolSize = Object.keys(sets).filter(k => sets[k]).reduce((n, k) => n + SETS[k].length, 0);
  return poolSize ? Math.round(length * Math.log2(poolSize)) : 0;
}

export function Generator({ onUse, onBack }) {
  const [length, setLength] = useState(DEFAULT_LENGTH);
  const [sets, setSets] = useState(DEFAULT_SETS);

  // Lazy initialiser: runs exactly once, during the first render.
  // This replaces the old `useEffect(() => roll(), [])`, which set
  // state inside an effect and so forced a second render on mount.
  const [pw, setPw] = useState(() => generate(DEFAULT_LENGTH, DEFAULT_SETS));

  const [smithing, setSmithing] = useState(false);
  const anvilTimer = useRef(null);

  /**
   * Generate from EXPLICIT values rather than from the component's
   * current state.
   *
   * This is the whole point. React batches state updates, so after
   * setLength(21) the `length` variable in this render is still 20.
   * A roll() that read state would always be one change behind the
   * slider. Passing the new values in sidesteps that entirely.
   */
  function rollWith(len, s) {
    setPw(generate(len, s));
    setSmithing(true);
    clearTimeout(anvilTimer.current);
    anvilTimer.current = setTimeout(() => setSmithing(false), 400);   // brief anvil animation
  }

  // Convenience wrapper for the REGENERATE button, where current
  // state IS the right input.
  const roll = () => rollWith(length, sets);

  // Cleanup only — no setState in the effect body, so this doesn't
  // trip the cascading-render rule. Without it, the 400ms anvil timer
  // can fire after the user navigates away.
  useEffect(() => () => clearTimeout(anvilTimer.current), []);

  function changeLength(next) {
    setLength(next);
    rollWith(next, sets);          // pass the NEW length, not the stale one
  }

  function toggleSet(k) {
    const next = { ...sets, [k]: !sets[k] };
    setSets(next);
    rollWith(length, next);        // pass the NEW set map
  }

  const bits = entropyBits(length, sets);
  const rating = bits < 60 ? 'WEAK' : bits < 90 ? 'GOOD' : bits < 128 ? 'STRONG' : 'FORTRESS';
  const ratingColor = bits < 60 ? 'var(--red)' : bits < 90 ? 'var(--amber)' : 'var(--green)';
  const noSet = !Object.values(sets).some(Boolean);

  return (
    <div style={{ maxWidth: 560 }}>
      {onBack && (
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', font: '500 14px Geist', marginBottom: 16, padding: 0 }}>
          ← Back to vault
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <Paladin pose={smithing ? 'smith' : 'smithIdle'} size={56} />
        <h1 style={{ margin: 0, font: '700 24px Geist, sans-serif', color: 'var(--text)' }}>Password forge</h1>
      </div>

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* the generated password */}
        <div style={{
          background: 'var(--bg)', border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
          padding: '22px 18px', textAlign: 'center', minHeight: 64,
          display: 'grid', placeItems: 'center',
          font: "600 18px 'Geist Mono', monospace", letterSpacing: '.08em',
          color: noSet ? 'var(--muted)' : 'var(--text)', wordBreak: 'break-all'
        }}>
          {noSet ? 'Select at least one character set' : pw}
        </div>

        {/* entropy readout */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} style={{
                width: 14, height: 10, borderRadius: 1,
                background: i < Math.min(10, Math.round(bits / 16)) ? ratingColor : 'var(--edge)'
              }} />
            ))}
          </div>
          <span style={{ font: "600 12px 'Geist Mono', monospace", letterSpacing: '.12em', color: ratingColor }}>
            {rating} · {bits} BITS
          </span>
        </div>

        {/* length slider */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: "600 12px Geist, sans-serif", letterSpacing: '.08em', color: 'var(--muted)' }}>
            <span>LENGTH</span>
            <span style={{ color: 'var(--green)' }}>{length}</span>
          </div>
          <input
            type="range" min={8} max={64} value={length}
            onChange={e => changeLength(Number(e.target.value))}
            style={{ accentColor: 'var(--green)', width: '100%' }}
          />
        </div>

        {/* character-set toggles */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {Object.keys(SETS).map(k => (
            <button
              key={k}
              onClick={() => toggleSet(k)}
              style={{
                font: "600 12px Geist, sans-serif", letterSpacing: '.06em',
                padding: '10px 16px', borderRadius: 'var(--radius)', cursor: 'pointer',
                border: `1px solid ${sets[k] ? 'var(--green)' : 'var(--edge)'}`,
                background: sets[k] ? 'var(--green)' : 'transparent',
                color: sets[k] ? 'var(--on-green)' : 'var(--muted)',
                boxShadow: sets[k] ? '0 2px 0 var(--green-deep)' : 'none'
              }}
            >
              {k.toUpperCase()}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <Button variant="secondary" onClick={roll} disabled={noSet} style={{ flex: 1 }}>
            ⟳ REGENERATE
          </Button>
          {onUse && (
            <Button onClick={() => onUse(pw)} disabled={noSet} style={{ flex: 1 }}>
              USE THIS
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}