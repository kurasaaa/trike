// Language switch, ratings on screen, and the offline app keeping its data across a restart (LOCAL DEMO MODE).
// node picks.test.js ../panaw-redesign.html
const { chromium } = require('playwright-core');
const file = 'file:///' + process.argv[2].split(String.fromCharCode(92)).join('/');
const res = [], errors = [];
const check = (n, ok, ev = '') => res.push({ n, ok: !!ok, ev: String(ev).slice(0, 160) });
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 } }), p = await c.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  const waitFor = (js, ms = 8000) => p.waitForFunction(js, null, { timeout: ms, polling: 250 }).then(() => true, () => false);
  await p.goto(file); await p.waitForTimeout(700);
  check('one phone, offline mode', await p.evaluate(`REMOTE === false && phones.length === 1`));
  // language
  await p.click('[data-guest]'); await p.click('[data-go-tab="account"]'); await p.click('.tab.on [data-page="lang"]');
  await p.click('[data-lang="hil"]');
  check('Hiligaynon: tab labels change', (await p.textContent('.tabbar')).includes('Sakay') && (await p.textContent('.tabbar')).includes('Lagaw'), await p.textContent('.tabbar'));
  check('language page marks the choice', await p.evaluate(`document.querySelector('[data-lang="hil"]').getAttribute('aria-pressed') === 'true'`));
  await p.click('[data-go-tab="ride"]');
  check('Hiligaynon: labels drawn later are translated', await waitFor(`document.querySelector('.tab.on').innerText.includes('Maghimo sang account')`), await p.evaluate(`document.querySelector('.tab.on .sheet').innerText`));
  await p.reload(); await p.waitForTimeout(700);
  check('language is remembered after a restart', (await p.textContent('.auth')).includes('Maghimo sang account'));
  await p.click('[data-guest]'); await p.click('[data-go-tab="account"]'); await p.click('.tab.on [data-page="lang"]'); await p.click('[data-lang="en"]');
  check('back to English', (await p.textContent('.tabbar')).includes('Ride') && (await p.textContent('.tabbar')).includes('Explore'));
  // sign in, ride with a demo trike, rate it
  await p.click('[data-go-tab="account"]'); await p.click('[data-to-auth="login"]');
  await p.fill('[name="mobile"]', '09171234567'); await p.fill('[name="password"]', 'demo1234'); await p.click('[data-login]');
  await p.click('[data-go-tab="ride"]');
  await p.evaluate(`(() => { const P = phones[0]; P.ride.stops = ['d6']; P.ride.step = 'options'; P.drawRideSheet(); })()`);
  { const cp = await p.$('[data-confirm-pickup]'); if (cp) await cp.click(); }
  await waitFor(`!document.querySelector('[data-book]').disabled`); await p.click('[data-book]');
  check('driver card shows a rating line', await waitFor(`/No ratings yet|Rated \\d/.test(document.querySelector('.tab.on .sheet').innerText)`, 15000));
  check('demo trike finishes the ride', await waitFor(`phones[0].myRide() && phones[0].myRide().status === 'completed'`, 120000));
  await waitFor(`!!document.querySelector('[data-rate="4"]')`); await p.click('[data-rate="4"]');
  const unit = await p.evaluate(`phones[0].myRide().driverId`);
  check('rating saved on the trike', await p.evaluate(`Hub.drivers['${unit}'].ratings.some(r => r.stars === 4)`));
  check('rating thanks shown', (await p.textContent('.tab.on .sheet')).includes('4-star rating'));
  await p.click('[data-ride-new]');
  // offline app: data survives closing the app
  await p.waitForTimeout(2000); await p.reload(); await p.waitForTimeout(900);
  check('still signed in after restart', await p.evaluate(`phones[0].account && phones[0].account.id === 'u-ana'`));
  check('ride history kept after restart', await p.evaluate(`phones[0].account.history.some(h => h.kind === 'ride' && h.rating === 4)`));
  check('trike rating kept after restart', await p.evaluate(`(Hub.drivers['${unit}'].ratings || []).some(r => r.stars === 4)`));
  await b.close();
  for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok ? '' : '  -- ' + r.ev}`);
  console.log(`${res.filter(r => r.ok).length} passed, ${res.filter(r => !r.ok).length} failed; errors: ${errors.length}`, errors.slice(0, 3));
  process.exit(res.every(r => r.ok) && !errors.length ? 0 : 1);
})().catch(e => { console.error('CRASH', e.message); process.exit(2); });
