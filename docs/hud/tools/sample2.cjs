const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const data = fs.readFileSync(process.argv[2]).toString('base64');
  const boxes = JSON.parse(process.argv[3]);
  const out = await p.evaluate(async ({ data, boxes }) => {
    const img = new Image(); img.src = 'data:image/webp;base64,' + data; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const hex = (d) => '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    return boxes.map(([n, x, y, w, h]) => {
      const d = g.getImageData(x, y, w, h).data; let best = null, bl = -1, worst = null, wl = 999; const hist = {};
      for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i+1] + d[i+2]; const k = hex([d[i], d[i+1], d[i+2]]); hist[k] = (hist[k]||0)+1;
        if (l > bl) { bl = l; best = [d[i], d[i+1], d[i+2]]; } if (l < wl) { wl = l; worst = [d[i], d[i+1], d[i+2]]; } }
      const mode = Object.entries(hist).sort((a,b)=>b[1]-a[1])[0][0];
      return [n, 'brightest', hex(best), 'darkest', hex(worst), 'mode', mode];
    });
  }, { data, boxes });
  for (const r of out) console.log(r.join(' '));
  await b.close();
})();
