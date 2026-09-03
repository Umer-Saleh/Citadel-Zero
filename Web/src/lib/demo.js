/**
 * Demo-instance configuration.
 *
 * Inlined by Vite at build time, so it is public the moment the bundle
 * ships. Nothing secret may be added to this file.
 *
 * On a normal build VITE_DEMO_MODE is unset, DEMO_MODE is a literal
 * false, and every guarded branch is dropped by the bundler. It must
 * stay a module-level constant compared against a literal for that to
 * work — putting it behind a function, a prop or context state would
 * make it a runtime value and ship the demo code to everyone.
 *
 * DEMO_EMAIL and DEMO_PASSWORD used to live here: one shared demo
 * account whose credentials were printed on the unlock screen. They
 * are gone. Every visitor now provisions their own throwaway vault,
 * so there is no shared password to publish — and nothing any visitor
 * can change that breaks the demo for the next one.
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
