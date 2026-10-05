// Generates ../stage/photo.svg: a vector golden-hour mountain-lake landscape (3:2, 1500 x 1000).
// Deterministic (seeded RNG) so every render of the stage shows the same "photo".
const fs = require('fs');
const path = require('path');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(412);
const r = (a, b) => a + (b - a) * rnd();
const f1 = (n) => Math.round(n * 10) / 10;

const W = 1500, H = 1000, HORIZON = 640;

// Midpoint displacement between control points.
function ridge(ctrl, rough, depth) {
  let pts = ctrl.map(([x, y]) => [x, y]);
  for (let d = 0; d < depth; d++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const len = Math.abs(x1 - x0);
      const mx = (x0 + x1) / 2 + r(-0.12, 0.12) * len;
      const my = (y0 + y1) / 2 + r(-1, 1) * len * rough;
      next.push([mx, my], [x1, y1]);
    }
    pts = next;
    rough *= 0.62;
  }
  return pts;
}
function ridgePath(pts, bottom) {
  let d = `M${f1(pts[0][0])},${bottom} L${f1(pts[0][0])},${f1(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += ` L${f1(pts[i][0])},${f1(pts[i][1])}`;
  d += ` L${f1(pts[pts.length - 1][0])},${bottom} Z`;
  return d;
}
function ridgeLine(pts) {
  return 'M' + pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' L');
}

// Ridges, far to near. The sun (1035, 560) sets into the gap between the two far peaks.
const R1 = ridge([[-20, 520], [150, 430], [330, 470], [520, 372], [700, 455], [860, 420], [990, 540], [1060, 574], [1150, 520], [1290, 452], [1420, 488], [1520, 470]], 0.22, 7);
const R2 = ridge([[-20, 548], [120, 500], [260, 540], [420, 470], [600, 548], [760, 520], [900, 585], [1000, 606], [1120, 596], [1230, 540], [1360, 512], [1520, 560]], 0.2, 7);
const R3 = ridge([[-20, 585], [90, 560], [240, 590], [380, 552], [520, 600], [700, 614], [880, 628], [1060, 632], [1200, 610], [1330, 586], [1450, 570], [1520, 590]], 0.16, 7);
const R4 = ridge([[-20, 548], [80, 530], [210, 566], [330, 598], [460, 628], [600, 640], [760, 643], [1000, 644], [1180, 641], [1310, 628], [1420, 612], [1520, 604]], 0.12, 7);

// Distant shoreline tree line along the horizon (tiny bumps).
function treeline(x0, x1, base, hmin, hmax) {
  let d = `M${x0},${base}`;
  for (let x = x0; x < x1;) {
    const w = r(3, 9), h = r(hmin, hmax);
    d += ` L${f1(x + w * 0.5)},${f1(base - h)} L${f1(x + w)},${f1(base - h * r(0.2, 0.6))}`;
    x += w;
  }
  d += ` L${x1},${base} Z`;
  return d;
}

// Conifer silhouette: trunk at (x, base), height h. Irregular drooping branch tiers.
function conifer(x, base, h, lean) {
  const side = (dir) => {
    const pts = [];
    let t = 0.04;
    while (t < 0.97) {
      const y = base - t * h;
      const cx = x + lean * t * h * 0.03;
      const wMax = (h * 0.23 * Math.pow(1 - t, 0.9) + 1.5) * (rnd() < 0.12 ? 0.45 : r(0.7, 1.2));
      const droop = r(0.6, 1.6) * (2 + (1 - t) * h * 0.03);
      pts.push([cx + dir * wMax * r(0.18, 0.35), y - r(1, 3)]);       // inner notch
      pts.push([cx + dir * wMax * r(0.75, 0.95), y + droop * 0.4]);     // along the branch
      pts.push([cx + dir * wMax, y + droop]);                           // drooping tip
      pts.push([cx + dir * wMax * r(0.4, 0.6), y + droop * 0.2 + r(-1, 1)]);
      t += r(0.035, 0.07) * (h > 150 ? 0.8 : 1.1);
    }
    return pts;
  };
  const L = side(-1), R = side(1).reverse();
  const top = [x + lean * h * 0.03, base - h - r(4, 12)];
  const pts = [[x - 2.4, base + 3], ...L, [top[0] - 1, top[1] + 8], top, [top[0] + 1, top[1] + 8], ...R, [x + 2.4, base + 3]];
  return 'M' + pts.map(([a, b]) => `${f1(a)},${f1(b)}`).join(' L') + ' Z';
}

// Foreground left hill and right shore.
const hillL = ridge([[-20, 760], [90, 742], [210, 770], [330, 812], [440, 872], [560, 930], [700, 975], [820, 1010]], 0.07, 6);
const shoreR = ridge([[880, 1010], [1000, 978], [1120, 962], [1240, 948], [1360, 930], [1440, 912], [1520, 900]], 0.06, 6);

let trees = '';
const treeSpecs = [
  [18, 790, 330], [52, 772, 380], [86, 776, 300], [120, 770, 250], [150, 782, 214], [176, 788, 280],
  [206, 795, 196], [232, 806, 168], [262, 822, 150], [290, 836, 124], [318, 850, 96], [344, 866, 78],
  [372, 884, 62], [-6, 810, 260], [134, 800, 160], [70, 800, 190],
];
for (const [x, b, h] of treeSpecs) trees += `<path d="${conifer(x, b, h, r(-0.4, 0.4))}"/>`;
let treesR = '';
for (const [x, b, h] of [[1478, 905, 230], [1446, 914, 170], [1500, 900, 290], [1412, 924, 110], [1386, 932, 74]]) treesR += `<path d="${conifer(x, b, h, r(-0.3, 0.3))}"/>`;
// Far shore conifers (small) on the right side of the lake
let farTrees = '';
for (let x = 1180; x < 1520; x += r(5, 11)) farTrees += `<path d="${conifer(x, 642 - (x - 1180) * 0.08, r(8, 22), 0)}"/>`;
for (let x = -10; x < 470; x += r(5, 11)) farTrees += `<path d="${conifer(x, 640 + Math.max(0, x - 300) * 0.0, r(7, 18), 0)}"/>`;

// Small conifers along the nearest ridge line (R4) where it rises above the shore.
function yOn(pts, x) {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (x >= x0 && x <= x1) return y0 + (y1 - y0) * ((x - x0) / (x1 - x0 || 1));
  }
  return 640;
}
for (let x = -10; x < 1520; x += r(3.5, 7.5)) {
  const y = yOn(R4, x);
  if (y > 634) continue;
  farTrees += `<path d="${conifer(x, y + 3, r(6, 15), 0)}"/>`;
}

// Sun glitter on the lake: horizontal strokes beneath the sun.
let glitter = '';
for (let i = 0; i < 150; i++) {
  const t = Math.pow(rnd(), 1.25);           // more near horizon
  const y = HORIZON + 3 + t * 300;
  const spread = 18 + t * 150;
  const x = 1035 + (rnd() + rnd() - 1) * spread;
  const w = r(6, 34) * (1 - t * 0.5);
  const o = (1 - t) * r(0.25, 0.85);
  glitter += `<rect x="${f1(x - w / 2)}" y="${f1(y)}" width="${f1(w)}" height="${f1(r(0.8, 2.2) * (0.6 + t))}" rx="1" fill="#ffe2a8" opacity="${o.toFixed(2)}"/>`;
}
// Lake ripple lines (perspective spacing).
let ripples = '';
for (let i = 0; i < 70; i++) {
  const t = Math.pow(rnd(), 1.6);
  const y = HORIZON + 6 + t * 350;
  const x = r(-100, 1500);
  const w = r(40, 260) * (0.4 + t);
  const light = rnd() < 0.45;
  ripples += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(0.6 + t * 2.2)}" fill="${light ? '#ffd9b0' : '#0b1020'}" opacity="${(light ? r(0.02, 0.06) : r(0.04, 0.11)).toFixed(3)}"/>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="${HORIZON}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#101c3c"/>
    <stop offset="0.2" stop-color="#1d2d5a"/>
    <stop offset="0.42" stop-color="#3f4a7c"/>
    <stop offset="0.6" stop-color="#7a6488"/>
    <stop offset="0.74" stop-color="#c47c78"/>
    <stop offset="0.86" stop-color="#ec9a63"/>
    <stop offset="0.95" stop-color="#f7b96d"/>
    <stop offset="1" stop-color="#fbd08a"/>
  </linearGradient>
  <radialGradient id="sunGlow" cx="1035" cy="560" r="640" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#fff6d8" stop-opacity="0.95"/>
    <stop offset="0.05" stop-color="#ffe3a0" stop-opacity="0.8"/>
    <stop offset="0.18" stop-color="#ffb867" stop-opacity="0.45"/>
    <stop offset="0.45" stop-color="#f08a5a" stop-opacity="0.16"/>
    <stop offset="1" stop-color="#f08a5a" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="sunCore" cx="1035" cy="560" r="60" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#ffffff"/>
    <stop offset="0.35" stop-color="#fffbe8"/>
    <stop offset="0.6" stop-color="#ffe7a8" stop-opacity="0.7"/>
    <stop offset="1" stop-color="#ffd27a" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="cloudColor" x1="0" y1="80" x2="0" y2="520" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#4d4a74"/>
    <stop offset="0.45" stop-color="#b9718a"/>
    <stop offset="0.75" stop-color="#f3a27a"/>
    <stop offset="1" stop-color="#ffd3a0"/>
  </linearGradient>
  <linearGradient id="cloudBand" x1="0" y1="0" x2="0" y2="${HORIZON}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/>
    <stop offset="0.15" stop-color="#fff" stop-opacity="0.55"/>
    <stop offset="0.45" stop-color="#fff" stop-opacity="0.95"/>
    <stop offset="0.72" stop-color="#fff" stop-opacity="0.5"/>
    <stop offset="0.86" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <filter id="cloudNoise" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.0016 0.011" numOctaves="5" seed="11" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.4 0 0 0 -1.55"/>
  </filter>
  <filter id="cloudNoise2" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.0032 0.02" numOctaves="4" seed="5" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.8 0 0 0 -1.9"/>
  </filter>
  <mask id="cloudMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${HORIZON}">
    <rect x="0" y="0" width="${W}" height="${HORIZON}" fill="#fff" filter="url(#cloudNoise)"/>
  </mask>
  <mask id="cloudMask2" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${HORIZON}">
    <rect x="0" y="0" width="${W}" height="${HORIZON}" fill="#fff" filter="url(#cloudNoise2)"/>
  </mask>
  <mask id="cloudBandMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${HORIZON}">
    <rect x="0" y="0" width="${W}" height="${HORIZON}" fill="url(#cloudBand)"/>
  </mask>
  <linearGradient id="r1" x1="0" y1="360" x2="0" y2="${HORIZON}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#58527f"/><stop offset="0.55" stop-color="#7c6a8c"/><stop offset="1" stop-color="#b98a88"/>
  </linearGradient>
  <linearGradient id="r2" x1="0" y1="460" x2="0" y2="${HORIZON}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#403e6c"/><stop offset="1" stop-color="#685c80"/>
  </linearGradient>
  <linearGradient id="r3" x1="0" y1="540" x2="0" y2="${HORIZON}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#282a50"/><stop offset="1" stop-color="#3b3a5e"/>
  </linearGradient>
  <linearGradient id="r4" x1="0" y1="520" x2="0" y2="${HORIZON}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#191d35"/><stop offset="1" stop-color="#252843"/>
  </linearGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#ffc58a" stop-opacity="0"/>
    <stop offset="0.5" stop-color="#ffc58a" stop-opacity="0.25"/>
    <stop offset="0.69" stop-color="#ffe0b0" stop-opacity="0.9"/>
    <stop offset="0.85" stop-color="#ffc58a" stop-opacity="0.3"/>
    <stop offset="1" stop-color="#ffc58a" stop-opacity="0.05"/>
  </linearGradient>
  <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffd2a8" stop-opacity="0"/>
    <stop offset="0.7" stop-color="#ffcfa0" stop-opacity="0.35"/>
    <stop offset="1" stop-color="#ffd8ae" stop-opacity="0.55"/>
  </linearGradient>
  <linearGradient id="hazeSide" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#000" stop-opacity="0.35"/>
    <stop offset="0.69" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.2"/>
  </linearGradient>
  <linearGradient id="lake" x1="0" y1="${HORIZON}" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#e7a774"/>
    <stop offset="0.12" stop-color="#b9817e"/>
    <stop offset="0.38" stop-color="#5f5a80"/>
    <stop offset="0.7" stop-color="#2a3156"/>
    <stop offset="1" stop-color="#131a33"/>
  </linearGradient>
  <linearGradient id="reflFade" x1="0" y1="${HORIZON}" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#fff" stop-opacity="0.85"/>
    <stop offset="0.6" stop-color="#fff" stop-opacity="0.45"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0.15"/>
  </linearGradient>
  <mask id="reflMask" maskUnits="userSpaceOnUse" x="0" y="${HORIZON}" width="${W}" height="${H - HORIZON}">
    <rect x="0" y="${HORIZON}" width="${W}" height="${H - HORIZON}" fill="url(#reflFade)"/>
  </mask>
  <radialGradient id="sunPath" cx="1035" cy="${HORIZON + 10}" r="300" gradientUnits="userSpaceOnUse" gradientTransform="translate(1035 ${HORIZON + 10}) scale(0.32 1.2) translate(-1035 ${-(HORIZON + 10)})">
    <stop offset="0" stop-color="#ffe9b8" stop-opacity="0.85"/>
    <stop offset="0.35" stop-color="#ffc07a" stop-opacity="0.35"/>
    <stop offset="1" stop-color="#ffb070" stop-opacity="0"/>
  </radialGradient>
  <filter id="rock" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.011 0.013" numOctaves="6" seed="9" result="t"/>
    <feDiffuseLighting in="t" surfaceScale="7" lighting-color="#ffffff" result="l"><feDistantLight azimuth="-30" elevation="62"/></feDiffuseLighting>
    <feComposite in="l" in2="SourceGraphic" operator="in"/>
  </filter>
  <filter id="snowNoise" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.035 0.007" numOctaves="4" seed="21" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  5 0 0 0 -2.35"/>
  </filter>
  <linearGradient id="snowFade" x1="0" y1="360" x2="0" y2="520" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <mask id="snowMask" maskUnits="userSpaceOnUse" x="0" y="300" width="${W}" height="240">
    <g><rect x="0" y="300" width="${W}" height="240" fill="#fff" filter="url(#snowNoise)"/></g>
  </mask>
  <mask id="snowFadeMask" maskUnits="userSpaceOnUse" x="0" y="300" width="${W}" height="240">
    <rect x="0" y="300" width="${W}" height="240" fill="url(#snowFade)"/>
  </mask>
  <clipPath id="r1clip"><path d="${ridgePath(R1, HORIZON + 2)}"/></clipPath>
  <filter id="rough" x="-2%" y="-2%" width="104%" height="104%">
    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="4" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="0.7"/>
  </filter>
  <filter id="roughTrees" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.18" numOctaves="2" seed="8" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="water" x="0" y="-2%" width="100%" height="104%">
    <feTurbulence type="fractalNoise" baseFrequency="0.003 0.09" numOctaves="2" seed="6" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="G" yChannelSelector="R" result="d"/>
    <feGaussianBlur in="d" stdDeviation="2.2 3"/>
  </filter>
  <filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="1.2 5"/></filter>
  <filter id="blur2"><feGaussianBlur stdDeviation="2"/></filter>
  <filter id="blur8" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>
  <filter id="mist" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="14 6"/></filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" stitchTiles="stitch" result="g"/>
    <feColorMatrix in="g" type="saturate" values="0"/>
  </filter>
  <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
    <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.42"/>
  </radialGradient>
  <linearGradient id="fg" x1="0" y1="740" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#151827"/><stop offset="1" stop-color="#07080d"/>
  </linearGradient>
  <g id="ridges">
    <g filter="url(#rough)">
      <path d="${ridgePath(R1, HORIZON + 2)}" fill="url(#r1)"/>
      <path d="${ridgePath(R1, HORIZON + 2)}" fill="#fff" filter="url(#rock)" opacity="0.24" style="mix-blend-mode:multiply"/>
      <path d="${ridgeLine(R1)}" fill="none" stroke="url(#rim)" stroke-width="1.8" opacity="0.75"/>
    </g>
    <rect x="0" y="470" width="${W}" height="${HORIZON - 470 + 2}" fill="url(#haze)" opacity="0.5"/>
    <g filter="url(#rough)">
      <path d="${ridgePath(R2, HORIZON + 2)}" fill="url(#r2)"/>
      <path d="${ridgePath(R2, HORIZON + 2)}" fill="#fff" filter="url(#rock)" opacity="0.24" style="mix-blend-mode:multiply"/>
      <path d="${ridgeLine(R2)}" fill="none" stroke="url(#rim)" stroke-width="1.3" opacity="0.5"/>
    </g>
    <rect x="0" y="540" width="${W}" height="${HORIZON - 540 + 2}" fill="url(#haze)" opacity="0.42"/>
    <g filter="url(#rough)">
      <path d="${ridgePath(R3, HORIZON + 2)}" fill="url(#r3)"/>
      <path d="${ridgePath(R3, HORIZON + 2)}" fill="#fff" filter="url(#rock)" opacity="0.2" style="mix-blend-mode:multiply"/>
      <path d="${ridgeLine(R3)}" fill="none" stroke="url(#rim)" stroke-width="1" opacity="0.35"/>
    </g>
    <rect x="0" y="590" width="${W}" height="${HORIZON - 590 + 2}" fill="url(#haze)" opacity="0.32"/>
    <path d="${ridgePath(R4, HORIZON + 2)}" fill="url(#r4)" filter="url(#rough)"/>
    <g fill="#151829" filter="url(#roughTrees)">${farTrees}</g>
    <rect x="0" y="0" width="${W}" height="${HORIZON + 2}" fill="url(#hazeSide)" opacity="0.6"/>
  </g>
</defs>

<!-- sky -->
<rect width="${W}" height="${HORIZON + 2}" fill="url(#sky)"/>
<rect width="${W}" height="${HORIZON + 2}" fill="url(#sunGlow)"/>
<g mask="url(#cloudBandMask)">
  <rect width="${W}" height="${HORIZON}" fill="url(#cloudColor)" mask="url(#cloudMask)" opacity="0.85"/>
  <rect width="${W}" height="${HORIZON}" fill="url(#cloudColor)" mask="url(#cloudMask2)" opacity="0.5"/>
</g>
<circle cx="1035" cy="560" r="150" fill="url(#sunCore)" opacity="0.55" filter="url(#blur8)"/>
<circle cx="1035" cy="560" r="60" fill="url(#sunCore)"/>
<circle cx="1035" cy="560" r="22" fill="#fffdf2"/>

<!-- mountains -->
<use href="#ridges"/>

<circle cx="1035" cy="562" r="90" fill="url(#sunCore)" opacity="0.55" style="mix-blend-mode:screen"/>


<!-- lake -->
<rect x="0" y="${HORIZON}" width="${W}" height="${H - HORIZON}" fill="url(#lake)"/>
<g mask="url(#reflMask)">
  <g filter="url(#water)"><g transform="translate(0 ${HORIZON * 2 + 2}) scale(1 -1)" opacity="0.78">
    <use href="#ridges"/>
  </g></g>
</g>
<rect x="0" y="${HORIZON}" width="${W}" height="${H - HORIZON}" fill="url(#sunPath)"/>
<g>${ripples}</g>
<g filter="url(#blur2)" opacity="0.9">${glitter}</g>
<g>${glitter}</g>
<rect x="0" y="${HORIZON}" width="${W}" height="2" fill="#ffd6a0" opacity="0.35"/>
<ellipse cx="760" cy="${HORIZON + 4}" rx="900" ry="10" fill="#ffd9ad" opacity="0.18" filter="url(#mist)"/>

<!-- foreground -->
<path d="${ridgePath(hillL, H + 20)}" fill="url(#fg)"/>
<path d="${ridgeLine(hillL.slice(Math.floor(hillL.length * 0.45)))}" fill="none" stroke="#c0794a" stroke-width="1.6" opacity="0.35"/>
<path d="${ridgePath(shoreR, H + 20)}" fill="url(#fg)"/>
<path d="${ridgeLine(shoreR.slice(0, Math.floor(shoreR.length * 0.6)))}" fill="none" stroke="#c98552" stroke-width="1.4" opacity="0.4"/>
<g fill="#07090f" filter="url(#roughTrees)">${trees}${treesR}</g>
<!-- reflection of the left trees on the water near shore -->
<g transform="translate(0 ${2 * 900}) scale(1 -1)" opacity="0.22" filter="url(#soft)" fill="#05070c">
  <path d="${conifer(372, 884, 62, 0)}"/><path d="${conifer(344, 866, 78, 0)}"/><path d="${conifer(318, 850, 96, 0)}"/>
</g>
<!-- rocks -->
<g fill="#0b0d14">
  <path d="M640,958 C652,940 690,934 712,944 C726,950 734,962 730,972 L636,972 Z"/>
  <path d="M742,972 C748,962 768,958 782,964 C790,968 792,974 790,978 L740,978 Z"/>
  <path d="M1180,962 C1196,948 1224,946 1244,956 L1250,964 L1176,968 Z"/>
</g>
<g fill="#e9a26a" opacity="0.28">
  <path d="M662,946 C676,938 696,937 708,943 C694,941 678,942 662,946 Z"/>
  <path d="M1192,954 C1206,948 1222,948 1236,953 C1222,951 1206,951 1192,954 Z"/>
</g>

<!-- photographic finish -->
<rect width="${W}" height="${H}" fill="url(#vignette)"/>
<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.07" style="mix-blend-mode:overlay"/>
</svg>
`;
const out = path.join(__dirname, '..', 'stage', 'photo.svg');
fs.writeFileSync(out, svg);
console.log(out, svg.length, 'bytes');
