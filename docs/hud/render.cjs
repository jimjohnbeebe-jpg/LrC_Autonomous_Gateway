#!/usr/bin/env node
// Render a static HTML (or SVG) mockup to PNG with headless Chromium.
// Usage: node render.cjs <htmlPath> <outPng> [--w=1920] [--h=1080] [--scale=1] [--selector=<css>] [--pad=<px>]
//   --selector  screenshot only that element's bounding box (plus --pad px on every side, clamped to the page)
//   --scale     deviceScaleFactor (2 = retina-sized PNG)
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

function parseArgs(argv) {
  const pos = [];
  const o = { w: 1920, h: 1080, scale: 1, selector: null, pad: 0 };
  for (const a of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (!m) { pos.push(a); continue; }
    const [, k, v] = m;
    if (k === 'w' || k === 'h' || k === 'pad') o[k] = parseInt(v, 10);
    else if (k === 'scale') o.scale = parseFloat(v);
    else if (k === 'selector') o.selector = v;
    else throw new Error('unknown option --' + k);
  }
  if (pos.length < 2) {
    console.error('usage: node render.cjs <htmlPath> <outPng> [--w=1920] [--h=1080] [--scale=1] [--selector=<css>] [--pad=<px>]');
    process.exit(2);
  }
  o.input = path.resolve(pos[0]);
  o.output = path.resolve(pos[1]);
  return o;
}

(async () => {
  const o = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(o.input)) { console.error('not found: ' + o.input); process.exit(1); }
  fs.mkdirSync(path.dirname(o.output), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: o.w, height: o.h }, deviceScaleFactor: o.scale });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', (r) => errors.push('request failed: ' + r.url()));
    await page.goto('file://' + o.input, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      const imgs = Array.from(document.images);
      await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((res) => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
      }))));
      await Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => {}) : null)));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const shot = { path: o.output, type: 'png' };
    if (o.selector) {
      const box = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height,
          pw: document.documentElement.scrollWidth, ph: document.documentElement.scrollHeight };
      }, o.selector);
      if (!box) throw new Error('selector matched nothing: ' + o.selector);
      const x = Math.max(0, Math.floor(box.x - o.pad));
      const y = Math.max(0, Math.floor(box.y - o.pad));
      const x2 = Math.min(Math.max(box.pw, o.w), Math.ceil(box.x + box.width + o.pad));
      const y2 = Math.min(Math.max(box.ph, o.h), Math.ceil(box.y + box.height + o.pad));
      shot.clip = { x, y, width: x2 - x, height: y2 - y };
      shot.fullPage = true;
    }
    await page.screenshot(shot);
    const buf = fs.readFileSync(o.output);
    const pw = buf.readUInt32BE(16), ph = buf.readUInt32BE(20);
    for (const e of errors) console.error('page: ' + e);
    console.log(`${o.output} ${pw}x${ph}`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
