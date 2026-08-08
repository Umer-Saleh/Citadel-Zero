import { useEffect } from 'react';
import { Vault } from './Vault';
import { ItemDetail } from './ItemDetail';

/**
 * The two-column vault: list on the left, detail/edit panel on the
 * right (380px), matching the design prototype.
 *
 * Selection is controlled by App rather than held here, because this
 * component unmounts when you switch to the generator or settings.
 *
 *   selected === undefined -> panel shows a hint
 *   selected === null      -> panel is a blank "new entry" form
 *   selected === <id>      -> panel edits that entry
 */
export function VaultLayout({ onOpenGenerator, selected, onSelect, forgedPassword, onForgedConsumed }) {

  // A password came back from the forge with no panel open, so open a
  // blank entry to put it in. If a panel is already open — new or
  // existing — the password goes into that one instead.
  useEffect(() => {
    if (forgedPassword != null && selected === undefined) onSelect(null);
  }, [forgedPassword, selected, onSelect]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) 380px',
      gap: 24,
      alignItems: 'start'
    }}>
      <Vault
        onSelectItem={onSelect}
        onAddItem={() => onSelect(null)}
        onOpenGenerator={onOpenGenerator}
        selectedId={selected}
      />

      <div style={{ position: 'sticky', top: 88 }}>
        {selected === undefined ? (
          <PanelHint />
        ) : (
          <ItemDetail
            itemId={selected}
            onDone={() => onSelect(undefined)}
            injectedPassword={forgedPassword}
            onInjected={onForgedConsumed}
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