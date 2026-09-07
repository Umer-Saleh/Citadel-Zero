/**
 * Client-side email checking, and the one normalisation we apply.
 *
 * There was none. All three email inputs pass type="email", which does
 * nothing here: HTML constraint validation only runs on form
 * submission, and there is not a single <form> element in this app —
 * every screen submits through an onClick and an Enter handler. So "x"
 * was accepted by the browser, spent a full Argon2id derivation, and
 * came back as a server VALIDATION_FAILED that named nothing the person
 * could act on.
 *
 * ---------------------------------------------------------------
 * THIS CHECK MUST NEVER BE STRICTER THAN THE SERVER'S
 * ---------------------------------------------------------------
 * The server validates with zod's `z.string().email().max(254)`, whose
 * regex is:
 *
 *   /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/
 *
 * A client rule that rejects an address the server would have accepted
 * is worse than no client rule at all: it makes a legitimate address
 * un-enterable, and the person has no way to appeal it or find out why.
 * A missing check merely wastes a derivation and shows a poor error —
 * annoying, recoverable. A false rejection locks someone out of a
 * product they are entitled to use.
 *
 * So this is deliberately NOT a copy of that regex. Copying it would
 * couple the two, and the day the server's zod is upgraded and its
 * pattern loosens, this file would silently become the stricter of the
 * two. Instead it tests only the structural essentials that the server
 * ALSO requires, and stays permissive everywhere the two could
 * disagree — every rule below is implied by the regex above, so
 * anything the server accepts necessarily passes here.
 *
 * Cases left deliberately to the server, because the regex's exact
 * position on them is not worth mirroring: consecutive dots, a leading
 * dot, hyphen placement in a domain label, quoted local parts, IP
 * literals, and non-ASCII. All of those reach the server and come back
 * as VALIDATION_FAILED, which now has human copy of its own.
 */

/** The server's own bound, matched exactly rather than guessed at. */
export const EMAIL_MAX = 254;

/**
 * What we send, and what we check.
 *
 * TRIM ONLY — no lowercasing.
 *
 * Trimming is a real fix. The server's regex is anchored, so
 * " a@b.com" fails it: today that costs a full Argon2id derivation in
 * this browser and comes back as VALIDATION_FAILED for an address the
 * person can see is fine. A leading space is almost always an artefact
 * of pasting or of a phone keyboard, never an intention, so removing it
 * silently is what they meant.
 *
 * Lowercasing is NOT applied, and that is a decision rather than an
 * omission. The local part of an address is case-sensitive by spec, so
 * folding case changes what the address means. The server stores
 * whatever it is given with no normalisation of its own, so a client
 * that folded case would create accounts the server sees as different
 * from what a differently-cased sign-in would look up. Making that safe
 * means changing the server and migrating the rows already stored,
 * which is a separate piece of work.
 */
export function normaliseEmail(value) {
  return (value ?? '').trim();
}

/**
 * Whether this looks enough like an address to be worth deriving a key
 * for.
 *
 * Every condition here is one the server's regex also imposes:
 *
 *   - at most EMAIL_MAX characters      .max(254)
 *   - no internal whitespace            its charset excludes it
 *   - an "@" with something before it    [A-Za-z0-9_+-] before "@"
 *   - a "." after the last "@"           ([...]\.)+ in the domain
 *   - two or more characters after the
 *     final "."                          [A-Za-z]{2,}
 *
 * Nothing here rejects anything the regex would have allowed. An empty
 * value is NOT a failure — the screens already have their own "enter
 * your email" message for that, and flagging an untouched field the
 * moment it loses focus is nagging, not helping.
 */
export function isEmailish(value) {
  const email = normaliseEmail(value);

  if (!email) return true;                  // nothing typed yet — not this check's business
  if (email.length > EMAIL_MAX) return false;
  if (/\s/.test(email)) return false;

  const at = email.lastIndexOf('@');
  if (at < 1) return false;                 // no "@", or nothing before it

  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  if (dot < 1) return false;                // no "." in the domain, or nothing before it

  return domain.length - dot - 1 >= 2;      // a TLD of at least two characters
}

/**
 * The message for Input's `error` prop, or '' when there is nothing to
 * say.
 *
 * Kept here rather than in each screen so the three inputs cannot drift
 * apart, the same reason the error codes have one map.
 */
export function emailError(value) {
  const email = normaliseEmail(value);

  if (!email) return '';
  if (email.length > EMAIL_MAX) {
    return `That address is ${email.length} characters. The longest an email address can be is ${EMAIL_MAX}.`;
  }
  if (!isEmailish(email)) {
    return 'That does not look like an email address.';
  }
  return '';
}
