import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

/**
 * PIX's reactions.
 *
 * This is a context rather than props because the moments happen deep
 * in the tree — a copy fires in ItemDetail and in Vault's row chips,
 * a save in ItemDetail — while the only consumer is the header, three
 * levels up and a sibling of all of them. Threading callbacks down
 * four levels for something purely cosmetic would be the wrong shape.
 *
 * THE STILLNESS RULE: the higher the stakes, the stiller he gets.
 * Both registers still react — silence would be indistinguishable
 * from the feature being broken — but they differ in vocabulary.
 * Celebrations get animated poses and exclamation marks; solemn
 * moments get a static pose, a full stop, and a longer beat.
 */

const PixContext = createContext(null);

export function usePix() {
  const ctx = useContext(PixContext);
  // Deliberately tolerant: PIX is decoration, and a screen rendered
  // outside the provider (a test, a future embed) should not crash
  // over a mascot.
  return ctx || { react: () => {}, pose: 'idle', says: null };
}

// pose, message, and how long it lingers.
const MOMENTS = {
  // celebratory — animated, exclamation
  save:      { pose: 'seal',    says: 'SEALED!',       ms: 1500 },
  copy:      { pose: 'snatch',  says: 'GOT IT.',       ms: 1500 },
  levelup:   { pose: 'levelup', says: 'LEVEL UP!',     ms: 2500 },
  unlock:    { pose: 'gate',    says: 'WELCOME BACK.', ms: 2000 },

  // The same moment for an account that did not exist a minute ago.
  //
  // "WELCOME BACK." was shown to everyone, including someone who had
  // just created the vault they were opening for the first time —
  // there is no "back" to welcome them to. That reached production
  // through the demo provision, the ordinary signup path and recovery
  // alike, because all three end at the unlock screen and the reaction
  // was fired from the isUnlocked transition alone.
  //
  // A full stop, not an exclamation mark, and the same 'gate' pose and
  // beat as `unlock`. Per the stillness rule above it belongs with its
  // sibling: crossing a threshold for the first time is the gravest of
  // the entry moments, not a trick pulled off, and giving it an
  // exclamation mark would make the first-time visitor's greeting
  // louder than the returning owner's for no reason.
  firstUnlock: { pose: 'gate',  says: 'THE VAULT IS YOURS.', ms: 2000 },

  // solemn — static pose, full stop, a longer beat. Destructive and
  // irreversible actions get an acknowledgement, not a celebration.
  remove:    { pose: 'guard',   says: 'REMOVED.',      ms: 2000 },
  clipClear: { pose: 'wipe',    says: 'CLIP CLEARED.', ms: 2000 },
  lock:      { pose: 'guard',   says: 'SEALED.',       ms: 2000 },

  // errors
  error:     { pose: 'brace',   says: null,            ms: 1200 }
};

export function PixProvider({ children }) {
  const [moment, setMoment] = useState(null);
  const timer = useRef(null);

  const react = useCallback((name) => {
    const m = MOMENTS[name];
    if (!m) return;

    // A newer moment supersedes an older one rather than queueing —
    // a mascot narrating actions from four seconds ago is noise.
    clearTimeout(timer.current);
    setMoment(m);
    timer.current = setTimeout(() => setMoment(null), m.ms);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const value = {
    react,
    pose: moment?.pose || 'idle',
    says: moment?.says || null
  };

  return <PixContext.Provider value={value}>{children}</PixContext.Provider>;
}