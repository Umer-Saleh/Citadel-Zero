import { useState } from 'react';
import { Vault } from './Vault';
import { ItemDetail } from './ItemDetail';

/**
 * The two-column vault: list on the left, detail/edit panel on the
 * right (380px), matching the design prototype. Selection state lives
 * here so the list stays mounted while the panel changes.
 *
 *   selected === undefined -> panel shows a hint / nothing
 *   selected === null      -> panel is a blank "new entry" form
 *   selected === <id>      -> panel edits that entry
 */
export function VaultLayout({ onOpenGenerator }) {
  const [selected, setSelected] = useState(undefined);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) 380px',
      gap: 24,
      alignItems: 'start'
    }}>
      <Vault
        onSelectItem={setSelected}
        onAddItem={() => setSelected(null)}
        onOpenGenerator={onOpenGenerator}
        selectedId={selected}
      />

      <div style={{ position: 'sticky', top: 88 }}>
        {selected === undefined ? (
          <PanelHint />
        ) : (
          <ItemDetail
            itemId={selected}
            onDone={() => setSelected(undefined)}
            key={selected ?? 'new'}   // remount when switching entries so form state resets
          />
        )}
      </div>
    </div>
  );
}

function PanelHint() {
  return (
    <div style={{
      border: '1px dashed var(--edge)', borderRadius: 'var(--radius)',
      padding: '48px 24px', textAlign: 'center',
      font: "500 12px 'Geist Mono', monospace", letterSpacing: '.14em', color: 'var(--muted)',
      animation: 'riseIn .4s cubic-bezier(.2,.9,.3,1) both'
    }}>
      SELECT AN ENTRY<br />OR PRESS + ADD
    </div>
  );
}