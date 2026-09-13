import { useTheme } from '../context/ThemeContext';
import { Switch } from './ui';

/**
 * The theme switch. One of them, everywhere it appears.
 *
 * It lived inline in AppShell, which meant it existed only after
 * unlocking — so the unlock, signup, recovery-kit, recover and 404
 * screens could not be switched at all. Those are the screens a first
 * visitor sees, and on a public demo most people never get past the
 * first one, so the setting was missing from exactly the place it was
 * most likely to be wanted.
 *
 * The preference itself already worked before login. ThemeProvider sits
 * above App in main.jsx and reads localStorage on mount, so a light
 * theme chosen in a previous session was already being applied to the
 * unlock screen — verified in the browser. What was missing was the
 * control, not the persistence.
 *
 * ONE COMPONENT, TWO PLACEMENTS. AppShell puts it in the header row
 * alongside LOCK; a pre-auth screen has no header to put it in, so it
 * gets `floating`. That is a wrapper around the same Switch and the
 * same useTheme, not a second implementation — a second toggle could
 * drift from this one in behaviour, styling or label, and there would
 * be nothing to stop it.
 */
export function ThemeToggle({ floating = false }) {
  const { theme, toggle } = useTheme();

  const control = (
    <Switch on={theme === 'dark'} onToggle={toggle} label="Dark theme" />
  );

  if (!floating) return control;

  return (
    <div
      // Fixed, so it does not depend on each screen's own positioning
      // context — the five pre-auth screens are five independent
      // sections with no shared shell between them.
      //
      // Anchored to --demo-banner-h rather than a constant. DemoBanner
      // measures itself and publishes its real height there — 0 on any
      // build without the banner — so this clears it at every width
      // without knowing anything about it. Its height at 320px is
      // UNMEASURED: this comment said 179px, theme.css says the column
      // layout cut 231px to about a third of that, and the two cannot
      // both be right. A hardcoded offset was the bug that put the banner's
      // own text under the header once already.
      //
      // z-index 50: above the app content (2) and below the banner
      // (60), so a sticky banner scrolling over it wins, which is the
      // correct order for a safety notice.
      style={{
        position: 'fixed',
        top: 'calc(var(--demo-banner-h) + 14px)',
        right: 16,
        zIndex: 50
      }}
    >
      {control}
    </div>
  );
}
