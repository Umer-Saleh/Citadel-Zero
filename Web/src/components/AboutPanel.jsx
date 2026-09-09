import { DEMO_MODE } from '../lib/demo';

/**
 * What this is, for someone who has just arrived.
 *
 * A visitor lands in a vault full of invented entries with no idea
 * what the project is or why the panel beneath this one matters. That
 * panel proves the claim; this one states it, so the proof has
 * something to be proof OF.
 *
 * ---------------------------------------------------------------
 * WHO THIS IS WRITTEN FOR
 * ---------------------------------------------------------------
 * Everyone, at full strength. Not a simplified version for one
 * audience and the real explanation elsewhere.
 *
 * So there is no jargon in it — no envelope encryption, no DEK, no
 * KDF, no ciphertext. Those words are correct and they are in the
 * README, and not one of them is what makes the idea land. The idea
 * is that a key never leaves the browser, and that is sayable in
 * plain words without losing anything.
 *
 * ---------------------------------------------------------------
 * WHAT IT MAY NOT CLAIM
 * ---------------------------------------------------------------
 * This introduces a panel whose entire purpose is being believed, so
 * a sentence here that overstates costs more than it would anywhere
 * else in the app. Two deliberate restraints:
 *
 *   "a key your master password produces" — NOT "only your master
 *   password". A recovery key is a second door, so an exclusivity
 *   claim would be false.
 *
 *   "not for anyone holding a copy of the whole database" — NOT the
 *   README's "could not read a single stored credential". A weak
 *   master password is still brute-forceable offline from a stolen
 *   database; Argon2id makes that expensive, not impossible. This
 *   line claims only what is true, that nothing STORED can open the
 *   vault, and does not invite the reader to hear a guarantee against
 *   guessing that nobody can make.
 *
 * ---------------------------------------------------------------
 * EXPANDED, AND DEMO ONLY
 * ---------------------------------------------------------------
 * Not collapsed. The costs are not symmetrical: a reader who does not
 * want this scrolls past it once, below the entries, where it blocks
 * nothing — while a reader who needs it and would never have opened a
 * disclosure gets it for free. A collapsed panel reaches only people
 * already curious enough to tap, which is the audience that least
 * needs telling. StoredMaterial directly below is itself a closed
 * toggle, and two shut drawers in a row read as a debug section.
 *
 * Gated on DEMO_MODE like StoredMaterial, and for the same reason
 * plus one of its own: "wiped nightly" is false on a self-hosted
 * instance, and "the panel below" would point at nothing, since
 * StoredMaterial renders null there. Somebody running their own copy
 * does not need to be told what they installed. VITE_DEMO_MODE is a
 * build-time literal, so this whole component is dropped from an
 * ordinary bundle rather than shipped and skipped.
 */
export function AboutPanel() {
  if (!DEMO_MODE) return null;

  return (
    <section
      style={{
        marginTop: 32,
        border: '1px solid var(--edge)',
        borderRadius: 'var(--radius)',
        background: 'var(--surface)',
        padding: '20px 22px'
      }}
    >
      <h2 style={{
        margin: '0 0 12px',
        font: "600 12px 'Geist Mono', monospace",
        letterSpacing: '.14em',
        color: 'var(--green)'
      }}>
        WHAT THIS IS
      </h2>

      {/* maxWidth in ch, not px: it is the measure that keeps a line
          readable, and it holds at every width without a breakpoint. */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        maxWidth: '72ch',
        font: '400 13px Geist, sans-serif',
        lineHeight: 1.6,
        color: 'var(--muted)',
        textWrap: 'pretty'
      }}>
        <p style={{ margin: 0 }}>
          This is a working password manager, running for real. Every vault here is
          wiped nightly, so treat it as a sandbox.
        </p>

        <p style={{ margin: 0 }}>
          Your vault is locked and unlocked here, in this browser, by a key your
          master password produces. That key never reaches the server. So there is
          nothing stored on the server that can open your vault — not for us, and
          not for anyone holding a copy of the whole database.
        </p>

        <p style={{ margin: 0 }}>
          You do not have to take that on trust. The panel below shows exactly what
          the server holds for this account, beside what this browser just unlocked
          from it.
        </p>
      </div>

      <a
        href="https://github.com/Umer-Saleh/Citadel-Zero"
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'inline-block', marginTop: 14,
          font: "500 11px 'Geist Mono', monospace", letterSpacing: '.12em',
          color: 'var(--green)', textDecoration: 'none'
        }}
      >
        SOURCE: GITHUB.COM/UMER-SALEH/CITADEL-ZERO
      </a>
    </section>
  );
}
