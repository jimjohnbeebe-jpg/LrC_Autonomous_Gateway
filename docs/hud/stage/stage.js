/* Lightroom Classic Develop-module stage for HUD mockups.
   window.renderLightroom(root, opts) fills `root` with a static 1920 x 1080 Develop module and sets window.LR_REGIONS.
   opts: { scene: 'converge' | 'variants' (default 'converge'), selected: 'master' | 'A' | 'B' | 'C' (default 'master') }
   Static mockup only: nothing is interactive. All data is the shared scene data (placeholder photo _DSC0412.NEF). */
(function () {
  'use strict';

  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
  var PHOTO = SCRIPT_SRC ? new URL('photo.svg', SCRIPT_SRC).href : 'photo.svg';

  // ---- fixed geometry (CSS px, root-relative) ----
  var LOUPE = { x: 300, y: 112, w: 1320, h: 788 };
  var MARGIN = 40;
  var PH = LOUPE.h - 2 * MARGIN;
  var PW = Math.round(PH * 1.5);
  var PHOTO_RECT = { x: LOUPE.x + Math.round((LOUPE.w - PW) / 2), y: LOUPE.y + MARGIN, w: PW, h: PH };
  var FIXED = {
    root: { x: 0, y: 0, w: 1920, h: 1080 },
    titlebar: { x: 0, y: 0, w: 1920, h: 32 },
    menubar: { x: 0, y: 32, w: 1920, h: 20 },
    topband: { x: 0, y: 52, w: 1920, h: 60 },
    leftPanel: { x: 0, y: 112, w: 300, h: 824 },
    rightPanel: { x: 1620, y: 112, w: 300, h: 824 },
    loupe: LOUPE,
    photo: PHOTO_RECT,
    toolbar: { x: 300, y: 900, w: 1320, h: 36 },
    filmstrip: { x: 0, y: 936, w: 1920, h: 144 },
    filmstripHeader: { x: 0, y: 936, w: 1920, h: 22 },
    filmstripThumbs: { x: 0, y: 958, w: 1920, h: 122 }
  };

  // ---- scene data ----
  var SESSION = '4f2a1c';
  var SNAPSHOT = 'AVG pre-session 2026-10-04T18:42:07.311Z';
  var IMPORT_STEP = 'Import (10/4/2026 6:40:12 PM)';
  var COPY_LOOK = { A: 'natural', B: 'dramatic', C: 'soft' };
  var BASIC_ORDER = ['Temp', 'Tint', '|Tone', 'Exposure', 'Contrast', '-', 'Highlights', 'Shadows', 'Whites', 'Blacks', '|Presence', 'Texture', 'Clarity', 'Dehaze', '-', 'Vibrance', 'Saturation'];
  // after pass 1 (shared scene data)
  var BASIC_CONVERGE = { Profile: 'Adobe Landscape', Temp: 5500, Tint: 6, Exposure: 0.33, Contrast: 0, Highlights: -41, Shadows: 20, Whites: 0, Blacks: 0, Texture: 4, Clarity: 6, Dehaze: 0, Vibrance: 16, Saturation: 0 };
  // variants: master/A = baseline before the look priors; B, C = baseline + their pass-0 changes (shared scene data)
  var BASIC_BASE = { Profile: 'Adobe Landscape', Temp: 5500, Tint: 6, Exposure: 0.33, Contrast: 0, Highlights: -21, Shadows: 10, Whites: 0, Blacks: 0, Texture: 4, Clarity: 2, Dehaze: 0, Vibrance: 0, Saturation: 0 };
  var COPY_CHANGES = {
    A: [],
    B: [['Contrast', 20], ['Dehaze', 10], ['Blacks', -15], ['Clarity', 12]],
    C: [['Highlights', -56], ['Shadows', 35], ['Contrast', -10], ['Clarity', -8]]
  };
  // One History step per pass, "AVG <short> pass n/N", plus suffixed guardrail steps ("baseline k", "guard k",
  // "clip revert", "region revert") [handle: gateway engine/src/session/io.ts:148-151, guardrail.ts:48,177;
  // real names in docs/reports/phase5/P5/p5_sessions_2026-10-01T11-32-13-141Z/20261001-3133cd.json passes[].history_names].
  var HISTORY_CONVERGE = ['AVG 4f2a1c pass 1/6', 'AVG 4f2a1c pass 0/6 baseline 1', 'AVG 4f2a1c pass 0/6', IMPORT_STEP];

  // Other photos of the same import: crops / grades of the placeholder photo. p = portrait crop.
  var OTHERS = [
    { s: 1.0, ox: 0.5, oy: 0.5, f: 'hue-rotate(-14deg) saturate(.75) brightness(.72)' },
    { p: true, s: 1.0, ox: 0.04, oy: 0.5, f: 'brightness(.92)' },
    { s: 1.7, ox: 0.68, oy: 0.5, f: 'saturate(1.1) brightness(1.04)' },
    { s: 1.15, ox: 0.4, oy: 0.4, f: 'hue-rotate(8deg) brightness(1.02)' },
    // index 4 = the edit's photo (inserted at render)
    { s: 2.3, ox: 0.25, oy: 0.18, f: 'brightness(1.05) saturate(1.1)' },
    { s: 1.5, ox: 0.97, oy: 0.85, f: 'hue-rotate(-22deg) brightness(.84)' },
    { p: true, s: 1.0, ox: 0.72, oy: 0.5, f: 'saturate(1.2) contrast(1.05)' },
    { s: 1.9, ox: 0.45, oy: 0.98, f: 'brightness(.9)' },
    { s: 1.0, ox: 0.5, oy: 0.5, f: 'grayscale(1) contrast(1.15)' },
    { s: 1.35, ox: 0.3, oy: 0.55, f: 'hue-rotate(14deg) saturate(1.25)' },
    { s: 1.0, ox: 0.5, oy: 0.5, f: 'brightness(1.18) saturate(.7) hue-rotate(-28deg)' }
  ];

  // ---- helpers ----
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmt(name, v) {
    if (typeof v === 'string') return v;
    if (name === 'Temp') return v.toLocaleString('en-US');
    if (name === 'Exposure') return (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v).toFixed(2);
    if (v === 0) return '0';
    return (v > 0 ? '+' : '-') + Math.abs(v);
  }
  function pos(name, v) {
    if (name === 'Temp') return 0.42; // as shot 5500 K on Lightroom's non-linear temperature scale [mockup]
    if (name === 'Tint') return (v + 150) / 300;
    if (name === 'Exposure') return (v + 5) / 10;
    return (v + 100) / 200;
  }
  function tri(dir, style) { return '<div class="lr-tri ' + dir + '" style="' + (style || '') + '"></div>'; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rect(r) { return 'left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px;'; }

  // ---- small glyphs (inline SVG) ----
  var G = {
    min: '<svg width="10" height="10"><path d="M0 5.5h10" stroke="#1a1a1a" stroke-width="1"/></svg>',
    restore: '<svg width="10" height="10"><path d="M0.5 2.5h7v7h-7z" fill="none" stroke="#1a1a1a"/><path d="M2.5 2.5v-2h7v7h-2" fill="none" stroke="#1a1a1a"/></svg>',
    close: '<svg width="10" height="10"><path d="M0 0L10 10M10 0L0 10" stroke="#1a1a1a" stroke-width="1"/></svg>',
    sw: '<svg width="14" height="9"><rect x="0.5" y="0.5" width="13" height="8" rx="4" fill="none" stroke="#7a7a7a"/><circle cx="9.5" cy="4.5" r="2.4" fill="#9a9a9a"/></svg>',
    crop: '<svg width="18" height="18" fill="none" stroke="#a6a6a6" stroke-width="1.4"><path d="M5 1.5v11.5h11.5M1.5 5h11.5v11.5"/></svg>',
    heal: '<svg width="18" height="18" fill="none" stroke="#a6a6a6" stroke-width="1.4"><circle cx="9" cy="9" r="6.5"/><circle cx="9" cy="9" r="2.2" fill="#a6a6a6" stroke="none"/><path d="M13.6 4.4l3-3"/></svg>',
    redeye: '<svg width="20" height="18" fill="none" stroke="#a6a6a6" stroke-width="1.4"><path d="M1.5 9C5 3.5 15 3.5 18.5 9C15 14.5 5 14.5 1.5 9Z"/><circle cx="10" cy="9" r="2.6" fill="#a6a6a6" stroke="none"/></svg>',
    mask: '<svg width="18" height="18" fill="none" stroke="#a6a6a6" stroke-width="1.4"><rect x="1.5" y="1.5" width="15" height="15" rx="3" stroke-dasharray="2.2 1.8"/><circle cx="9" cy="9" r="4" fill="#a6a6a6" stroke="none"/></svg>',
    loupeView: '<svg width="20" height="14"><rect x="0.5" y="0.5" width="19" height="13" fill="#5a5a5a" stroke="#b0b0b0"/><rect x="5" y="3.5" width="10" height="7" fill="#b0b0b0"/></svg>',
    beforeAfter: '<svg width="22" height="14"><rect x="0.5" y="0.5" width="21" height="13" fill="none" stroke="#929292"/><path d="M11 0.5v13" stroke="#929292"/><path d="M3 4l2.5 3 2.5-3M5.5 7v4M14 4l2.5 3 2.5-3M16.5 7v4" fill="none" stroke="#929292"/></svg>',
    dd: '<svg width="7" height="5"><path d="M0 0h7L3.5 4.5z" fill="#929292"/></svg>',
    mon1: '<svg width="16" height="12"><rect x="0.5" y="0.5" width="15" height="11" fill="none" stroke="#9a9a9a"/><text x="8" y="9.2" font-size="8.5" font-family="Inter, sans-serif" font-weight="600" text-anchor="middle" fill="#9a9a9a">1</text></svg>',
    mon2: '<svg width="16" height="12"><rect x="0.5" y="0.5" width="15" height="11" fill="none" stroke="#6a6a6a"/><text x="8" y="9.2" font-size="8.5" font-family="Inter, sans-serif" font-weight="600" text-anchor="middle" fill="#6a6a6a">2</text></svg>',
    grid: '<svg width="12" height="12" fill="#8a8a8a"><rect x="0" y="0" width="5" height="5"/><rect x="7" y="0" width="5" height="5"/><rect x="0" y="7" width="5" height="5"/><rect x="7" y="7" width="5" height="5"/></svg>',
    prev: '<svg width="8" height="10"><path d="M7 0v10L0 5z" fill="#8a8a8a"/></svg>',
    next: '<svg width="8" height="10"><path d="M1 0v10l7-5z" fill="#8a8a8a"/></svg>',
    profileGrid: '<svg width="12" height="12" fill="#9a9a9a"><rect x="0" y="0" width="5" height="5"/><rect x="7" y="0" width="5" height="5"/><rect x="0" y="7" width="5" height="5"/><rect x="7" y="7" width="5" height="5"/></svg>',
    updown: '<svg width="7" height="11" fill="#9a9a9a"><path d="M0 4.5h7L3.5 0zM0 6.5h7L3.5 11z"/></svg>',
    dropper: '<svg width="16" height="16" fill="none" stroke="#a6a6a6" stroke-width="1.3"><path d="M2.5 13.5l7-7M8 5l3 3M10.5 2.5l3 3-2 2-3-3z"/><path d="M2 14l1.6-0.4" stroke-width="2"/></svg>',
    filterLock: '<svg width="12" height="10"><rect x="0.5" y="0.5" width="11" height="9" rx="4.5" fill="none" stroke="#7a7a7a"/><circle cx="7.5" cy="5" r="2.3" fill="#8a8a8a"/></svg>'
  };

  function histogramSVG(w, h) {
    var N = 160, rnd = mulberry32(7);
    function g(x, m, s, a) { return a * Math.exp(-0.5 * Math.pow((x - m) / s, 2)); }
    var shapes = {
      r: function (x) { return g(x, 0.06, 0.035, 0.75) + g(x, 0.2, 0.07, 0.45) + g(x, 0.36, 0.07, 0.5) + g(x, 0.53, 0.08, 0.42) + g(x, 0.73, 0.06, 0.4) + g(x, 0.9, 0.035, 0.24); },
      g: function (x) { return g(x, 0.055, 0.035, 0.82) + g(x, 0.19, 0.07, 0.5) + g(x, 0.33, 0.07, 0.55) + g(x, 0.49, 0.08, 0.42) + g(x, 0.66, 0.06, 0.28) + g(x, 0.84, 0.04, 0.13); },
      b: function (x) { return g(x, 0.07, 0.035, 0.8) + g(x, 0.23, 0.07, 0.55) + g(x, 0.4, 0.08, 0.66) + g(x, 0.55, 0.07, 0.38) + g(x, 0.66, 0.05, 0.16) + g(x, 0.78, 0.04, 0.05); }
    };
    var noise = []; for (var i = 0; i <= N; i++) noise.push(0.86 + 0.28 * rnd());
    var sm = []; for (i = 0; i <= N; i++) sm.push((noise[Math.max(0, i - 1)] + noise[i] + noise[Math.min(N, i + 1)]) / 3);
    var maxV = 0, vals = {};
    Object.keys(shapes).forEach(function (k) {
      vals[k] = [];
      for (var i = 0; i <= N; i++) { var v = shapes[k](i / N) * sm[i]; vals[k].push(v); if (v > maxV) maxV = v; }
    });
    function path(k) {
      var d = 'M0 ' + h;
      vals[k].forEach(function (v, i) { d += ' L' + (i / N * w).toFixed(1) + ' ' + (h - 1 - v / maxV * (h - 8)).toFixed(1); });
      return d + ' L' + w + ' ' + h + ' Z';
    }
    var grid = '';
    for (i = 1; i < 5; i++) grid += '<path d="M' + (w * i / 5).toFixed(1) + ' 0V' + h + '" stroke="#353535" stroke-width="1"/>';
    return '<svg width="' + w + '" height="' + h + '" style="position:absolute;left:0;top:0">' + grid +
      '<g style="isolation:isolate">' +
      '<path d="' + path('b') + '" fill="#26348c" style="mix-blend-mode:screen"/>' +
      '<path d="' + path('g') + '" fill="#277a2b" style="mix-blend-mode:screen"/>' +
      '<path d="' + path('r') + '" fill="#7c2727" style="mix-blend-mode:screen"/>' +
      '</g>' +
      '<path d="M3 3h9L3 12z" fill="none" stroke="#6a6a6a"/><path d="M' + (w - 3) + ' 3h-9l9 9z" fill="none" stroke="#6a6a6a"/>' +
      '</svg>';
  }

  // thumbnail image inside a cell: landscape 100 x 67 or portrait 45 x 67
  function thumb(spec, extraClass, curl) {
    var cw = spec.p ? 45 : 100, ch = 67;
    var iw, ih;
    if (spec.p) { ih = ch * spec.s; iw = ih * 1.5; } else { iw = cw * spec.s; ih = iw / 1.5; }
    var left = -(iw - cw) * spec.ox, top = -(ih - ch) * spec.oy;
    var curlSvg = curl ? '<svg class="lr-curl" viewBox="0 0 13 13"><path d="M0 0L13 13H0Z" fill="var(--lr-cellbg)"/>' +
      '<path d="M0 0H13V13Z" fill="url(#lrCurlG)"/><path d="M0 0L13 13" stroke="rgba(0,0,0,.45)" stroke-width=".8"/></svg>' : '';
    return '<div class="lr-thumb-img" style="width:' + cw + 'px;height:' + ch + 'px">' +
      '<img src="' + PHOTO + '" alt="" class="' + (extraClass || '') + '" style="width:' + iw.toFixed(1) + 'px;height:' + ih.toFixed(1) + 'px;left:' + left.toFixed(1) + 'px;top:' + top.toFixed(1) + 'px;' + (spec.f ? 'filter:' + spec.f : '') + '">' +
      curlSvg + '</div>';
  }

  function relRect(el, root) {
    var x = 0, y = 0, e = el;
    while (e && e !== root) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }

  function renderLightroom(root, opts) {
    opts = opts || {};
    var scene = opts.scene === 'variants' ? 'variants' : 'converge';
    var selected = (scene === 'variants' && /^[ABC]$/.test(opts.selected)) ? opts.selected : 'master';
    var look = selected === 'master' ? 'natural' : COPY_LOOK[selected];

    // Basic values + history for what is selected
    var basic, history;
    if (scene === 'converge') { basic = BASIC_CONVERGE; history = HISTORY_CONVERGE; }
    else {
      basic = Object.assign({}, BASIC_BASE);
      // Variants: the master is not edited (gateway engine/src/session/variants.ts:4); each copy gets "AVG <short> <letter> pass 0/N"
      // (io.ts:148-151), B also its baseline correction (as in 20261001-d4247b.json passes[1].history_names).
      history = [IMPORT_STEP];
      if (selected !== 'master') {
        COPY_CHANGES[selected].forEach(function (c) { basic[c[0]] = c[1]; });
        history = (selected === 'B' ? ['AVG ' + SESSION + ' B pass 0/6 baseline 1'] : []).concat(['AVG ' + SESSION + ' ' + selected + ' pass 0/6'], history);
      }
    }

    root.classList.add('lr-root');
    root.setAttribute('data-scene', scene);
    root.setAttribute('data-selected', selected);

    var h = [];
    // gradient for the page-curl badge
    h.push('<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="lrCurlG" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#f4f4f4"/><stop offset="1" stop-color="#a9a9a9"/></linearGradient></defs></svg>');

    // title bar + menu bar
    h.push('<div class="lr-abs lr-titlebar" data-region="titlebar"><div class="lr-appicon">LrC</div>' +
      '<div class="lr-title">Lightroom Catalog.lrcat - Adobe Photoshop Lightroom Classic - Develop</div>' +
      '<div class="lr-caption" style="left:1782px">' + G.min + '</div>' +
      '<div class="lr-caption" style="left:1828px">' + G.restore + '</div>' +
      '<div class="lr-caption" style="left:1874px">' + G.close + '</div></div>');
    h.push('<div class="lr-abs lr-menubar" data-region="menubar">' +
      ['File', 'Edit', 'Develop', 'Photo', 'Settings', 'Tools', 'View', 'Window', 'Help'].map(function (m) { return '<span>' + m + '</span>'; }).join('') + '</div>');

    // top band
    var mods = ['Library', 'Develop', 'Map', 'Book', 'Slideshow', 'Print', 'Web'];
    h.push('<div class="lr-abs lr-topband" data-region="topband">' +
      '<div class="lr-idbadge">LrC</div><div class="lr-idtext">Adobe Lightroom Classic</div>' +
      '<div class="lr-modules" style="right:' + (1920 - 1896) + 'px">' +
      mods.map(function (m, i) { return (i ? '<i></i>' : '') + '<span class="' + (m === 'Develop' ? 'on' : '') + '">' + m + '</span>'; }).join('') +
      '</div>' + tri('up', 'left:956px;top:3px') + '</div>');

    // left panel
    var L = [];
    L.push('<div class="lr-ph">' + tri('down') + 'Navigator<div class="lr-ph-right"><b>FIT</b><span>100%</span><span>200%</span></div></div>');
    L.push('<div class="lr-pb lr-nav" data-region="navigator"><div class="lr-navimg"><img src="' + PHOTO + '" alt="" class="look-' + look + '"></div></div>');
    L.push('<div class="lr-ph">' + tri('right') + 'Presets<div class="lr-ph-right"><span class="lr-plus">+</span></div></div>');
    L.push('<div class="lr-ph">' + tri('down') + 'Snapshots<div class="lr-ph-right"><span class="lr-plus">+</span></div></div>');
    L.push('<div class="lr-pb lr-rows" data-region="snapshots"><div class="lr-row">' + esc(SNAPSHOT) + '</div></div>');
    L.push('<div class="lr-ph">' + tri('down') + 'History<div class="lr-ph-right"><span class="lr-plus" style="font-size:13px">&times;</span></div></div>');
    L.push('<div class="lr-pb lr-rows" data-region="history">' + history.map(function (s, i) { return '<div class="lr-row' + (i === 0 ? ' sel' : '') + '">' + esc(s) + '</div>'; }).join('') + '</div>');
    L.push('<div class="lr-ph">' + tri('right') + 'Collections<div class="lr-ph-right"><span class="lr-plus">+</span></div></div>');
    h.push('<div class="lr-abs lr-side lr-left" data-region="leftPanel"><div class="lr-edge">' + tri('left', 'left:2px;top:408px') + '</div>' +
      '<div class="lr-col">' + L.join('') + '</div>' +
      '<div class="lr-btnbar"><div class="lr-btn" style="left:20px;width:124px">Copy...</div><div class="lr-btn" style="left:156px;width:124px">Paste</div></div></div>');

    // right panel
    var R = [];
    R.push('<div class="lr-ph">Histogram' + tri('down') + '</div>');
    R.push('<div class="lr-pb lr-hist" data-region="histogram"><div class="lr-histbox">' + histogramSVG(268, 86) +
      '<div class="lr-histinfo"><span>ISO 100</span><span>18 mm</span><span>f/8</span><span>1/250 sec</span></div></div>' +
      '<div class="lr-histfoot"><div class="lr-chk"></div>Original Photo</div></div>');
    R.push('<div class="lr-tools">' + G.crop + G.heal + G.redeye + G.mask + '</div>');
    R.push('<div class="lr-ph">Basic' + tri('down') + '</div>');
    var B = [];
    B.push('<div class="lr-brow"><div class="lab">Treatment :</div><div class="ctl"><span class="on">Color</span><span class="off">Black &amp; White</span></div></div>');
    B.push('<div class="lr-brow"><div class="lab">Profile :</div><div class="ctl" style="justify-content:space-between"><span style="display:flex;align-items:center;gap:7px"><span class="on">' + esc(basic.Profile) + '</span>' + G.updown + '</span>' + G.profileGrid + '</div></div>');
    B.push('<div class="lr-brow"><div class="lab" style="display:flex;align-items:center;justify-content:space-between;padding-left:12px">' + G.dropper + '<span>WB :</span></div><div class="ctl"><span style="display:flex;align-items:center;gap:7px"><span class="on">As Shot</span>' + G.updown + '</span></div></div>');
    BASIC_ORDER.forEach(function (k) {
      if (k === '-') { B.push('<div style="height:2px"></div>'); return; }
      if (k.charAt(0) === '|') {
        var label = k.slice(1);
        B.push('<div class="lr-brow sub"><span>' + label + '</span>' + (label === 'Tone' ? '<span class="auto">Auto</span>' : '') + '</div>');
        return;
      }
      var v = basic[k];
      var cls = k === 'Temp' ? ' temp' : k === 'Tint' ? ' tint' : '';
      var p = Math.max(0, Math.min(1, pos(k, v)));
      B.push('<div class="lr-brow" data-slider="' + k + '" style="height:20px"><div class="lab">' + k + '</div>' +
        '<div class="lr-slider"><div class="lr-track' + cls + '"></div><div class="lr-thumb" style="left:' + (p * 150).toFixed(1) + 'px"></div></div>' +
        '<div class="val">' + fmt(k, v) + '</div></div>');
    });
    R.push('<div class="lr-pb lr-basic" data-region="basicPanel">' + B.join('') + '</div>');
    ['Tone Curve', 'HSL / Color', 'Color Grading', 'Detail', 'Lens Corrections', 'Transform', 'Effects', 'Calibration'].forEach(function (n) {
      R.push('<div class="lr-ph"><span class="lr-sw">' + G.sw + '</span>' + n + tri('left') + '</div>');
    });
    h.push('<div class="lr-abs lr-side lr-right" data-region="rightPanel"><div class="lr-edge">' + tri('right', 'left:4px;top:408px') + '</div>' +
      '<div class="lr-col">' + R.join('') + '</div>' +
      '<div class="lr-btnbar"><div class="lr-btn" style="left:20px;width:124px">Previous</div><div class="lr-btn" style="left:156px;width:124px">Reset</div></div></div>');

    // loupe + toolbar
    h.push('<div class="lr-abs lr-loupe" data-region="loupe"><img class="lr-photo look-' + look + '" data-region="photo" src="' + PHOTO + '" alt="" style="' +
      rect({ x: PHOTO_RECT.x - LOUPE.x, y: PHOTO_RECT.y - LOUPE.y, w: PHOTO_RECT.w, h: PHOTO_RECT.h }) + '"></div>');
    h.push('<div class="lr-abs lr-toolbar" data-region="toolbar">' +
      '<div class="grp" style="left:14px">' + G.loupeView + '<span style="display:flex;align-items:center;gap:4px">' + G.beforeAfter + G.dd + '</span></div>' +
      '<div class="grp" style="right:14px"><span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border:1px solid #8a8a8a;border-radius:1px;display:inline-block"></span>Soft Proofing</span>' + G.dd + '</div></div>');

    // filmstrip
    var cells = [];
    var nPhotos = OTHERS.length + 1 + (scene === 'variants' ? 3 : 0);
    function cell(id, inner, isSel) {
      return '<div class="lr-cell' + (isSel ? ' sel' : '') + '" data-cell="' + id + '" style="--lr-cellbg:' + (isSel ? '#bdbdbd' : '#6b6b6b') + '">' + inner + '</div>';
    }
    OTHERS.forEach(function (spec, i) {
      if (i === 4) {
        cells.push(cell('master', thumb({ s: 1, ox: 0.5, oy: 0.5 }, 'look-natural', false), selected === 'master'));
        if (scene === 'variants') {
          ['A', 'B', 'C'].forEach(function (c) { cells.push(cell(c, thumb({ s: 1, ox: 0.5, oy: 0.5 }, 'look-' + COPY_LOOK[c], true), selected === c)); });
        }
      }
      cells.push(cell('other' + i, thumb(spec, '', false), false));
    });
    var fileLabel = '_DSC0412.NEF' + (selected !== 'master' ? ' / AVG landscape_golden_hour ' + selected : '');
    h.push('<div class="lr-abs lr-film" data-region="filmstrip">' +
      '<div class="lr-filmhead">' +
      '<span style="display:flex;align-items:center;gap:5px;margin-left:10px">' + G.mon1 + G.mon2 + '</span>' +
      '<span style="display:flex;align-items:center;gap:12px;margin-left:16px">' + G.grid + G.prev + G.next + '</span>' +
      '<span class="src" style="margin-left:16px">Previous Import&nbsp;&nbsp;&nbsp;' + nPhotos + ' photos / 1 selected / <b>' + esc(fileLabel) + '</b></span>' +
      '<span style="margin-left:5px;display:flex">' + G.dd + '</span>' +
      '<span style="position:absolute;right:14px;display:flex;align-items:center;gap:8px">Filter :<span style="color:#b4b4b4">Filters Off</span>' + G.dd + G.filterLock + '</span>' +
      '</div>' +
      '<div class="lr-cells" data-region="cells">' + cells.join('') + '</div>' +
      tri('left', 'left:3px;top:79px') + tri('right', 'right:3px;top:79px') + tri('down', 'left:956px;bottom:2px') +
      '</div>');

    root.innerHTML = h.join('');

    // regions
    var regions = JSON.parse(JSON.stringify(FIXED));
    ['navigator', 'snapshots', 'history', 'histogram', 'basicPanel'].forEach(function (k) {
      var el = root.querySelector('[data-region="' + k + '"]');
      if (el) regions[k] = relRect(el, root);
    });
    regions.cells = {};
    Array.prototype.forEach.call(root.querySelectorAll('[data-cell]'), function (el) {
      var id = el.getAttribute('data-cell');
      if (!/^other/.test(id)) regions.cells[id] = relRect(el, root);
    });
    Object.keys(regions).forEach(function (k) {
      var r = regions[k];
      if (r && typeof r.x === 'number') ['x', 'y', 'w', 'h'].forEach(function (p) { root.style.setProperty('--lr-' + k + '-' + p, r[p] + 'px'); });
    });
    window.LR_REGIONS = regions;
    return regions;
  }

  window.renderLightroom = renderLightroom;
})();
