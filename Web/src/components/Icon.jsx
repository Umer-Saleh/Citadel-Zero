/**
 * Pixel icon family, taken verbatim from the design prototype's PX
 * table. 8x8 grids where '1' is a filled pixel, scaled up by size/8 —
 * so a 16px icon draws 2x2 blocks and stays exactly as crisp as the
 * source. Fill is currentColor, so each icon takes the colour of the
 * button or text it sits in, in both themes, for free.
 */

const PX = {
  lock:     ['..1111..', '.1....1.', '.1....1.', '11111111', '111..111', '111..111', '11111111', '11111111'],
  key:      ['........', '........', '.11.....', '1..1....', '1..11111', '1..1.1.1', '.11.....', '........'],
  eye:      ['........', '..1111..', '.1....1.', '1.1111.1', '1.1111.1', '.1....1.', '..1111..', '........'],
  eyeoff:   ['.1......', '..1111..', '.1.1..1.', '1.1111.1', '1.1111.1', '.1....1.', '..1111.1', '........'],
  copy:     ['11111...', '1...1...', '1...1...', '1.11111.', '1.1...1.', '111...1.', '..1...1.', '..11111.'],
  trash:    ['...11...', '11111111', '.1.11.1.', '.1.11.1.', '.1.11.1.', '.1.11.1.', '.1.11.1.', '.111111.'],
  plus:     ['...11...', '...11...', '...11...', '11111111', '11111111', '...11...', '...11...', '...11...'],
  shield:   ['11111111', '1......1', '1......1', '1......1', '.1....1.', '.1....1.', '..1..1..', '...11...'],
  search:   ['.1111...', '1....1..', '1....1..', '1....1..', '.1111...', '....11..', '.....11.', '......11'],
  check:    ['........', '.......1', '......11', '1....11.', '11..11..', '.1111...', '..11....', '........'],
  download: ['...11...', '...11...', '...11...', '.111111.', '..1111..', '...11...', '........', '11111111'],
  printer:  ['..1111..', '..1111..', '11111111', '1......1', '11111111', '..1111..', '..1..1..', '..1111..'],
  dice:     ['11111111', '1......1', '1.11...1', '1.11...1', '1...11.1', '1...11.1', '1......1', '11111111']
};

export function Icon({ name, size = 14, style }) {
  const rows = PX[name];
  if (!rows) return null;

  const rects = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < 8; x++) {
      if (row[x] === '1') rects.push(<rect key={`${y}-${x}`} x={x} y={y} width={1} height={1} />);
    }
  });

  return (
    <svg
      width={size} height={size}
      // viewBox stays at the icon's native 8x8 and the SVG scales
      // itself. Scaling the rects in JS put them on fractional
      // coordinates at sizes like 14 and 15, which is what made the
      // dice and the eye go fuzzy.
      viewBox="0 0 8 8"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true" focusable="false"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      {rects}
    </svg>
  );
}