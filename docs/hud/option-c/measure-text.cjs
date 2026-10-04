// Measure text widths in Inter (the HUD font) with headless Chromium. Usage: [TNUM=0] node measure-text.cjs '[["text","600 15px"],...]' (TNUM=0 sets tabular figures off)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path'); const fs = require('fs');
(async () => {
  const tmp = path.join(__dirname, '.measure.html');
  fs.writeFileSync(tmp, `<!doctype html><style>@font-face{font-family:Inter;src:url(../fonts/inter.woff2);font-weight:100 900}</style><body style="font-family:Inter;font-feature-settings:'tnum' 1"></body>`);
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + tmp);
  const items = JSON.parse(process.argv[2]);
  const r = await p.evaluate(async (arg) => { const items = arg.items; await document.fonts.load('600 15px Inter'); await document.fonts.ready;
    return items.map(([t, f]) => { const s = document.createElement('span'); s.style.font = f + ' Inter'; s.style.fontFeatureSettings = (arg.tnum ? "'tnum' 1" : "'tnum' 0"); s.style.whiteSpace='pre'; s.textContent = t; document.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return [t, f, Math.round(w*10)/10]; }); }, { items, tnum: process.env.TNUM !== '0' });
  for (const x of r) console.log(String(x[2]).padStart(7), x[1], JSON.stringify(x[0]));
  await b.close(); fs.unlinkSync(tmp);
})();
