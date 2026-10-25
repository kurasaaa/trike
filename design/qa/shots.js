// Screenshots of the main passenger screens at phone size, for the UI/UX audit.
// node shots.js ../panaw-redesign.html <outdir>
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
(async () => {
  const out = process.argv[3]; fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  const shot = async n => { await p.waitForTimeout(400); await p.screenshot({ path: path.join(out, n + '.png') }); };
  await p.goto('file:///' + process.argv[2].split(String.fromCharCode(92)).join('/')); await p.waitForTimeout(800);
  await shot('01-welcome');
  await p.click('[data-auth="login"]'); await shot('02-login');
  await p.fill('[name="mobile"]', '09171234567'); await p.fill('[name="password"]', 'demo1234'); await p.click('[data-login]');
  await shot('03-ride-home');
  await p.click('[data-go-tab="explore"]'); await shot('04-explore');
  await p.evaluate(() => document.querySelector('.tab.on .scroll').scrollTo(0, 400)); await shot('05-explore-scrolled');
  await p.click('[data-place="dest_guisi_lighthouse"]'); await shot('06-place');
  const ride = await p.$('[data-ride-here], [data-get-trike]'); if (ride) { await ride.click(); await shot('07-ride-from-place'); }
  console.log('shots in', out, 'errors:', errors);
  await b.close();
})();
