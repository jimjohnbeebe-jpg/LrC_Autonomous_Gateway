// Layout checks for option-b.html: column fill, text running past the column, clipped text, font sizes below 11 px,
// overlap between the parts of every Changes row (labels, tracks, thumbs, before -> after, deltas, checkboxes),
// every colour used, and the title row: no child may be squeezed below its declared or natural width (revision 3: in
// revision 2, D's icons shrank to 12 px with flex-shrink). The page carries the worst-case rows (#r-worst, #r-two).
// Usage: node option-b/checks/check-b.cjs option-b/option-b.html
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('requestfailed', (r) => errs.push('failed ' + r.url()));
  await p.goto('file://' + path.resolve(process.argv[2]));
  await p.evaluate(() => document.fonts.ready);
  const out = await p.evaluate(() => {
    const res = { cols: [], overflow: [], small: [], rowOverlap: [], rowsChecked: 0, titleSqueezed: [], titlesChecked: 0, colors: {} };
    const hostOf = (el) => { const h = el.closest('.slot[id], [id^="lr-"]'); return h && h.id; };
    function textRect(el) { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); }
    // 1. how much of each rail column is used: the info panels scroll above the action panel (.rb-bot)
    document.querySelectorAll('.rb .rb-scroll').forEach((sc) => {
      let content = 0; Array.from(sc.children).forEach((c) => { if (!c.classList.contains('rb-sbar')) content += c.offsetHeight; });
      const rb = sc.closest('.rb'); const bot = rb.querySelector('.rb-bot');
      res.cols.push({ host: hostOf(rb), state: rb.dataset.state, infoH: sc.clientHeight, infoContent: content, infoSpare: sc.clientHeight - content, actionPanel: bot.offsetHeight });
    });
    // 1b. title row: icons exactly 18 px, every child at least its natural width, the row itself not overflowing
    document.querySelectorAll('.rb-title').forEach((t) => {
      res.titlesChecked++;
      const host = hostOf(t);
      if (t.scrollWidth > t.clientWidth + 0.5) res.titleSqueezed.push({ host, what: 'row overflows', sw: t.scrollWidth, cw: t.clientWidth });
      t.querySelectorAll('.rb-ico').forEach((ic) => { const w = ic.getBoundingClientRect().width; if (Math.abs(w - 18) > 0.5) res.titleSqueezed.push({ host, what: 'icon', w }); });
      t.querySelectorAll(':scope > *, .rb-icos > *').forEach((c) => { if (c.scrollWidth > c.clientWidth + 0.5 && c.clientWidth > 0) res.titleSqueezed.push({ host, what: c.className || c.tagName, sw: c.scrollWidth, cw: c.clientWidth }); });
    });
    // 2. text: size, clipping, running past the column (4 px margin)
    document.querySelectorAll('.rb, .rbp, .rbx').forEach((rb) => {
      const col = rb.querySelector('.rb-col') || rb;
      const cb = col.getBoundingClientRect();
      rb.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        if (Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) {
          const fs = parseFloat(cs.fontSize);
          if (fs < 11) res.small.push({ host: hostOf(rb), text: el.textContent.trim().slice(0, 40), fs });
          if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') res.overflow.push({ host: hostOf(rb), text: el.textContent.trim().slice(0, 50), sw: el.scrollWidth, cw: el.clientWidth });
          if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1) res.overflow.push({ host: hostOf(rb), clamped: el.textContent.trim().slice(0, 50) });
          const rr = textRect(el);
          if (rr.width && (rr.right > cb.right - 4 || rr.left < cb.left + 4)) res.overflow.push({ host: hostOf(rb), text: el.textContent.trim().slice(0, 50), left: Math.round(rr.left - cb.left), right: Math.round(rr.right - cb.left) });
          res.colors[cs.color] = (res.colors[cs.color] || 0) + 1;
        }
        if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') res.colors['bg ' + cs.backgroundColor] = (res.colors['bg ' + cs.backgroundColor] || 0) + 1;
      });
    });
    // 3. sibling overlap inside each Changes row: no two parts may touch (2 px minimum gap) where they share height.
    //    The change segment and the before mark sit on the track by design and are left out; the thumb is tested
    //    against the text parts only.
    document.querySelectorAll('.rb-row').forEach((row) => {
      res.rowsChecked++;
      const parts = [];
      row.querySelectorAll(':scope > .lab, :scope > .av, :scope > .d, :scope > .val, :scope > .was, :scope > .st').forEach((el) => parts.push({ k: el.className, r: textRect(el), text: true }));
      row.querySelectorAll(':scope > .trk, :scope > .box').forEach((el) => parts.push({ k: el.className, r: el.getBoundingClientRect(), text: false }));
      row.querySelectorAll(':scope > .th').forEach((el) => parts.push({ k: 'th', r: el.getBoundingClientRect(), text: false, thumb: true }));
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], c = parts[j];
        if ((a.thumb && !c.text) || (c.thumb && !a.text)) continue;
        const vy = Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top);
        const gap = Math.max(a.r.left, c.r.left) - Math.min(a.r.right, c.r.right);
        if (vy > 0 && gap < 2) res.rowOverlap.push({ host: hostOf(row), row: row.textContent.trim().slice(0, 40), a: a.k, b: c.k, gap: Math.round(gap * 10) / 10 });
      }
    });
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  if (errs.length) console.log('ERRORS', errs);
  await b.close();
})();
