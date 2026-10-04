// Measures Inter glyph advances with and without 'tnum' (handle for the NOTES.md claim about the hyphen).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + require('path').resolve(__dirname, 'tnum.html'));
  await p.evaluate(() => document.fonts.ready);
  console.log(await p.evaluate(() => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((i) => i + ':' + document.getElementById(i).getBoundingClientRect().width.toFixed(2)).join(' ')));
  await b.close();
})();
