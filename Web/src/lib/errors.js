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
  // actually reach. It is now a backstop, and it has quoted three
  // different figures — so the history is worth keeping, because each
  // of the dead ones was wrong in a way that looked right.
  //
  // THIS FILE HAS SAID 64 KB, THEN 32 KB, THEN 65,000 CHARACTERS.
  // IT NOW NAMES NO NUMBER AT ALL, AND THAT IS THE FIX, NOT AN
  // OMISSION. DO NOT PUT A FIGURE BACK.
  //
  // An entry is padded into a fixed-size bucket before it is encrypted
  // (crypto/padding.js, BUCKETS) and base64 costs four bytes for every
  // three. The buckets step 16384 -> 32768 -> 65536, so they travel as
  // 21,848, 43,692 and 87,384 characters inside an 81-character
  // envelope.
  //
  //   64 KB was the ORIGINAL COPY and was the body limit, not the
  //   entry limit. It told someone whose 40 KB note had just been
  //   refused a number they were comfortably under.
  //
  //   32 KB was CORRECT WHILE THE BODY LIMIT WAS 64 KB: 43,773 bytes
  //   fit in 65,536 and 87,465 did not, with no bucket in between, so
  //   the 32768 bucket was the last one that could travel.
  //
  //   65,000 CHARACTERS was correct only in ASCII. The limit is
  //   65,532 BYTES of the serialised entry, measured through
  //   TextEncoder, and JSON.stringify escapes before that. Measured:
  //   a newline or a double quote costs two bytes, so does an Arabic
  //   letter; a CJK character costs three; an emoji costs four. The
  //   sentence promised an Arabic speaker twice the room they have,
  //   an emoji user four times — and overstated even an English note
  //   with paragraph breaks in it.
  //
  // There is no honest single figure, because the unit the limit is
  // in is not the unit a person is typing in. 65,000 cheats every
  // non-Latin script; 32,000 would cheat English. So the copy names
  // none and the SIZE METER under the notes field carries the number
  // instead — it counts the real bytes, live, and is the only place
  // that can be right for everyone.
  //
  // This particular sentence does NOT point at that meter, and that is
  // deliberate: see below.
  //
  // WHEN THIS CAN FIRE. Not through the app. crypto/cipher.js refuses
  // an oversized entry with ITEM_TOO_LARGE before a request is built,
  // so a 413 means the client's idea of the limit and the server's
  // have come apart. Padding is bucketed, so in that state ANY entry
  // over 32,764 bytes pads to 65536 and produces the same 87,465-byte
  // body — including a 33,000-byte entry, which is half the cap and
  // leaves the meter silent, since it renders nothing below three
  // quarters. Pointing at a meter that is not on screen for most of
  // the range where this message can appear would be worse than
  // saying nothing, so it says what a person can do and then says
  // plainly that the fault is the app's.
  PAYLOAD_TOO_LARGE:
    'That was too large to send. If it was a vault entry, shortening the notes should fix it — every field shares one budget. The app normally stops an oversized entry before it is sent, so seeing this message means something is wrong with the app rather than with what you typed.',

  // Raised by crypto/cipher.js, not by the server: the entry is bigger
  // than the largest padding bucket the transport can carry, so it is
  // refused before a request is built rather than after a 413.
  //
  // Same boundary as PAYLOAD_TOO_LARGE above and neither states it,
  // for the reason written out there. This one CAN point at the size
  // meter: it is raised only from the entry form, where the meter is
  // on screen by definition — an entry cannot be over the cap without
  // being over the three-quarter mark that makes the meter render.
  ITEM_TOO_LARGE:
    'This entry is too large to store — all its fields together, not the notes alone. The size meter under the notes field shows how much room is left; shortening the notes is usually the quickest fix.',
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
