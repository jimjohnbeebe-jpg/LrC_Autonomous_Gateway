const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage();
 await p.goto('file://' + process.argv[2]); await p.evaluate(() => document.fonts.ready);
 console.log(await p.evaluate(() => [...document.fonts].map(f => f.family + ':' + f.status).join(',') + ' | ' + ['a','b','c','d'].map(i => i + ' ' + document.getElementById(i).getBoundingClientRect().width.toFixed(2)).join(' ')));
 await b.close(); })();
