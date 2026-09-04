/**
 * Render a component as the plain function it is, with no DOM.
 *
 * This project carries no jsdom and no render-testing library, and
 * adding one would be a dependency it has deliberately gone without —
 * see the header of context/VaultContext.test.js, which mocks React's
 * hooks down to the four it needs and calls the provider directly.
 * That technique works, and three screens now need it, so it lives
 * here instead of being copied three more times.
 *
 * WHAT THIS IS AND IS NOT
 * ----------------------
 * It is the real component module, running its real handlers and
 * returning its real element tree. react/jsx-runtime is NOT mocked, so
 * every element is a genuine React element and the walkers below read
 * the same structure React would.
 *
 * It is not a renderer. Child components appear in the tree as their
 * function `type` with props attached; they are never invoked. That
 * is exactly the property the Vault test needs — asserting that
 * <LoadFailed> is in the tree and <EmptyState> is not is a stronger
 * and more legible claim than matching rendered strings — and where a
 * child's own output matters, calling `node.type(node.props)` renders
 * that one subtree on demand.
 *
 * Re-rendering is manual: call beginRender() then invoke the component
 * again. State written by a handler is visible on that next call, the
 * same as React, and nothing re-renders on its own.
 */

let stateSlots = {};
let stateIndex = 0;
let refSlots = {};
let refIndex = 0;
let effects = [];

/** Drop all hook state. Call before the FIRST render of a component. */
export function resetHooks() {
  stateSlots = {};
  stateIndex = 0;
  refSlots = {};
  refIndex = 0;
  effects = [];
}

/**
 * Start a re-render: rewind the hook cursors but KEEP the state.
 * Effects are collected per render, so this clears them too.
 */
export function beginRender() {
  stateIndex = 0;
  refIndex = 0;
  effects = [];
}

/** The effect callbacks queued by the render just performed. */
export function pendingEffects() {
  return effects;
}

/** Let queued promise callbacks run. Two turns covers a .then().catch() chain. */
export async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

export const reactMock = {
  useState(initial) {
    const i = stateIndex++;
    if (!(i in stateSlots)) {
      stateSlots[i] = typeof initial === 'function' ? initial() : initial;
    }
    return [
      stateSlots[i],
      (next) => {
        stateSlots[i] = typeof next === 'function' ? next(stateSlots[i]) : next;
      }
    ];
  },
  useRef(initial) {
    const i = refIndex++;
    if (!(i in refSlots)) refSlots[i] = { current: initial };
    return refSlots[i];
  },
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  // Queued, not run. The test decides when — and, for a probe that
  // rejects, the point of the test is what happens between the effect
  // firing and the next render.
  useEffect: (fn) => { effects.push(fn); },
  createContext: () => ({ Provider: ({ value }) => value }),
  useContext: () => null
};

// ---------------------------------------------------------------
// TREE WALKING
// ---------------------------------------------------------------

/** Every node in an element tree, elements and text leaves alike. */
export function* walk(node) {
  if (node == null || typeof node === 'boolean') return;

  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child);
    return;
  }

  if (typeof node === 'object') {
    yield node;
    if (node.props) yield* walk(node.props.children);
    return;
  }

  yield node;   // string or number
}

/** The first element matching `pred`, or undefined. */
export function find(node, pred) {
  for (const n of walk(node)) {
    if (typeof n === 'object' && pred(n)) return n;
  }
  return undefined;
}

/**
 * The names of every component element in the tree.
 *
 * Host elements ('div', 'span') have a string type and are skipped —
 * only components are named, which is what makes "contains LoadFailed,
 * does not contain EmptyState" expressible.
 */
export function componentNames(node) {
  const names = [];
  for (const n of walk(node)) {
    if (typeof n === 'object' && typeof n.type === 'function') {
      names.push(n.type.name);
    }
  }
  return names;
}

/** All text leaves in the tree, joined — what a reader would see. */
export function texts(node) {
  const out = [];
  for (const n of walk(node)) {
    if (typeof n === 'string' || typeof n === 'number') out.push(String(n));
  }
  return out.join(' ');
}

/** An ApiError-shaped rejection: what api/client.js actually throws. */
export function apiError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}
