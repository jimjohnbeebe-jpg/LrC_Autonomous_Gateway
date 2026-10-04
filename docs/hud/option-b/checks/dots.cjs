// Prints each card summary's lines (which items share a line) and whether a separator dot is visible at a line end.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + require('path').resolve(__dirname, '..', 'option-b.html'));
  await p.evaluate(() => document.fonts.ready);
  const out = await p.evaluate(() => [...document.querySelectorAll('.rb-card .sum')].map((s) => {
    const host = (s.closest('.slot[id], [id^="lr-"]') || {}).id;
    const lines = {}; let endDots = 0;
    s.querySelectorAll('.it').forEach((it) => { const t = Math.round(it.getBoundingClientRect().top); (lines[t] = lines[t] || []).push(it.textContent); });
    s.querySelectorAll('.dt').forEach((dt) => { const nx = dt.nextElementSibling; if (nx && nx.getBoundingClientRect().top > dt.getBoundingClientRect().top + 4 && getComputedStyle(dt).visibility !== 'hidden') endDots++; });
    return { host, lines: Object.values(lines).map((l) => l.join(' · ')), clamped: s.scrollHeight > s.clientHeight + 1, visibleEndDots: endDots, width: Math.round(s.getBoundingClientRect().width) };
  }).filter((x) => x.lines.length));
  console.log(JSON.stringify(out, null, 1)); await b.close();
})();
