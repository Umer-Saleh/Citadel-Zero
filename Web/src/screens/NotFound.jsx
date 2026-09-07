import { Card, Button } from '../components/ui';
import { Paladin } from '../components/Paladin';

/**
 * Nothing is served at this address.
 *
 * Web/nginx.conf answers every unmatched path with index.html — the
 * standard single-page-app fallback — so the browser gets HTTP 200 and
 * the whole application at /anything. With no router, App's final
 * unconditional return then drew the unlock screen, and a mistyped URL
 * or a scanner probing /wp-admin was answered with a password prompt.
 *
 * The status code is still 200. Changing that means carving real 404s
 * out of try_files, which would need nginx to know every legitimate
 * path — a much larger change, and deliberately not this one.
 *
 * Built entirely from the existing primitives, so there is no CSS here
 * to keep in sync with anything: Card, Button, Paladin, and the two
 * responsive classes every other pre-auth screen already uses.
 */
export function NotFound() {
  return (
    <section
      className="vk-r-pad"
      style={{
        minHeight: '100vh', display: 'grid', placeItems: 'center',
        padding: '48px 24px', position: 'relative', zIndex: 1
      }}
    >
      <div
        className="vk-r-fluid"
        style={{ width: 400, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}
      >
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          animation: 'riseIn .5s cubic-bezier(.2,.9,.3,1) both'
        }}>
          {/* Bored, not guarding. There is nothing here to defend — the
              address simply holds nothing, and the guard pose would
              wrongly imply the page exists and is being withheld. */}
          <Paladin pose="bored" size={72} />

          <div style={{
            fontFamily: "'Press Start 2P', monospace", fontSize: 21,
            letterSpacing: 2, color: 'var(--text)'
          }}>
            4<span style={{ color: 'var(--green)' }}>0</span>4
          </div>

          <div style={{
            font: "500 12px 'Geist Mono', monospace", letterSpacing: '.16em',
            color: 'var(--muted)'
          }}>
            NOTHING AT THIS ADDRESS
          </div>
        </div>

        <Card style={{
          display: 'flex', flexDirection: 'column', gap: 20,
          animation: 'riseIn .5s cubic-bezier(.2,.9,.3,1) both',
          animationDelay: '.12s'
        }}>
          {/* The path itself is deliberately NOT echoed here. It is
              attacker-controlled text on a page carrying this project's
              name, and /Your-session-has-expired-call-... would render
              as though the site said it. React escapes it, so this is
              not about injection — it is about not lending the wordmark
              to a stranger's sentence. Nobody needs to be told what
              they typed. */}
          <div style={{ fontSize: 14, color: 'var(--muted)', textWrap: 'pretty' }}>
            Citadel Zero is a single screen. There is no page here — the vault,
            the generator and your settings all live behind the unlock screen.
          </div>

          {/* A real navigation, not a state change: with no router there
              is nothing to route back to, and at this point nothing is
              unlocked anyway — the check that put us here runs before
              anything mounts, on a fresh page load. So no in-memory key
              is lost by leaving. */}
          <Button
            onClick={() => { window.location.assign('/'); }}
            style={{ padding: '14px 24px', letterSpacing: '.12em' }}
          >
            GO TO THE VAULT
          </Button>
        </Card>
      </div>
    </section>
  );
}
