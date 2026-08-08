/**
 * Copying a secret to the clipboard ALWAYS schedules its removal.
 *
 * The pending clear is tracked at MODULE level, not per component.
 * The system clipboard is a single global resource, so only one
 * countdown can be meaningful at a time — a per-component ref cannot
 * coordinate access to something the whole app shares. When two
 * components each held their own timer, an older one would fire and
 * wipe a NEWER secret before its own 30 seconds were up.
 *
 * HONEST LIMITATION: this overwrites the current clipboard slot only.
 * Windows clipboard history (Win+V), macOS Universal Clipboard, and
 * any third-party manager will still hold the value. A web page has
 * no access to those. Documented in the README rather than papered
 * over — the guarantee is "not left sitting in the paste buffer",
 * not "unrecoverable".
 */

export const CLIP_SECONDS = 30;

// The one in-flight clear, if any. { intervalId, onTick }
let active = null;

/**
 * @param value   the secret to copy
 * @param onTick  optional — receives seconds remaining each second,
 *                then null when the clipboard is cleared OR when a
 *                newer copy supersedes this one. Use it to show a
 *                countdown; omit it and the clear still happens.
 * @returns       a detach function. Call it on unmount. It stops UI
 *                callbacks but DELIBERATELY lets the clear proceed —
 *                navigating away must not leave a secret behind.
 */
export function copySecret(value, onTick) {
  // Supersede any pending clear. The previous secret is already gone
  // from the clipboard, so its countdown is meaningless, and letting
  // its timer run would wipe THIS value early.
  if (active) {
    clearInterval(active.intervalId);
    active.onTick?.(null);          // tell the old owner's UI to hide its meter
    active = null;
  }

  navigator.clipboard.writeText(value || '').catch(() => {});

  let left = CLIP_SECONDS;
  const session = { onTick, intervalId: null };
  active = session;
  session.onTick?.(left);

  session.intervalId = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(session.intervalId);
      navigator.clipboard.writeText('').catch(() => {});
      session.onTick?.(null);
      if (active === session) active = null;
      return;
    }
    session.onTick?.(left);           // read off session, so detach() takes effect
  }, 1000);

  return () => { session.onTick = null; };   // detach UI only — clear still runs
}