import { calcStrength } from './strength';

/**
 * Vault health: the average per-item password strength, 0-10.
 *
 * Averaged rather than "count of weak entries" so one bad password in
 * a large vault doesn't tank the score, and rounded DOWN so a vault
 * with any weak entries can't read as a perfect 10.
 *
 * An empty vault reports 10. There is nothing weak in it, and showing
 * a new user 0% for having no entries would be alarming and wrong.
 */
export function vaultHealth(items) {
  if (!items.length) return 10;

  const total = items.reduce(
    (sum, it) => sum + calcStrength(it.data.password || '').score,
    0
  );

  return Math.floor(total / items.length);
}