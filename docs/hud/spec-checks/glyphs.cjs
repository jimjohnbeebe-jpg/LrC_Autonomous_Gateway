// Which characters does the bundled Inter subset (fonts/inter.woff2) draw itself?
// A glyph comes from Inter when its width is the same with two different fallback fonts.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
(async () => {
  const font = 'file://' + path.resolve(__dirname, '../fonts/inter.woff2');
  const chars = ['→', '−', '±', '·', '…', '←', '↑', '↓', '▲', '✓', '⚠'];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(__dirname, 'glyphs.html'));
  await page.evaluate(() => document.fonts.load('16px InterX'));
  const out = await page.evaluate((chars) => {
    const c = document.createElement('canvas').getContext('2d');
    return chars.map((ch) => {
      const w = (fb) => { c.font = `40px InterX, ${fb}`; return c.measureText(ch).width; };
      const a = w('"Courier New", monospace'), b = w('serif');
      return `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} ${ch} ${a === b ? 'Inter' : 'fallback'} (${a.toFixed(1)} / ${b.toFixed(1)})`;
    });
  }, chars);
  console.log(out.join('\n'));
  await browser.close();
})();
