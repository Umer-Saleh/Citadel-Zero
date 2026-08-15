import { useTheme } from '../context/ThemeContext';

const PALS = {
  dark: {
    armor: '#C9CBB4', armorSh: '#7E8168', armorHi: '#F0E9D6', outline: '#2A2E20',
    shield: '#232820', bevelL: '#5A5F45', bevelD: '#15170F', glow: '#5FD84A',
    amber: '#F2B33D', blade: '#C9CBB4', red: '#E5484D', ember: '#4A6B3F'
  },
  light: {
    armor: '#5C5B4F', armorSh: '#3E3D33', armorHi: '#83816F', outline: '#26261B',
    shield: '#E8DDBD', bevelL: '#FBF6E9', bevelD: '#A69565', glow: '#3E8E2F',
    amber: '#C67C16', blade: '#6B6A5C', red: '#C0353A', ember: '#7A9468'
  }
};

function drawFrame(pose, f, size, theme, ring) {
  const u = size / 48;
  const P = PALS[theme] || PALS.dark;
  let k = 0;
  const rects = [];
  const R = (x, y, w, h, c, st) => rects.push(
    <rect key={'r' + (k++)} x={x * u} y={y * u} width={w * u} height={h * u} fill={c} style={st} />
  );

  const kneel = pose === 'oath';
  const bob = ['idle', 'atEase', 'power', 'smithIdle', 'bored'].includes(pose) && f ? 1 : 0;
  const hop = pose === 'levelup' && f ? -3 : 0;
  const dy = (kneel ? 7 : 0) + bob + hop;
  const shake = pose === 'deflect' ? (f ? -1 : 1) : 0;

  const moods = { channel: 'amber', watch: 'amber', deflect: 'red', brace: 'red', guard: 'ember', oath: 'ember' };
  const mood = moods[pose] || 'green';
  const eyeC = mood === 'amber' ? P.amber : mood === 'red' ? P.red : mood === 'ember' ? P.ember : P.glow;

  R(13, 45, 22, 2, 'rgba(0,0,0,.22)');

  if (!kneel && pose !== 'cover') { R(11 + (f ? 1 : 0), 21 + dy, 5, 11, P.amber); R(11 + (f ? 1 : 0), 30 + dy, 4, 2, P.armorSh); }

  if (kneel) {
    R(19, 33, 5, 8, P.armorSh); R(18, 41, 7, 3, P.outline);
    R(26, 37, 7, 4, P.armorSh); R(31, 41, 4, 3, P.outline);
  } else {
    const sp = pose === 'brace' ? 2 : 0;
    R(18 - sp, 33 + dy, 5, 8, P.armorSh); R(25 + sp, 33 + dy, 5, 8, P.armorSh);
    R(17 - sp, 41 + dy, 6, 3, P.outline); R(25 + sp, 41 + dy, 6, 3, P.outline);
  }

  R(16, 19 + dy, 16, 13, P.armor); R(16, 19 + dy, 2, 13, P.armorHi); R(30, 19 + dy, 2, 13, P.armorSh);
  R(16, 30 + dy, 16, 2, P.armorSh); R(23, 30 + dy, 2, 2, P.amber);
  R(12, 17 + dy, 7, 6, P.armor); R(13, 18 + dy, 2, 1, P.armorHi); R(12, 22 + dy, 7, 1, P.armorSh);
  R(29, 17 + dy, 7, 6, P.armor); R(33, 18 + dy, 2, 1, P.armorHi); R(29, 22 + dy, 7, 1, P.armorSh);

  const nod = (['gate', 'seal', 'rise', 'reforge'].includes(pose) && f) ? 2 : (pose === 'bored' ? 1 : 0);
  const hy = 4 + dy + nod, hx = 15 + shake;
  R(hx, hy, 18, 13, P.armor); R(hx, hy, 18, 2, P.armorHi); R(hx, hy + 11, 18, 2, P.armorSh);
  R(hx - 1, hy + 2, 1, 9, P.outline); R(hx + 18, hy + 2, 1, 9, P.outline);
  R(hx + 1, hy + 6, 16, 3, P.outline);
  const gl = pose === 'atEase' && f ? 1 : 0;
  R(hx + 4 + gl, hy + 7, 2, 2, eyeC); R(hx + 12 + gl, hy + 7, 2, 2, eyeC);

  const droop = pose === 'bored' ? 2 : 0, up = (pose === 'brace' || pose === 'deflect') ? -1 : 0;
  R(hx + 7, hy - 4 + droop + up + (f && !droop ? 1 : 0), 4, 4, P.amber);
  R(hx + 7, hy - 1 + droop + up, 4, 1, P.armorSh);

  const swords = { channel: 'up', gate: 'strike', strike: f ? 'strike' : 'up', forgeStore: f ? 'strike' : 'up', smith: f ? 'strike' : 'up', snatch: 'strike', wipe: 'strike', oath: 'planted', levelup: 'up', power: 'up' };
  const sw = swords[pose] || 'down';
  if (sw === 'down') { R(8, 24 + dy, 2, 14, P.blade); R(6, 30 + dy, 2, 2, P.blade); R(6, 34 + dy, 2, 2, P.blade); R(7, 22 + dy, 4, 2, P.amber); }
  else if (sw === 'up') { R(8, 2, 2, 16, P.blade); R(6, 4, 2, 2, P.blade); R(6, 8, 2, 2, P.blade); R(7, 18, 4, 2, P.amber); R(8, 1, 2, 1, P.glow); }
  else if (sw === 'strike') { R(2, 26 + dy, 13, 2, P.blade); R(2, 24 + dy, 2, 2, P.blade); R(6, 24 + dy, 2, 2, P.blade); R(15, 25 + dy, 2, 4, P.amber); }
  else if (sw === 'planted') { R(20, 26, 8, 2, P.amber); R(23, 24, 2, 2, P.blade); R(23, 28, 2, 14, P.blade); }

  const shields = { guard: 'front', brace: 'front', deflect: 'front', cover: 'raised', smith: 'anvil', smithIdle: 'anvil' };
  const sh = shields[pose] || 'side';
  const drawShield = (x, y) => {
    R(x, y, 14, 14, P.shield);
    R(x, y, 14, 2, P.bevelL); R(x, y, 2, 14, P.bevelL);
    R(x + 12, y + 2, 2, 12, P.bevelD);
    R(x + 2, y + 14, 10, 3, P.shield); R(x + 2, y + 14, 1, 3, P.bevelL); R(x + 11, y + 14, 1, 3, P.bevelD);
    R(x + 4, y + 17, 6, 2, P.shield); R(x + 6, y + 19, 2, 1, P.bevelD);
    R(x + 5, y + 4, 4, 4, P.glow, { animation: 'kglow 2.4s ease-in-out infinite' });
    R(x + 6, y + 8, 2, 4, P.glow, { animation: 'kglow 2.4s ease-in-out infinite' });
  };
  if (sh === 'side') drawShield(32, (kneel ? 20 : 17 + dy));
  else if (sh === 'front') drawShield(22, 18);
  else if (sh === 'raised') drawShield(15, 2);
  else if (sh === 'anvil') { R(18, 36, 18, 4, P.shield); R(18, 36, 18, 1, P.bevelL); R(18, 39, 18, 1, P.bevelD); }

  if (pose === 'channel' && ring != null) {
    const n = Math.round(ring * 12);
    for (let i = 0; i < 12; i++) {
      const a = (-90 + i * 30) * Math.PI / 180;
      R(23 + Math.round(21 * Math.cos(a)), 23 + Math.round(21 * Math.sin(a)), 3, 3, i < n ? P.glow : P.armorSh);
    }
  }
  if ((pose === 'forgeStore' || pose === 'smith') && f) { R(14, 20, 2, 2, P.amber); R(18, 16, 2, 2, P.glow); R(12, 15, 2, 2, P.amber); }
  if (pose === 'gate' && !f) R(36, 20, 8, 8, P.glow, { opacity: .8 });
  if (pose === 'deflect' && f) { R(18, 20, 2, 2, P.red); R(14, 15, 2, 2, P.red); }
  if ((pose === 'seal' || pose === 'reforge') && f) R(35, 20, 8, 8, pose === 'seal' ? P.glow : P.amber, { opacity: .85 });
  if (pose === 'snatch') { R(14, 18, 2, 2, P.glow); if (f) R(11, 14, 2, 2, P.glow); }
  if (pose === 'wipe' && f) R(2, 21, 14, 2, P.amber, { opacity: .7 });
  if (pose === 'levelup') R(10, f ? 34 : 8, 28, 2, P.glow, { opacity: .55 });
  if (pose === 'brace' && f) { R(6, 6, 36, 1, P.red, { opacity: .4 }); R(6, 43, 36, 1, P.red, { opacity: .4 }); R(6, 6, 1, 37, P.red, { opacity: .4 }); R(42, 6, 1, 37, P.red, { opacity: .4 }); }
  if (pose === 'power') R(33, 15, 12, 12, P.glow, { opacity: .14 });
  if (pose === 'rise' && f) R(36, 20, 6, 6, P.glow, { opacity: .5 });

  return rects;
}

export function Paladin({ pose = 'idle', size = 48, ring = null }) {
  const { theme } = useTheme();

  const frame = (f) => (
    <svg
      // Decorative. PIX conveys mood, never information — every state
      // he reacts to is also stated in text nearby.
      aria-hidden="true"
      focusable="false"
      key={'f' + f}
      width={size} height={size}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      style={{ position: 'absolute', inset: 0, animation: (f ? 'sprB' : 'sprA') + ' 1.1s steps(1) infinite' }}
    >
      {drawFrame(pose, f, size, theme, ring)}
    </svg>
  );

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {frame(0)}
      {frame(1)}
    </div>
  );
}