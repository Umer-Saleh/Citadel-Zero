/**
 * Turning a server error code into something a person can read.
 *
 * Every handler in the client used to carry its own ternary chain, and
 * they disagreed. TOO_MANY_ATTEMPTS had copy in two demo handlers and
 * appeared as a raw code in seven others. VALIDATION_FAILED had copy in
 * exactly one. TOO_MANY_REQUESTS, INTERNAL_ERROR, REQUEST_FAILED,
 * NO_TOKEN, INVALID_TOKEN, TOTP_NOT_ENABLED, SESSION_EXPIRED and
 * NO_REFRESH_TOKEN had none anywhere, so a visitor who hit one saw a
 * bare identifier in red.
 *
 * The fix is one map, not ten. A code gets its sentence here, once.
 *
 * WHY OVERRIDES EXIST
 * -------------------
 * Some codes genuinely mean different things on different screens.
 * NOT_FOUND on the unlock screen means "no vault for that email"; on a
 * vault write it means the entry is gone; on the demo panel it means
 * the account was wiped overnight. A single sentence for all three
 * would be worse than what it replaced, so callers pass the ones they
 * can say better and inherit the rest.
 *
 * WHY THE CODE STAYS VISIBLE
 * --------------------------
 * The fallback keeps `(CODE)` in the sentence. It costs a visitor
 * nothing — they can act on the sentence — and it is the first thing
 * anyone debugging this will ask for. The backend returns
 * machine-readable codes precisely so the client does not have to
 * guess; throwing them away wastes that.
 */

/**
 * Codes whose meaning does not change with the screen.
 *
 * Deliberately NOT here: INVALID_CREDENTIALS, NOT_FOUND,
 * INVALID_RECOVERY_KEY and RECOVERY_UNAVAILABLE. Each reads differently
 * depending on what was being attempted, and each already has careful
 * per-screen copy worth keeping. They come through as overrides.
 */
const SHARED = {
  // --- rate limiting -------------------------------------------------
  // Two codes, two buckets, two different things to tell someone.
  TOO_MANY_ATTEMPTS:
    'Too many attempts from this network recently. Wait a few minutes and try again.',
  TOO_MANY_REQUESTS:
    'Too many requests from this network recently. Wait a moment and try again.',

  // --- the session is gone -------------------------------------------
  // All three mean the same thing to a person: unlock again. The
  // distinction between them is for the log, not the screen.
  SESSION_EXPIRED: 'Your session has ended. Unlock again to continue.',
  NO_REFRESH_TOKEN: 'Your session has ended. Unlock again to continue.',
  NO_TOKEN: 'Your session has ended. Unlock again to continue.',
  INVALID_TOKEN: 'Your session is no longer valid. Unlock again to continue.',

  // --- the server, not the visitor -----------------------------------
  INTERNAL_ERROR:
    'Something went wrong on the server. Nothing you typed was at fault — try again in a moment.',
  REQUEST_FAILED:
    'The server gave a response this app could not read. Try again in a moment.',
  NETWORK_ERROR: 'Cannot reach the server.',

  // --- a bug, said plainly -------------------------------------------
  // A visitor cannot act on this one, so the honest thing is to say it
  // is not their fault rather than imply they can fix it.
  VALIDATION_FAILED:
    'The request was malformed. This is a bug in the app, not something you did.',

  // --- two-factor ----------------------------------------------------
  TOTP_NOT_ENABLED: 'Two-factor authentication is not on for this account.',
  TOTP_ALREADY_ENABLED: 'Two-factor authentication is already on for this account.',
  TOTP_NOT_STARTED: 'Start enrolment again — no setup is in progress.',
  INVALID_TOTP_CODE:
    'That code was not accepted. Codes change every 30 seconds — try the current one.',

  // --- account -------------------------------------------------------
  EMAIL_TAKEN: 'An account with this email already exists.',
  WEAK_KDF_PARAMS: 'The server refused those key-derivation parameters as too weak.'
};

/**
 * A readable sentence for a thrown API error.
 *
 * @param err        the caught value. Read defensively: a DOMException
 *                   out of crypto.subtle has no .code at all, and that
 *                   is exactly the case a bare `e.code` handler used to
 *                   render as an empty string.
 * @param fallback   sentence stem for an unmapped code, with NO trailing
 *                   punctuation — 'Could not unlock'. The code and the
 *                   full stop are appended here so every screen
 *                   punctuates the same way.
 * @param overrides  per-screen copy, taking precedence over SHARED.
 */
export function codeToMessage(err, fallback, overrides) {
  const code = err?.code;

  if (code && overrides && Object.prototype.hasOwnProperty.call(overrides, code)) {
    return overrides[code];
  }
  if (code && SHARED[code]) return SHARED[code];

  // Unmapped. Name whatever we have, so an unexpected failure is
  // identifiable from the screen alone rather than only from a console
  // nobody has open.
  if (code) return `${fallback} (${code}).`;
  if (err?.message) return `${fallback}: ${err.message}`;
  return `${fallback}.`;
}

/** Exported for the test, so the map cannot silently lose an entry. */
export const SHARED_CODES = Object.keys(SHARED);
