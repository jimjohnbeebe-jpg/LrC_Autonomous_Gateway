// Crop a region of a PNG (source pixels) to a new PNG, optionally magnified: node zoom.cjs <in.png> <out.png> x y w h [mag]
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path'), fs = require('fs'), os = require('os');
(async () => {
  const [inp, out, x, y, w, h, mag = '1'] = process.argv.slice(2);
  const m = parseFloat(mag), W = +w, H = +h;
  const html = path.join(path.dirname(path.resolve(out)), '.zoom.html');
  fs.writeFileSync(html, `<body style="margin:0;overflow:hidden"><img id="i" src="${path.relative(path.dirname(html), path.resolve(inp))}" style="position:absolute;left:${-x * m}px;top:${-y * m}px;image-rendering:pixelated"></body>`);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: Math.round(W * m), height: Math.round(H * m) } });
  await p.goto('file://' + html);
  await p.evaluate((m) => { const i = document.getElementById('i'); i.style.width = (i.naturalWidth * m) + 'px'; }, m);
  await p.screenshot({ path: path.resolve(out) }); await b.close(); fs.unlinkSync(html); console.log(out);
})();
