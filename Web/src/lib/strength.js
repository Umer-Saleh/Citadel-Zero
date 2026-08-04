/**
 * Rough password-strength estimate from character-pool entropy.
 * Good enough for live UI feedback. A production app would use
 * zxcvbn, which models real-world guessing rather than raw entropy.
 */
export function calcStrength(pw) {
  if (!pw) {
    return { score: 0, label: '', color: 'var(--muted)', bits: 0,
             tip: 'Use a long passphrase — length beats complexity.' };
  }

  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 24;

  const bits = Math.round(pw.length * Math.log2(pool || 1));
  const score = Math.max(1, Math.min(10, Math.round(bits / 9)));
  const label = score < 4 ? 'WEAK' : score < 7 ? 'FAIR' : 'STRONG';
  const color = score < 4 ? 'var(--red)' : score < 7 ? 'var(--amber)' : 'var(--green)';
  const tip = score < 4 ? 'Too short — add more words or characters.'
            : score < 7 ? 'Getting there. A few more characters locks it in.'
            : 'Strong. This would take centuries to crack.';

  return { score, label, color, bits, tip };
}