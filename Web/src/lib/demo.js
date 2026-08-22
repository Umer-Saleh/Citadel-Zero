/**
 * Demo-instance configuration.
 *
 * Every value here is inlined by Vite at build time, so all of it is
 * public the moment the bundle ships. Nothing secret may be added to
 * this file — the demo account's password lives here precisely
 * because it is meant to be read.
 *
 * On a normal build VITE_DEMO_MODE is unset, DEMO_MODE is a literal
 * false, and every guarded branch is dropped by the bundler.
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

export const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL || '';
export const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD || '';
