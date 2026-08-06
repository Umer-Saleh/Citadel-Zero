import { useState, useEffect } from 'react';
import { useVault } from '../context/VaultContext';
import { Button, Input } from '../components/ui';
import { Paladin } from '../components/Paladin';

export function Vault({ onSelectItem, onAddItem, onOpenGenerator }) {
  const { items, loadItems } = useVault();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Fetch and decrypt the vault on mount.
  useEffect(() => {
    loadItems().finally(() => setLoading(false));
  }, [loadItems]);

  const filtered = items.filter(it => {
    const q = search.toLowerCase();
    return !q
      || (it.data.site || '').toLowerCase().includes(q)
      || (it.data.username || '').toLowerCase().includes(q);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Input
            placeholder="Search vault…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            mono
          />
        </div>
        {/* Temporary — proper nav comes in the polish pass. Requires a
            new onOpenGenerator prop, wired in step 5 below. */}
        <Button variant="secondary" onClick={onOpenGenerator}>⚒ FORGE</Button>
        <Button onClick={onAddItem}>+ ADD</Button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', padding: 24 }}>Decrypting your vault…</div>
      ) : filtered.length === 0 && items.length === 0 ? (
        // Empty state — PIX at ease, inviting
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 16, padding: '64px 24px', textAlign: 'center'
        }}>
          <Paladin pose="atEase" size={96} />
          <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 12, letterSpacing: 1, color: 'var(--muted)' }}>
            YOUR VAULT IS EMPTY
          </div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>
            Press + ADD to store your first entry.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(it => (
            <ItemRow key={it.id} item={it} onClick={() => onSelectItem(it.id)} />
          ))}
          {filtered.length === 0 && (
            <div style={{ color: 'var(--muted)', padding: 16 }}>No entries match "{search}".</div>
          )}
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, onClick }) {
  const [hover, setHover] = useState(false);
  const site = item.data.site || 'Untitled';
  const letter = site.charAt(0).toUpperCase();

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px',
        background: 'var(--surface)',
        border: `1px solid ${hover ? 'var(--green)' : 'var(--edge)'}`,
        borderRadius: 'var(--radius)',
        boxShadow: hover ? '0 0 0 1px var(--glow), 0 16px 32px -14px var(--shadow)' : '0 8px 20px -12px var(--shadow)',
        cursor: 'pointer',
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'transform .15s, box-shadow .15s, border-color .15s'
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ font: '600 15px Geist, sans-serif', color: 'var(--text)' }}>{site}</span>
        <span style={{ font: "400 12px 'Geist Mono', monospace", color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.data.username || '—'}
        </span>
      </div>
    </div>
  );
}