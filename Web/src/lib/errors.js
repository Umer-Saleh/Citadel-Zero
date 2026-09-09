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

  // --- the request itself was refused --------------------------------
  // Raised by express.json before any route runs. All three used to
  // arrive as INTERNAL_ERROR, so the server appeared to break when it
  // had in fact refused something specific.
  //
  // PAYLOAD_TOO_LARGE used to be the one an ordinary person could
  // actually reach. It is now a backstop, and the number in it has
  // moved twice — so the history is worth keeping, because both of the
  // old figures are wrong in a way that looks right.
  //
  // THIS FILE HAS SAID 64, THEN 32, AND NEITHER IS THE ANSWER NOW.
  //
  // An entry is padded into a fixed-size bucket before it is encrypted
  // (crypto/padding.js, BUCKETS) and base64 costs four bytes for every
  // three. The buckets step 16384 -> 32768 -> 65536, so they travel as
  // 21,848, 43,692 and 87,384 characters inside an 81-character
  // envelope.
  //
  //   64 was the ORIGINAL COPY and was the body limit, not the entry
  //   limit. It told someone whose 40 KB note had just been refused a
  //   number they were comfortably under.
  //
  //   32 was CORRECT WHILE THE BODY LIMIT WAS 64 KB: 43,773 bytes fit
  //   in 65,536 and 87,465 did not, with no bucket in between, so the
  //   32768 bucket was the last one that could travel.
  //
  // The body limit is now 96 KB (98,304), which carries 87,465 — so
  // the 65536 bucket travels and the ceiling is that bucket less its
  // 4-byte length prefix: 65,532 bytes of the serialised entry.
  //
  // The copy says CHARACTERS and says "all its fields together",
  // because both are what a person can act on: the whole entry shares
  // one encrypted blob, so the title and the notes spend from the same
  // budget, and it is bytes rather than characters underneath — an
  // emoji costs four. ItemDetail shows the real byte budget live while
  // the entry is being typed, which is the authoritative number; this
  // sentence is the fallback for anything that gets past it.
  //
  // Reaching this now means a client bug: crypto/cipher.js refuses an
  // oversized item with ITEM_TOO_LARGE before the request is built.
  PAYLOAD_TOO_LARGE:
    'That was too large to send — a vault entry has to stay under about 65,000 characters, all its fields together. If this was an entry, shortening the notes should fix it.',

  // Raised by crypto/cipher.js, not by the server: the entry is bigger
  // than the largest padding bucket the transport can carry, so it is
  // refused before a request is built rather than after a 413.
  //
  // Same number as PAYLOAD_TOO_LARGE above, and derived from the same
  // place — cipher.js computes MAX_ITEM_BYTES from BUCKETS and the body
  // limit, so the two sentences quote one boundary, not two.
  ITEM_TOO_LARGE:
    'This entry is too large to store — an entry has to stay under about 65,000 characters, all its fields together. Shortening the notes should fix it.',
  MALFORMED_JSON:
    'The app sent something the server could not read. This is a bug, not something you did.',
  UNSUPPORTED_ENCODING:
    'The server would not accept how that request was encoded. This is a bug, not something you did.',

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

  // --- the vault is full ---------------------------------------------
  // The 1,000 is written out rather than interpolated: this file has no
  // access to the server's constant, so the number is duplicated on
  // purpose and has to be kept in step by hand.
  //
  // KEEP IN STEP with:
  //   Server/src/services/vaultService.js   MAX_ITEMS_PER_USER (the
  //                                         value actually enforced)
  //   Web/src/screens/ItemDetail.jsx        the save handler's own line
  VAULT_FULL:
    'This vault has reached its limit of 1,000 entries. Delete something you no longer need to make room.',

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
