const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const data = fs.readFileSync(process.argv[2]).toString('base64');
  const pts = JSON.parse(process.argv[3]);
  const out = await p.evaluate(async ({ data, pts }) => {
    const img = new Image(); img.src = 'data:image/webp;base64,' + data; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const hex = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''); };
    return { size: [img.width, img.height], pts: pts.map(([n, x, y]) => [n, x, y, hex(x, y)]) };
  }, { data, pts });
  console.log(JSON.stringify(out, null, 0));
  await b.close();
})();
