// Audit option-a.html after its build: type sizes, colours, island/panel geometry, overflow, details row overlaps,
// callout overhang, and every form's width.
// node option-a/audit.cjs $PWD/option-a/option-a.html
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + process.argv[2]); await p.waitForFunction(() => window.BUILT === true); await p.evaluate(() => document.fonts.ready);
  const r = await p.evaluate(() => {
    const sizes = new Set(), colors = new Set(), geo = [];
    document.querySelectorAll('.hud').forEach(h => {
      const hr = h.getBoundingClientRect(); const root = h.parentElement.getBoundingClientRect();
      const sec = h.closest('section').id;
      geo.push(`${sec} ${h.firstElementChild.className} x=${(hr.left-root.left).toFixed(0)} y=${(hr.top-root.top).toFixed(0)} w=${hr.width.toFixed(0)} h=${hr.height.toFixed(1)}${h.dataset.form !== undefined ? ' form=' + h.dataset.form : ''}`);
      h.querySelectorAll('*').forEach(e => {
        const cs = getComputedStyle(e);
        if ([...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())) sizes.add(cs.fontSize + '/' + cs.fontWeight);
        if (e.namespaceURI === 'http://www.w3.org/2000/svg') return;
        colors.add('c ' + cs.color);
        if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') colors.add('bg ' + cs.backgroundColor);
        if (cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none') colors.add('bd ' + cs.borderTopColor);
        if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && cs.overflow === 'hidden')
          geo.push((cs.textOverflow === 'ellipsis' ? 'TRUNCATED (by design) ' : 'OVERFLOW ') + sec + ' ' + e.className + ' "' + e.textContent.slice(0, 60) + '"');
      });
    });
    const svgc = new Set(); document.querySelectorAll('.hud svg *').forEach(e => { ['fill','stroke'].forEach(a => { const v = e.getAttribute(a); if (v && v !== 'none') svgc.add(v); }); });
    // band geometry on the full stage, and every form's width
    const rc = document.getElementById('lr-c'), rr = rc.getBoundingClientRect();
    const idr = rc.querySelector('.lr-idtext').getBoundingClientRect().right - rr.left, mdl = rc.querySelector('.lr-modules').getBoundingClientRect().left - rr.left;
    // details: no row may overlap the next (labels wrap, rows grow), and the step lines end above the diff header row
    const overlaps = []; let rowsChecked = 0;
    document.querySelectorAll(".dd .sec").forEach(sec => {
      const kids = [...sec.querySelectorAll(".stepline, .dnote, .seghead, .diff > *, .gr")];
      for (let i = 1; i < kids.length; i++) { rowsChecked++; const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
        if (b.top < a.bottom - 0.5) overlaps.push(sec.closest("section").id + " " + kids[i - 1].className + " -> " + kids[i].className + " " + (a.bottom - b.top).toFixed(1) + " px \"" + kids[i].textContent.slice(0, 40) + "\""); }
    });
    // callouts never extend past the island
    const tips = [...document.querySelectorAll(".hud[data-overhang]")].map(t => t.dataset.overhang);
    return { overlaps, rowsChecked, tipOverhangRightLeft: tips, sizes: [...sizes].sort(), colors: [...colors].sort(), svg: [...svgc], band: { idtextRight: +idr.toFixed(1), modulesLeft: +mdl.toFixed(1) }, forms: window.FORM_WIDTHS, geo };
  });
  console.log(JSON.stringify(r, null, 1)); await b.close();
})();
