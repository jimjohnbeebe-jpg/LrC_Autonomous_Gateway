// Where the stage's filmstrip cells and thumbnail images sit, versus the collapsed deck (root-relative px).
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1984, height: 1080 } });
  await p.goto('file://' + path.join(__dirname, 'option-c.html'));
  const r = await p.evaluate(() => {
    const root = document.getElementById('lr-w'); const rr = root.getBoundingClientRect();
    const box = (el) => { const r = el.getBoundingClientRect(); return [r.left - rr.left, r.top - rr.top, r.width, r.height].map((v) => Math.round(v * 10) / 10); };
    return { deck: box(root.querySelector('.deck')), filmhead: box(root.querySelector('.lr-filmhead')),
      cell0: box(root.querySelector('.lr-cell')), img0: box(root.querySelector('.lr-cell .lr-thumb-img')),
      minImgTop: Math.min(...Array.from(root.querySelectorAll('.lr-cell .lr-thumb-img')).map((e) => e.getBoundingClientRect().top - rr.top)),
      toggle: box(root.querySelector('.lr-film > .lr-tri.down')) };
  });
  console.log(JSON.stringify(r));
  await b.close();
})();
