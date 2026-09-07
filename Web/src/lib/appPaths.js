/**
 * Which URLs on this origin are the application.
 *
 * There is no router. App.jsx is a state machine, and its final
 * unconditional return renders the unlock screen — so before this
 * existed, every unknown path drew a password prompt. Web/nginx.conf
 * answers any unmatched path with index.html (the standard SPA
 * fallback), which means the browser gets HTTP 200 and the whole
 * application at /anything, /wp-admin, /.env alike.
 *
 * This lives in lib/ rather than in App.jsx so the list can be tested
 * directly. App.jsx is covered by react-refresh/only-export-components,
 * which forbids exporting a plain function beside a component.
 */

/**
 * LOAD-BEARING. This list is the entire definition of "a real page";
 * anything not on it renders the 404 screen.
 *
 * IF A NEW PATH IS EVER SERVED FROM THIS ORIGIN — an email-verification
 * callback, an OAuth redirect, a marketing page, a .well-known file
 * routed to the app — IT MUST BE ADDED HERE, or following that link
 * will silently show every visitor a not-found screen.
 *
 * That is the real cost of this check and it is stated here, at the
 * risk, on purpose. nginx.conf's try_files forwards every unmatched
 * path without recording which paths were meant, so this list and that
 * config have to be kept honest together: neither one can tell you the
 * other has gone wrong.
 *
 * '/index.html' is included because nginx serves it as an actual file,
 * so it is directly reachable and genuinely is the application.
 */
export const APP_PATHS = ['/', '/index.html'];

/**
 * Whether a pathname is the application.
 *
 * PATHNAME ONLY. Never hash or search: several links across the
 * pre-auth screens are href="#" with preventDefault, which sets a
 * hash, and a check that treated that as an unknown address would
 * break the navigation those links exist to perform.
 */
export function isAppPath(pathname) {
  return APP_PATHS.includes(pathname);
}
