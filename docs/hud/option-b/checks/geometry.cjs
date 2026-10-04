// Prints the rail's measured geometry (handle for NOTES.md "Placement"): placement in the in-context frames; the
// action panel's height per state; where Accept, Abort and the primary sit, measured from the column's bottom edge
// (y 900 in context, in both forms), so equal numbers mean the same screen position; the docked panel's top edge per
// state and which of Lightroom's own left-panel rows it leaves visible in the stage; and the Lightroom window height
// at which each full-rail state shows its info panels without scrolling (stage chrome: title bar 32 + menu 20 + top
// band 60 above the column; the 36 px bottom bar and the 144 px filmstrip below it: stage/stage.js FIXED).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + require('path').resolve(__dirname, '..', 'option-b.html'));
  await p.evaluate(() => document.fonts.ready);
  const out = await p.evaluate(() => {
    function rel(el, root) { const a = el.getBoundingClientRect(), r = root.getBoundingClientRect(); return [Math.round(a.left - r.left), Math.round(a.top - r.top), Math.round(a.width), Math.round(a.height)]; }
    const o = { context: {}, fromBottom: {}, dockedTop: {}, lightroomLeftRows: [], windowHeightNoScroll: {} };
    for (const id of ['lr-p', 'lr-v', 'lr-c']) {
      const root = document.getElementById(id); const rb = root.querySelector('.rb,.rbp');
      const btn = (t) => [...rb.querySelectorAll('.rb-btn, .rb-primary')].find((e) => e.textContent.trim().replace(/Enter$/, '') === t);
      o.context[id] = { form: rb.classList.contains('rb') ? 'full' : 'docked', rail: rel(rb, root),
        strip: rb.querySelector('.rb-strip') ? rel(rb.querySelector('.rb-strip'), root) : null,
        primary: rb.querySelector('.rb-primary') ? rel(rb.querySelector('.rb-primary'), root) : null,
        accept: btn('Accept') ? rel(btn('Accept'), root) : null, abort: btn('Abort') ? rel(btn('Abort'), root) : null };
    }
    // Lightroom's own left-column rows in the stage (rail removed from view: read from the docked P frame's stage)
    const C = document.getElementById('lr-c');
    o.lightroomLeftRows = [...C.querySelectorAll('.lr-left .lr-col *')].filter((e) => e.children.length === 0 && e.textContent.trim())
      .map((e) => { const r = rel(e, C); return r[1] + '-' + (r[1] + r[3]) + ' ' + e.textContent.trim().slice(0, 28); });
    // every rail and docked panel: distances from the column's bottom edge to the top of each button
    document.querySelectorAll('.rb, .rbp').forEach((rb) => {
      const host = (rb.closest('.slot[id], [id^="lr-"]') || {}).id;
      const colEl = rb.classList.contains('rb') ? rb.querySelector('.rb-col') : rb;
      const bottom = colEl.getBoundingClientRect().bottom;
      const up = (el) => el ? Math.round(bottom - el.getBoundingClientRect().top) : null;
      const btn = (t) => [...rb.querySelectorAll('.rb-btn, .rb-primary')].find((e) => e.textContent.trim().replace(/Enter$/, '').replace(/\?$/, '') === t);
      const bot = rb.querySelector('.rb-bot');
      o.fromBottom[host + ' ' + rb.dataset.state + (rb.classList.contains('rbp') ? ' (docked)' : '')] = {
        actionPanel: bot.offsetHeight, primary: up(rb.querySelector('.rb-primary')), accept: up(btn('Accept')), abort: up(btn('Abort')) };
      if (rb.classList.contains('rbp')) o.dockedTop[host + ' ' + rb.dataset.state] = { height: Math.round(rb.getBoundingClientRect().height), topYInContext: 900 - Math.round(rb.getBoundingClientRect().height) };
      if (rb.classList.contains('rb')) {
        const sc = rb.querySelector('.rb-scroll'); let info = 0; [...sc.children].forEach((c) => { if (!c.classList.contains('rb-sbar')) info += c.offsetHeight; });
        const column = 28 + info + bot.offsetHeight + 1;
        o.windowHeightNoScroll[host + ' ' + rb.dataset.state] = { column, window: column + 112 + 36 + 144 };
      }
    });
    return o;
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
