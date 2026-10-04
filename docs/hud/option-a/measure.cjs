const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + process.argv[2]); await p.evaluate(() => document.fonts.ready);
  const r = await p.evaluate((sels) => sels.map(s => { const e = document.querySelector(s); if (!e) return s + ' none'; const r = e.getBoundingClientRect(); return s + ' ' + [r.left, r.top, r.right, r.bottom].map(v => v.toFixed(1)).join(','); }), process.argv.slice(3));
  console.log(r.join('\n')); await b.close();
})();
