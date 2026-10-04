// Measures text widths in the rail's type (Inter 12/400, tnum on or off) on the live page; prints JSON.
// Usage: node option-b/checks/measure.cjs '<json array of [text, tnum(0|1), weight, size]>'
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
(async () => {
  const items = JSON.parse(process.argv[2]);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + path.resolve(__dirname, '..', 'option-b.html'));
  await p.evaluate(() => document.fonts.ready);
  const out = await p.evaluate((items) => items.map(([t, tn, w, s]) => {
    const host = document.querySelector('.rb');
    const e = document.createElement('span');
    e.style.cssText = 'position:absolute;white-space:nowrap;font-size:' + (s || 12) + 'px;font-weight:' + (w || 400) + ';font-feature-settings:"tnum" ' + (tn ? 1 : 0);
    e.textContent = t; host.appendChild(e);
    const r = Math.round(e.getBoundingClientRect().width * 10) / 10; e.remove(); return [t, r];
  }), items);
  console.log(JSON.stringify(out));
  await b.close();
})();
