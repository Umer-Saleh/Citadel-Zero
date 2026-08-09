import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';

/**
 * Password strength via zxcvbn.
 *
 * This replaced a hand-rolled entropy estimate (charset size x length).
 * That formula rated "Password1!" highly and "correct horse battery
 * staple" poorly, which is backwards — it measured the alphabet, not
 * the guessability.
 *
 * zxcvbn matches against a ~30k dictionary, keyboard-adjacency graphs,
 * dates, and repeats, and unmunges l33t-speak first. So "P@ssw0rd"
 * scores as "password" and "qwertyui" as a keyboard walk. That covers
 * the same ground a hardcoded list of common passwords would, without
 * the list — and without missing everything one character off it.
 */

// v4 is a factory: build one instance at module load and reuse it.
// Constructing it per call would re-parse the whole dictionary on
// every keystroke.
const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...common.dictionary, ...en.dictionary },
  graphs: common.adjacencyGraphs,
  translations: en.translations
});

/**
 * @param pw          the password
 * @param userInputs  email, site name etc. zxcvbn penalises passwords
 *                    built from the user's own details — worth passing
 *                    on signup.
 * @returns { score 1-10, label, color, tip, crackTime }
 */
export function calcStrength(pw, userInputs = []) {
  if (!pw) {
    return { score: 0, label: '', color: 'var(--muted)', tip: '', crackTime: '' };
  }

  const r = zxcvbn.check(pw, userInputs);

  // zxcvbn's own score is 0-4, too coarse for a 10-segment meter.
  // guessesLog10 is the continuous underlying value: log10 of the
  // estimated guesses needed. ~12 means a trillion guesses.
  const score = Math.max(1, Math.min(10, Math.round((r.guessesLog10 / 12) * 10)));

  const label =
    r.score <= 1 ? 'WEAK'
    : r.score === 2 ? 'FAIR'
    : r.score === 3 ? 'STRONG'
    : 'FORTRESS';

  const color =
    r.score <= 1 ? 'var(--red)'
    : r.score === 2 ? 'var(--amber)'
    : 'var(--green)';

  // zxcvbn names the actual pattern it found, which beats anything
  // generic I could write.
  const tip =
    r.feedback?.warning
    || r.feedback?.suggestions?.[0]
    || 'Longer is stronger — a passphrase beats a short complex password.';

  return {
    score,
    label,
    color,
    tip,
    // Optional-chained: this key has moved between major versions, and
    // a display string isn't worth crashing the signup screen over.
    crackTime: r.crackTimesDisplay?.offlineSlowHashing1e4PerSecond ?? ''
  };
}