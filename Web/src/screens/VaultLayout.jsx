import { Vault } from './Vault';
import { ItemDetail } from './ItemDetail';
import { Icon } from '../components/Icon';
import { StoredMaterial } from '../components/StoredMaterial';

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
export function VaultLayout({selected, onSelect, forgedPassword, onForgedConsumed }) {

  return (
    <>
    {/* vk-r-stack collapses this to one column on mobile. Without it
        the 1fr track resolves to 0px against the fixed 380px panel and
        the vault list disappears entirely. */}
    <div className="vk-r-stack" style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) 380px',
      gap: 24,
      alignItems: 'start'
    }}>
      <Vault
        onSelectItem={onSelect}
        onAddItem={() => onSelect(null)}
        selectedId={selected}
      />

      {/* Stacked on mobile: drop the sticky pin, and when an entry is
          open show the editor above the list rather than below it. */}
      <div
        className={`vk-r-static${selected !== undefined ? ' vk-r-first' : ''}`}
        style={{ position: 'sticky', top: 88 }}
      >
        {selected === undefined ? (
          <PanelHint />
        ) : (
          <ItemDetail
            // Explicitly null for a new entry. `selected` is undefined
            // when nothing is picked and null when ADD was pressed —
            // passing it through raw let an id survive into what the
            // user sees as a blank form, which then offered DELETE.
            itemId={selected ?? null}
            onDone={() => onSelect(undefined)}
            injectedPassword={forgedPassword}
            // Cleared as soon as the panel has it, so a later close
            // can't leave a live password sitting in App's state.
            onInjected={onForgedConsumed}
            // Keyed on the SELECTION only. Including the forged
            // password here forced a remount to deliver one field,
            // and a remount discards everything the user has typed.
            key={selected === null ? 'new' : selected}
          />
        )}
      </div>
    </div>

    {/* Demo instances only — renders null everywhere else. */}
    <StoredMaterial />
    </>
  );
}

function PanelHint() {
  return (
    <div style={{
      border: '1px dashed var(--edge)', borderRadius: 'var(--radius)',
      padding: '64px 24px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 16, color: 'var(--muted)',
      animation: 'riseIn .4s cubic-bezier(.2,.9,.3,1) both'
    }}>
      <Icon name="key" size={24} />
      <span style={{ font: "500 12px 'Geist Mono', monospace", letterSpacing: '.16em' }}>
        SELECT AN ENTRY
      </span>
    </div>
  );
}