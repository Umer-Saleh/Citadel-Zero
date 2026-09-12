# Measuring the wordmark

Run this whenever the CITADEL ZERO wordmark changes — its markup, its
styles, or the layout of anything that contains it. It takes about two
minutes and it is the only check that can see the defect it exists for.

## What went wrong, and why a test did not catch it

The wordmark appears on three surfaces:

| Surface | Element | Scale |
| --- | --- | --- |
| Signup (`Web/src/screens/Signup.jsx`) | block `div` | 21px, letter-spacing 2 |
| Unlock (`Web/src/screens/Unlock.jsx`) | block `div` | 21px, letter-spacing 2 |
| App header (`Web/src/components/AppShell.jsx`) | `button`, a flex container | 12px/1 above 640px, 10px/0 below |

A rename left the three spelling the name three different ways. The
commit that fixed that made all three read `CITADEL ` plus a green span
`ZERO`, verified the text nodes on all three screens, and shipped. The
header went on rendering **CITADELZERO**.

The text really was correct. The pixels were not. The header button is
a flex container, so its two children were two separate flex items —
an anonymous one holding `"CITADEL "` and the green span. That put the
space at the **end of a line**, where CSS drops it before layout. The
name lost 13px and nobody could see why by reading the DOM.

**Every text-level check passes while this is broken.** That is the
trap, and it is worth stating precisely, because the next person will
reach for the same tools:

- `textContent` is `"CITADEL ZERO"`. Correct.
- A `Range` over both halves returns `"CITADEL ZERO"` from
  `toString()`, while 91px renders. Correct, and useless.
- `innerText` on the flex button reads `"CITADEL\nZERO"` — a *newline*,
  because each flex item is its own block. Worse than useless: it
  invents a line break that is not on screen.

So the check has to be a measurement. There is no DOM-text assertion
that can tell 91px from 104px.

## The measurement

Per surface: measure one character with a `Range` to get the advance —
that is `fontSize + letter-spacing`, because the face is monospaced —
then assert that the green half starts exactly **8 advances** after the
first character. `CITADEL` is seven characters and the space is the
eighth. Under the collapse it is 7.

The ratio is the assertion because it is scale-independent: it holds at
21/2, at 12/1 and at 10/0 without carrying three expected pixel widths
around. The pixel widths are listed below anyway, as a cross-check.

### How to run it

The viewport must be set **before** the page loads, and reloaded fresh
for each width — the header's scale changes at 640px, and a resized
page can keep the previous branch's layout.

1. Open the app, open DevTools, switch on the device toolbar.
2. Set the width to 1440, then 375, then 320. Reload at each.
3. Paste the script into the console and run `checkWordmarks()`.
4. Do it on all three surfaces: Signup, Unlock, and the app header
   (any screen inside an unlocked vault).

```js
// Paste into the DevTools console on the surface being checked.

function measureWordmark(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let c;
  while ((c = walker.nextNode()) && !/^CITADEL/.test(c.data)) { /* find it */ }

  const zero = [...root.querySelectorAll('span')]
    .find(s => s.textContent.trim() === 'ZERO');

  const r = document.createRange();

  // One character. In a monospaced face this is the advance every
  // other character has: fontSize + letter-spacing.
  r.setStart(c, 0);
  r.setEnd(c, 1);
  const first = r.getBoundingClientRect();

  // The whole black half, including the trailing space if it survived.
  r.setEnd(c, c.data.length);
  const textBox = r.getBoundingClientRect().width;

  r.selectNodeContents(zero);
  const green = r.getBoundingClientRect();

  const cs = getComputedStyle(root);

  return {
    scale: `${cs.fontSize} / ${cs.letterSpacing}`,
    advance: +first.width.toFixed(2),
    textBox: +textBox.toFixed(2),
    ratio: +((green.left - first.left) / first.width).toFixed(3),  // must be 8
    sameLine: Math.round(green.top) === Math.round(first.top),     // must be true
    pageOverflows:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth                          // must be false
  };
}

/** Every VISIBLE wordmark on this screen: an element with "CITADEL "
 *  as a direct text child and a ZERO span beside it.
 *
 *  The footer credit is a single text node with no span, so it is
 *  correctly skipped. getClientRects() drops anything not being drawn —
 *  a screen still mounted behind a hidden root measures 0 wide and
 *  would otherwise report a meaningless ratio. */
function wordmarkRoots() {
  return [...document.querySelectorAll('button, div, span')].filter(el =>
    el.getClientRects().length &&
    [...el.childNodes].some(n => n.nodeType === 3 && /^CITADEL\s/.test(n.data)) &&
    [...el.children].some(s => s.textContent.trim() === 'ZERO'));
}

async function checkWordmarks() {
  await document.fonts.ready;   // Press Start 2P must have arrived

  const rows = wordmarkRoots().map(measureWordmark);
  console.table(rows);

  const bad = rows.filter(r => r.ratio !== 8 || !r.sameLine || r.pageOverflows);
  console.log(bad.length
    ? `FAIL — ${bad.length} of ${rows.length} wrong`
    : `PASS — ${rows.length} wordmark(s), ratio 8 at ${innerWidth}px`);

  return rows;
}

checkWordmarks();
```

### What the numbers should be

`ratio` is 8 everywhere. The rest vary by scale:

| Surface | Width | Scale | advance | textBox | ratio |
| --- | --- | --- | --- | --- | --- |
| Signup, Unlock | 1440, 375, 320 | 21px / 2px | 23 | 184 | 8 |
| Header | 1440 | 12px / 1px | 13 | 104 | 8 |
| Header | 375, 320 | 10px / normal | 10 | 80 | 8 |

`letter-spacing: normal` rather than `0` at the two phone widths is
just how it computes; the advance of 10 is what matters. That branch
comes from `Web/src/theme.css:604-607`, which drops the header wordmark
two steps below 640px — it is a third scale, not a second, and a fix
that depends on a letter-spacing value will pass at one of these and
fail at another.

**Under the collapse** the header reads `textBox` 91 at 1440 and 70 at
375/320, with `ratio` 7. That is the failure signature.

### Prove the measurement still bites

A check that only ever passes is not evidence. Break it on purpose:

```js
// Undo the wrapper — exactly the shape the bug had.
const btn = document.querySelector('button.vk-r-wordmark');
const wrapper = btn.firstElementChild;
btn.append(...wrapper.childNodes);
wrapper.remove();

measureWordmark(btn);   // ratio 7, textBox 91 (or 70 below 640px)
```

Then reload the page to restore it. If that does **not** report 7, the
measurement is no longer measuring anything and needs fixing before it
is trusted.

## What holds this in place between runs

`Web/src/components/AppShell.jsx` wraps both halves in one span and
carries `whiteSpace: 'nowrap'`. The wrapper is a single flex item with
its own inline formatting context, so the space is interior text rather
than end-of-line — at every scale, whatever the parent's display mode.
`nowrap` is there because the wrapper lowers the button's min-content
width from the whole wordmark to `CITADEL`, so a squeezed header could
otherwise break the name across two lines, which the two separate flex
items could not.

Rejected alternatives, all measured: a non-breaking space (works, but
is invisible in source and one formatter away from silently reverting);
a margin on the green span (7.923 at 12/1 and 7.913 at 21/2 — it misses
by the letter-spacing, and is correct only where that is 0); the space
moved inside the green span (still 7 — leading white space at the start
of a line is dropped too); `white-space: pre` (works, but leaves the
three surfaces with three different mechanisms).

`Web/src/components/AppShell.test.jsx` has a tripwire in CI asserting
the wrapper and the `nowrap`. **It pins the mechanism, not the defect.**
It has no DOM and no layout, it cannot see a pixel, and it would not
have caught the original bug. It catches someone tidying the wrapper
away as redundant markup. This document is the check that sees the bug.
