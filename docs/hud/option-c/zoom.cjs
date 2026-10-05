// Inspection helper: screenshot part of an element at a scale. Usage: node zoom.cjs <selector> <x> <y> <w> <h> <out.png> [scale]
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const [sel, x, y, w, h, out, scale] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1984, height: 1080 }, deviceScaleFactor: Number(scale || 2) });
  await p.goto('file://' + path.join(__dirname, 'option-c.html'));
  await p.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {}))); });
  const r = await p.evaluate((s) => { const e = document.querySelector(s).getBoundingClientRect(); return { x: e.left + scrollX, y: e.top + scrollY }; }, sel);
  await p.screenshot({ path: out, fullPage: true, clip: { x: r.x + Number(x), y: r.y + Number(y), width: Number(w), height: Number(h) } });
  console.log(out); await b.close();
})();
