import { DEMO_MODE } from '../lib/demo';
import { Icon } from './Icon';

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
 *
 * ---------------------------------------------------------------
 * WHY IT DOES NOT LOOK LIKE A VAULT ENTRY
 * ---------------------------------------------------------------
 * It used to, measurably: border, background and radius here were
 * byte-identical to an entry row, so the one block on the page whose
 * job is to be read first rendered as an entry that happened to
 * contain paragraphs — and with LESS presence than a real one, since
 * the row carries a shadow and this did not. The heading was set in
 * the same 12px Geist Mono used for every section label in the app,
 * which made it a label rather than a title.
 *
 * It was also the only prominent block in the app containing nothing
 * from the pixel family: the banner, the wordmark, the health HUD and
 * the recovery warning all carry one, and this did not, which is why
 * it read as foreign to the rest of the design.
 *
 * So: Press Start 2P for the heading, a pixel Icon beside it, the
 * arcade depth shadow the primary buttons use instead of the flat
 * entry-row border, and a segmented rule underneath drawn the way the
 * strength meter is. All of it inline, out of primitives that already
 * exist. No new CSS rule at any breakpoint, no <style> element, and
 * no font that is not already loaded on this screen.
 *
 * The BODY is untouched — same 13px, same --muted. Its contrast was
 * measured and fixed on its own branch, and the weight this panel was
 * missing is a framing problem, not a body-copy one. Darkening the
 * prose to make the panel louder would spend that work on decoration.
 */
export function AboutPanel() {
  if (!DEMO_MODE) return null;

  return (
    <section
      style={{
        marginTop: 32,
        // Tinted like the recovery warning's border rather than the
        // --edge every card uses, so the box is no longer the entry
        // row's box. The depth shadow is the buttons' 0 3px 0, which
        // is the only place in this design language a block is
        // allowed to sit above the page rather than in it.
        border: '1px solid color-mix(in srgb, var(--green) 55%, var(--edge))',
        borderRadius: 'var(--radius)',
        background: 'var(--surface)',
        boxShadow: '0 3px 0 var(--green-deep)',
        padding: '20px 22px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ color: 'var(--green)', display: 'flex' }}>
          <Icon name="lock" size={16} />
        </span>
        {/* Press Start 2P is very wide per character, so this is the
            10px step the banner and the health HUD use, not the 12px
            of the wordmark. Measured at 320: the heading row is 158px
            inside 244px of content, so it does not wrap. Tracking is
            0 — the face is already generously spaced and .14em would
            push it past the measure. */}
        <h2 style={{
          margin: 0,
          fontFamily: "'Press Start 2P', monospace",
          fontSize: 10,
          lineHeight: 1.4,
          color: 'var(--green)'
        }}>
          WHAT THIS IS
        </h2>
      </div>

      {/* Segmented rule, drawn on the Meter's grid — 14x10 blocks at
          gap 3 there, the same width and gap at 3px tall here. Height
          is what keeps it a rule: at 10px it would read as a gauge
          with a value, and this panel has nothing to measure. Every
          segment is lit for the same reason. Eight of them come to
          133px, which is the width of the heading beside it. */}
      <div aria-hidden="true" style={{ display: 'flex', gap: 3, marginBottom: 16 }}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} style={{ width: 14, height: 3, borderRadius: 1, background: 'var(--green)' }} />
        ))}
      </div>

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
