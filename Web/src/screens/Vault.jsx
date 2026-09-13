import { useState, useEffect, useRef } from 'react';
import { useVault } from '../context/VaultContext';
import { Paladin } from '../components/Paladin';
import { calcStrength } from '../lib/strength';
import { copySecret } from '../lib/clipboard';
import { Icon } from '../components/Icon';

/**
 * Vault list. Matches the design prototype: a search field with an
 * inline icon and blinking cursor, item rows that stagger in and carry
 * a per-item strength meter plus quick-copy buttons, and a dashed
 * empty state with a floating mascot.
 */
export function Vault({ onSelectItem, onAddItem, selectedId }) {
  const { items, loadItems } = useVault();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchFocus, setSearchFocus] = useState(false);

  // The load FAILED, as opposed to succeeding with nothing in it.
  //
  // This used to be `.finally(() => setLoading(false))` — no catch at
  // all. A rejected load left `items` at its initial [], cleared the
  // loading flag, and rendered the dashed empty state: a vault that
  // could not be reached was reported to its owner as a vault with
  // nothing in it. In a password manager that is the worst thing this
  // screen can say, and it said it for every cause — a dead network,
  // a 500, an expired session, a failed decrypt.
  //
  // Kept as its own state rather than folded into `loading` so the
  // three outcomes stay three: still working, failed, empty.
  const [loadError, setLoadError] = useState('');

  // Bumping this re-runs the effect below. RETRY goes through the
  // effect rather than calling loadItems() directly, so a second
  // failure takes exactly the same path as the first.
  const [reloadNonce, setReloadNonce] = useState(0);

  // The retry's own reset lives here rather than at the top of the
  // effect. Same result, and it keeps the effect free of a synchronous
  // setState — `loading` and `loadError` already hold these values on
  // first mount, so only a retry has anything to reset.
  function retry() {
    setLoading(true);
    setLoadError('');
    setReloadNonce(n => n + 1);
  }

  useEffect(() => {
    let alive = true;

    loadItems()
      .catch(e => {
        // Always logged. The message below is deliberately vague about
        // the cause — a visitor cannot act on VALIDATION_FAILED — but
        // whoever is debugging this needs the real exception, and a
        // DOMException out of the decrypt path carries no .code at all.
        console.error('[vault] load failed:', e);
        if (!alive) return;
        setLoadError(
          e?.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
          : `Could not load your vault${e?.code ? ` (${e.code})` : ''}.`
        );
      })
      .finally(() => { if (alive) setLoading(false); });

    // The vault re-locks on unmount often enough — idle timeout, LOCK,
    // a dead refresh token — that a late rejection landing on a
    // component that is gone is routine, not exceptional.
    return () => { alive = false; };
  }, [loadItems, reloadNonce]);

  const q = search.toLowerCase();
  const filtered = items
    .filter(it =>
      !q
      || (it.data.site || '').toLowerCase().includes(q)
      || (it.data.username || '').toLowerCase().includes(q)
    )
    // localeCompare, not <, so accented names sort where a reader
    // expects rather than by code point. `numeric` keeps "Server 2"
    // before "Server 10".
    .sort((a, b) => (a.data.site || '').localeCompare(
      b.data.site || '', undefined, { sensitivity: 'base', numeric: true }
    ));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'riseIn .4s cubic-bezier(.2,.9,.3,1) both' }}>

      {/* search + actions */}
      <div className="vk-r-wrap" style={{ display: 'flex', gap: 12 }}>
        <div className="vk-r-minw0" style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none', display: 'flex' }}>
            <Icon name="search" />
          </span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setSearchFocus(false)}
            placeholder="Search vault…"
            type="search"
            name="vk-search"
            autoComplete="off"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--surface)',
              // Focus ring, matching every other input in the app.
              border: `1px solid ${searchFocus ? 'var(--green)' : 'var(--edge)'}`,
              boxShadow: searchFocus ? '0 0 0 3px var(--glow)' : 'none',
              borderRadius: 'var(--radius)',
              padding: '12px 14px 12px 40px',
              font: "500 13px 'Geist Mono', monospace", letterSpacing: '.1em',
              color: 'var(--text)', caretColor: 'var(--green)', outline: 'none',
              transition: 'border-color .15s, box-shadow .15s'
            }}
          />
        </div>

        <button onClick={onAddItem} className="vk-r-touch-y" style={primaryBtn}>
          <Icon name="plus" size={12} /> ADD
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', padding: 24, font: "500 13px 'Geist Mono', monospace" }}>Decrypting your vault…</div>
      ) : loadError ? (
        /* Checked BEFORE items.length. A failed load leaves `items`
           empty, so the empty state would otherwise win and tell the
           user their vault has nothing in it. */
        <LoadFailed message={loadError} onRetry={retry} />
      ) : items.length === 0 ? (
        <EmptyState />
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

  // Keyboard focus anywhere inside the row — the row itself or either
  // copy chip. The chips render on `hover || focusWithin`, so without
  // this they would not exist in the DOM for a keyboard user even once
  // the row is focusable, and Tab would step straight past them.
  const [focusWithin, setFocusWithin] = useState(false);
  const [copied, setCopied] = useState(null);
  const labelTimer = useRef(null);
  const detachClip = useRef(null);

  const site = item.data.site || 'Untitled';
  const letter = site.charAt(0).toUpperCase();
  const strength = calcStrength(item.data.password || '');

  function copy(field, value, e) {
    e.stopPropagation();                 // don't open the item

    // No cancellation here: copySecret supersedes any pending clear
    // itself, app-wide. Doing it locally could only ever cover rows
    // that share this component instance — i.e. one row.
    detachClip.current?.();
    detachClip.current = copySecret(value);

    setCopied(field);
    clearTimeout(labelTimer.current);
    labelTimer.current = setTimeout(() => setCopied(null), 1400);   // checkmark only
  }

  useEffect(() => () => {
    clearTimeout(labelTimer.current);
    detachClip.current?.();            // stop UI updates; the clear still fires
  }, []);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      // Focus, not hover, is what makes this reachable without a mouse.
      // onFocusCapture and onBlurCapture: React's capture-phase focus
      // and blur, which fire for focus landing anywhere inside the row,
      // copy chips included. The blur side clears only when focus leaves
      // the row entirely — relatedTarget outside currentTarget — so
      // moving from the row into a chip does not take the chips away.
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocusWithin(false);
      }}
      // A control, and named as one.
      //
      // This was a bare div with an onClick: no role, no tabIndex, no
      // name. Querying the whole list region for anything focusable
      // returned nothing, so no entry could be opened without a mouse
      // and none was announced as a control at all.
      //
      // KNOWN COMPROMISE, recorded rather than hidden: role="button"
      // on an element containing two <button> chips is technically
      // non-conforming — a button may not contain interactive
      // descendants. The conforming alternative is to move the role
      // onto the name/username block, which shrinks the click target
      // for mouse users to a fraction of the row. Whole-row clicking
      // is the existing behaviour and worth keeping, so the compromise
      // is here and deliberate. Revisit if a screen reader is observed
      // mis-announcing the chips.
      role="button"
      tabIndex={0}
      aria-label={`${site}, ${item.data.username || 'no username'}`}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // Only the row's own keystrokes. Without this, Enter or Space
        // on a copy chip would open the entry as well as copying.
        if (e.target !== e.currentTarget) return;
        // Space scrolls the page by default, which is exactly what a
        // list of rows must not do while one is focused.
        e.preventDefault();
        onClick();
      }}
      // vk-r-row-wrap: below 640px the quick-copy chips take a line of
      // their own rather than being crushed into this one. See the
      // rule in theme.css for why hiding them was the wrong answer.
      className="vk-r-row-wrap"
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
        <span style={{
          font: '600 15px Geist, sans-serif', color: 'var(--text)',
          // The flexible column is the one that should absorb a narrow
          // viewport, which means it has to be able to give way
          // gracefully. The username below already ellipsised; this
          // did not, so it pushed instead of shrinking.
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>{site}</span>
        <span style={{ font: "400 12px 'Geist Mono', monospace", color: 'var(--muted)', letterSpacing: '.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.data.username || '—'}
        </span>
      </div>

      {/* per-item strength meter — calcStrength returns score 1..10,
          halved here to fill 5 segments */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginRight: 6, flexShrink: 0 }}>
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

      {/* quick-copy — appear on hover, or on keyboard focus.

          `hover` alone meant these were not in the DOM at all unless a
          mouse was over the row, so no amount of making the row
          focusable would have let a keyboard reach them.

          aria-label on both: the visible word is replaced by a check
          Icon for 1.4s after a copy, and Icon is aria-hidden, so in
          that window the button would otherwise have no accessible
          name whatsoever. The label also says WHICH entry, because
          "USER" alone is meaningless read out of a list of five. */}
      {(hover || focusWithin) && (
        <div className="vk-r-row-actions" style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={e => copy('user', item.data.username, e)}
            aria-label={`Copy username for ${site}`}
            className="vk-r-touch" style={copyChip}
          >
            {copied === 'user' ? <Icon name="check" size={12} /> : 'USER'}
          </button>
          <button
            onClick={e => copy('pass', item.data.password, e)}
            aria-label={`Copy password for ${site}`}
            className="vk-r-touch" style={copyChip}
          >
            {copied === 'pass' ? <Icon name="check" size={12} /> : 'PASS'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The vault could not be loaded.
 *
 * Deliberately NOT a variant of EmptyState. It reads as a different
 * kind of thing at a glance — red edge instead of a dashed one, the
 * guarding pose instead of the floating at-ease one, no "PRESS + ADD"
 * invitation — because the two states were previously indistinguishable
 * and that is the whole point of this screen.
 *
 * The retry is what makes it actionable. Every cause here is transient
 * or fixable (a dropped connection, a 500, a session that just died and
 * will bounce the user to unlock on the next request), so offering the
 * request again is nearly always the right next move.
 */
function LoadFailed({ message, onRetry }) {
  return (
    <div
      role="alert"
      style={{
        border: '1px solid var(--red)', borderRadius: 'var(--radius)', background: 'var(--surface)',
        padding: '64px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
        textAlign: 'center',
        animation: 'riseIn .5s cubic-bezier(.2,.9,.3,1) both'
      }}
    >
      <Paladin pose="guard" size={96} />

      <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 13, color: 'var(--red)', lineHeight: 1.6 }}>
        VAULT UNREACHABLE
      </div>

      {/* The distinction that matters, said in words as well as in
          colour: this is not an empty vault. */}
      <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 340, textWrap: 'pretty' }}>
        {message} Your entries are safe — this is the request failing, not your
        vault being empty.
      </div>

      {/* No icon: the pixel family has no reload glyph, and Icon
          renders nothing for a name it doesn't know rather than
          failing loudly. A word is the safer control. */}
      <button onClick={onRetry} className="vk-r-touch-y" style={retryBtn}>
        RETRY
      </button>
    </div>
  );
}

function EmptyState() {
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


// Outlined rather than filled: retrying a load is a recovery action,
// not the screen's primary call to action, and a second green button
// competing with ADD would misrepresent that. Same depth shadow and
// 3px radius as everything else.
const retryBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  font: "600 12px 'Geist Mono', monospace", letterSpacing: '.12em',
  padding: '12px 28px', borderRadius: 'var(--radius)',
  border: '1px solid var(--edge)', background: 'transparent', color: 'var(--text)',
  cursor: 'pointer', boxShadow: '0 2px 0 var(--edge)'
};


const copyChip = {
  background: 'var(--raised)', border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
  padding: '7px 10px', color: 'var(--muted)', cursor: 'pointer',
  font: "600 10px 'Geist Mono', monospace", letterSpacing: '.12em', boxShadow: '0 2px 0 var(--edge)'
};