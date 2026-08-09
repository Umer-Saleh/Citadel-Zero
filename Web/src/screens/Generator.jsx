import { useState, useRef, useEffect } from 'react';
import { Card, Button, Meter } from '../components/ui';
import { Paladin } from '../components/Paladin';
import { Icon } from '../components/Icon';

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  number: '0123456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.<>?'
};

// Shown under each toggle so the label isn't the only clue.
const SAMPLES = { lower: 'abc', upper: 'ABC', number: '123', symbol: '!@#' };
const LABELS  = { lower: 'Lowercase', upper: 'Uppercase', number: 'Numbers', symbol: 'Symbols' };

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

export function Generator({ onUse }) {
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
   * React batches state updates, so after setLength(21) the `length`
   * variable in this render is still 20. A roll() that read state
   * would always be one change behind the slider.
   */
  function rollWith(len, s) {
    setPw(generate(len, s));
    setSmithing(true);
    clearTimeout(anvilTimer.current);
    anvilTimer.current = setTimeout(() => setSmithing(false), 400);   // brief anvil animation
  }

  const roll = () => rollWith(length, sets);

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
    <div style={{
      maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24,
      animation: 'riseIn .4s cubic-bezier(.2,.9,.3,1) both'
    }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Paladin pose={smithing ? 'smith' : 'smithIdle'} size={56} />
        <h1 style={{ margin: 0, font: '700 26px Geist, sans-serif', color: 'var(--text)' }}>Password generator</h1>
      </div>

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* the generated password */}
        <div style={{
          background: 'var(--bg)', border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
          padding: '24px 20px', textAlign: 'center', minHeight: 64,
          display: 'grid', placeItems: 'center',
          font: "600 18px 'Geist Mono', monospace", letterSpacing: '.12em',
          color: noSet ? 'var(--muted)' : 'var(--text)', wordBreak: 'break-all'
        }}>
          {noSet ? 'Select at least one character set' : pw}
        </div>

        {/* entropy readout — left-aligned beside the meter, not spread */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Meter score={Math.min(10, Math.round(bits / 16))} color={ratingColor} />
          <span style={{ font: "600 11px 'Geist Mono', monospace", letterSpacing: '.14em', color: ratingColor }}>
            {rating} · {bits} BITS
          </span>
        </div>

        {/* length slider */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ font: '600 12px Geist, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Length
            </span>
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 14, color: 'var(--green)' }}>
              {length}
            </span>
          </div>
          <input
            type="range" min={8} max={64} value={length}
            onChange={e => changeLength(Number(e.target.value))}
            style={{ accentColor: 'var(--green)', width: '100%', cursor: 'pointer' }}
          />
        </div>

        {/* character sets — labelled rows with mini switches */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {Object.keys(SETS).map(k => (
            <CharsetRow key={k} label={LABELS[k]} sample={SAMPLES[k]} on={sets[k]} onToggle={() => toggleSet(k)} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <Button variant="secondary" onClick={roll} disabled={noSet} style={{ flex: 1, justifyContent: 'center', font: '600 12px Geist, sans-serif', padding: '13px 16px' }}>
            <Icon name="dice" /> REGENERATE
          </Button>
          {onUse && (
            <Button onClick={() => onUse(pw)} disabled={noSet} style={{ flex: 1, justifyContent: 'center', padding: '13px 16px', letterSpacing: '.12em' }}>
              USE THIS
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

/**
 * One character-set toggle. The whole row is the button and the switch
 * is purely decorative — nesting a real button inside a clickable row
 * would give two overlapping hit targets and confuse screen readers.
 */
function CharsetRow({ label, sample, on, onToggle }) {
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '12px 16px', textAlign: 'left',
        border: `1px solid ${hover || on ? 'var(--green)' : 'var(--edge)'}`,
        borderRadius: 'var(--radius)', background: 'transparent',
        cursor: 'pointer', userSelect: 'none',
        transition: 'border-color .15s'
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: '600 13px Geist, sans-serif', color: 'var(--text)' }}>{label}</span>
        <span style={{ font: "400 11px 'Geist Mono', monospace", color: 'var(--muted)', letterSpacing: '.06em' }}>{sample}</span>
      </span>

      <span style={{
        width: 40, height: 22, flexShrink: 0, position: 'relative',
        border: '1px solid var(--edge)', borderRadius: 2,
        background: 'var(--bg)', boxShadow: '0 2px 0 var(--edge)'
      }}>
        <span style={{
          position: 'absolute', top: 3, left: 3, width: 14, height: 14, borderRadius: 1,
          background: on ? 'var(--green)' : 'var(--muted)',
          transform: on ? 'translateX(18px)' : 'translateX(0)',
          transition: 'transform .15s, background .15s'
        }} />
      </span>
    </button>
  );
}