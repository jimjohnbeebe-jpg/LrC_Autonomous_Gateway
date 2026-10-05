// Audit every .deck in option-c.html with headless Chromium: geometry (root-relative), text that
// overflows its column or the deck, overlapping text boxes, the smallest font size, colours outside
// the Instrument token set (text, fill, border and focus-outline colours), and the number of primary buttons per deck.
// Usage: node audit.cjs [htmlPath]
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const TOKENS = {
  '#202122': 'bg', '#2a2b2d': 'raised', '#161718': 'inset', '#3a3b3e': 'line', '#e4e6e8': 'text', '#aeb2b6': 'text2',
  '#8d9196': 'text3', '#eda447': 'accent', '#1d1305': 'on-accent', '#86c296': 'ok', '#ee8064': 'danger', '#9fb7d4': 'working',
};

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, 'option-c.html'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1984, height: 1080 } });
  await page.goto('file://' + file, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const res = await page.evaluate((TOKENS) => {
    const hex = (c) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
      if (!m) return c;
      if (m[4] !== undefined && Number(m[4]) === 0) return null;
      return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
    };
    const out = [];
    document.querySelectorAll('.deck').forEach((deck) => {
      const root = deck.closest('.lr-root');
      const holder = root.parentElement.closest('[id]') || root;
      const rr = root.getBoundingClientRect();
      const dr = deck.getBoundingClientRect();
      const rel = (r) => [Math.round(r.left - rr.left), Math.round(r.top - rr.top), Math.round(r.width), Math.round(r.height)];
      const rep = { frame: holder.id + '/' + root.id, deck: rel(dr), problems: [], ellipsis: [], minFont: 99, colors: {}, primaries: 0 };
      const leaves = [];
      deck.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (el instanceof SVGElement) {
          ['fill', 'stroke'].forEach((a) => { const v = el.getAttribute(a); if (v && v !== 'none' && !v.startsWith('url')) rep.colors[v.toLowerCase()] = (rep.colors[v.toLowerCase()] || 0) + 1; });
          return;
        }
        if (el.tagName === 'IMG') return;
        const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
        [['color', own], ['background-color', true], ['border-top-color', parseFloat(cs.borderTopWidth) > 0], ['border-left-color', parseFloat(cs.borderLeftWidth) > 0], ['outline-color', cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0]]
          .forEach(([p, use]) => { if (!use) return; const h = hex(cs.getPropertyValue(p)); if (h) rep.colors[h] = (rep.colors[h] || 0) + 1; });
        if (el.classList.contains('primary')) rep.primaries++;
        if (own) {
          rep.minFont = Math.min(rep.minFont, parseFloat(cs.fontSize));
          // text box (range) so padding does not count
          const range = document.createRange(); range.selectNodeContents(el);
          let tr = range.getBoundingClientRect();
          // text cut by its own box (overflow hidden + ellipsis, by design) counts only where it is drawn
          if (cs.overflow === 'hidden') { const er = el.getBoundingClientRect(); tr = new DOMRect(tr.left, tr.top, Math.min(tr.right, er.right) - tr.left, tr.height); }
          leaves.push({ el, tr, txt: el.textContent.trim().slice(0, 40) });
          const col = el.closest('.col') || deck;
          const cr = col.getBoundingClientRect();
          if (tr.left < cr.left - 0.5 || tr.right > cr.right + 0.5 || tr.top < cr.top - 0.5 || tr.bottom > cr.bottom + 0.5)
            rep.problems.push('outside column: "' + el.textContent.trim().slice(0, 40) + '" ' + JSON.stringify(rel(tr)) + ' col ' + JSON.stringify(rel(cr)));
          if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') rep[cs.textOverflow === 'ellipsis' ? 'ellipsis' : 'problems'].push((cs.textOverflow === 'ellipsis' ? 'ellipsis (by design): "' : 'clipped: "') + el.textContent.trim().slice(0, 40) + '"');
        }
        if (el.classList.contains('card') || el.classList.contains('btn')) rep[el.className + ' ' + (el.textContent.trim().slice(0, 18))] = rel(r);
      });
      for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i], b = leaves[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ix = Math.min(a.tr.right, b.tr.right) - Math.max(a.tr.left, b.tr.left);
        const iy = Math.min(a.tr.bottom, b.tr.bottom) - Math.max(a.tr.top, b.tr.top);
        if (ix > 0.5 && iy > 0.5) rep.problems.push('overlap: "' + a.txt + '" x "' + b.txt + '"');
      }
      rep.offToken = Object.keys(rep.colors).filter((c) => !TOKENS[c]);
      out.push(rep);
    });
    return out;
  }, TOKENS);
  for (const r of res) {
    console.log(`\n${r.frame}  deck ${r.deck.join(',')}  minFont ${r.minFont}px  primaries ${r.primaries}  off-token ${JSON.stringify(r.offToken)}`);
    for (const [k, v] of Object.entries(r)) if (/^(card|btn)/.test(k)) console.log('   ', k.padEnd(48), v.join(','));
    for (const p of r.ellipsis) console.log('   note', p);
    for (const p of r.problems) console.log('   PROBLEM', p);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
