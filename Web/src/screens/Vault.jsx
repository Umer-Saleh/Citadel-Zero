import { useState, useEffect, useRef } from 'react';
import { useVault } from '../context/VaultContext';
import { Paladin } from '../components/Paladin';
import { calcStrength } from '../lib/strength';

/**
 * Vault list. Matches the design prototype: a search field with an
 * inline icon and blinking cursor, item rows that stagger in and carry
 * a per-item strength meter plus quick-copy buttons, and a dashed
 * empty state with a floating mascot.
 */
export function Vault({ onSelectItem, onAddItem, onOpenGenerator, selectedId }) {
  const { items, loadItems } = useVault();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadItems().finally(() => setLoading(false));
  }, [loadItems]);

  const q = search.toLowerCase();
  const filtered = items.filter(it =>
    !q
    || (it.data.site || '').toLowerCase().includes(q)
    || (it.data.username || '').toLowerCase().includes(q)
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'riseIn .4s cubic-bezier(.2,.9,.3,1) both' }}>

      {/* search + actions */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }}>⌕</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search vault…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--surface)', border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
              padding: '12px 14px 12px 40px',
              font: "500 13px 'Geist Mono', monospace", letterSpacing: '.1em',
              color: 'var(--text)', caretColor: 'var(--green)', outline: 'none'
            }}
          />
        </div>

        <button onClick={onOpenGenerator} style={secondaryBtn}>⚒ FORGE</button>
        <button onClick={onAddItem} style={primaryBtn}>+ ADD</button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', padding: 24, font: "500 13px 'Geist Mono', monospace" }}>Decrypting your vault…</div>
      ) : items.length === 0 ? (
        <EmptyState onAdd={onAddItem} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((it, i) => (
            <ItemRow key={it.id} item={it} index={i}
              selected={it.id === selectedId}
              onClick={() => onSelectItem(it.id)} />
          ))}
          {filtered.length === 0 && (
            <div style={{ color: 'var(--muted)', padding: 16, font: "500 13px 'Geist Mono', monospace" }}>
              No entries match “{search}”.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, index, onClick, selected }) {
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(null);
  const timer = useRef(null);

  const site = item.data.site || 'Untitled';
  const letter = site.charAt(0).toUpperCase();
  const strength = calcStrength(item.data.password || '');

  function copy(field, value, e) {
    e.stopPropagation();                 // don't open the item
    navigator.clipboard.writeText(value || '').catch(() => {});
    setCopied(field);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1400);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px',
        background: 'var(--surface)',
        border: `1px solid ${selected ? 'var(--green)' : hover ? 'var(--green)' : 'var(--edge)'}`,
        borderRadius: 'var(--radius)',
        boxShadow: (hover || selected) ? '0 0 0 1px var(--glow), 0 16px 32px -14px var(--shadow)' : '0 8px 20px -12px var(--shadow)',
        cursor: 'pointer',
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'transform .15s, box-shadow .15s, border-color .15s',
        animation: 'riseIn .45s cubic-bezier(.2,.9,.3,1) both',
        animationDelay: `${index * 0.04}s`
      }}
    >
      <div style={{
        width: 40, height: 40, flexShrink: 0, background: 'var(--raised)',
        border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
        display: 'grid', placeItems: 'center',
        fontFamily: "'Press Start 2P', monospace", fontSize: 12, color: 'var(--green)'
      }}>
        {letter}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ font: '600 15px Geist, sans-serif', color: 'var(--text)' }}>{site}</span>
        <span style={{ font: "400 12px 'Geist Mono', monospace", color: 'var(--muted)', letterSpacing: '.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.data.username || '—'}
        </span>
      </div>

      {/* per-item strength meter */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginRight: 6 }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} style={{
              width: 8, height: 6, borderRadius: 1,
              background: i < Math.round(strength.score / 2) ? strength.color : 'var(--edge)'
            }} />
          ))}
        </div>
        <span style={{ font: "400 10px 'Geist Mono', monospace", color: 'var(--muted)', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
          {strength.label || '—'}
        </span>
      </div>

      {/* quick-copy — appear on hover */}
      {hover && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={e => copy('user', item.data.username, e)} style={copyChip}>
            {copied === 'user' ? '✓' : 'USER'}
          </button>
          <button onClick={e => copy('pass', item.data.password, e)} style={copyChip}>
            {copied === 'pass' ? '✓' : 'PASS'}
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div style={{
      border: '1px dashed var(--edge)', borderRadius: 'var(--radius)', background: 'var(--surface)',
      padding: '96px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
      animation: 'riseIn .5s cubic-bezier(.2,.9,.3,1) both'
    }}>
      <div style={{ animation: 'floatY 5s ease-in-out infinite' }}>
        <Paladin pose="atEase" size={96} />
      </div>
      <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 13, color: 'var(--text)' }}>
        YOUR VAULT IS EMPTY
      </div>
      <div style={{ font: "500 12px 'Geist Mono', monospace", letterSpacing: '.18em', color: 'var(--muted)' }}>
        PRESS + ADD TO BEGIN
      </div>
    </div>
  );
}

const primaryBtn = {
  display: 'flex', alignItems: 'center', gap: 8,
  font: '600 13px Geist, sans-serif', letterSpacing: '.1em',
  padding: '0 20px', borderRadius: 'var(--radius)',
  border: '1px solid var(--green-deep)', background: 'var(--green)', color: 'var(--on-green)',
  cursor: 'pointer', boxShadow: '0 3px 0 var(--green-deep), 0 14px 28px -10px var(--glow)'
};

const secondaryBtn = {
  display: 'flex', alignItems: 'center', gap: 8,
  font: '600 13px Geist, sans-serif', letterSpacing: '.1em',
  padding: '0 18px', borderRadius: 'var(--radius)',
  border: '1px solid var(--edge)', background: 'transparent', color: 'var(--text)',
  cursor: 'pointer', boxShadow: '0 2px 0 var(--edge)'
};

const copyChip = {
  background: 'var(--raised)', border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
  padding: '7px 10px', color: 'var(--muted)', cursor: 'pointer',
  font: "600 10px 'Geist Mono', monospace", letterSpacing: '.12em', boxShadow: '0 2px 0 var(--edge)'
};