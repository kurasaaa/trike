// A ride the server still has open must show on the phone after an app restart, not block new rides unseen.
// Run a throwaway server first (PORT=3456 node server.js on a copy), then: node stuck.test.js http://localhost:3456
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:3456';
const res = [], errors = [];
const check = (n, ok, ev = '') => res.push({ n, ok: !!ok, ev: String(ev).slice(0, 160) });
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  const waitFor = (js, ms = 8000) => p.waitForFunction(js, null, { timeout: ms, polling: 250 }).then(() => true, () => false);
  const ticket = async () => {
    await p.evaluate(`(() => { const P = phones[0]; P.ride.stops = ['dest_brgy_agsanayan']; P.ride.step = 'options'; P.ride.option = 'terminal'; P.ride.opts.pax = 4; P.drawRideSheet(); })()`);
    await waitFor(`/fare ticket/.test(document.querySelector('[data-book]').innerText)`); await p.click('[data-book]');
    return waitFor(`!!document.querySelector('[data-board]')`);
  };
  await p.goto(BASE + '/'); await p.waitForTimeout(800);
  await p.click('[data-auth="role"]'); await p.click('[data-role="passenger"]'); await p.click('[data-auth="signup"]');
  await p.fill('[name="name"]', 'Stuck Test'); await p.fill('[name="mobile"]', '09995557001'); await p.fill('[name="password"]', 'password1'); await p.click('[data-signup]');
  await waitFor(`!!phones[0].account`);
  check('fare ticket issued', await ticket());
  await p.selectOption('[name="bunit"]', '__other').catch(() => {}); await p.fill('[name="bother"]', 'BTODA-0315'); await p.click('[data-board]');
  check('boarding starts the ride', await waitFor(`phones[0].ride.step === 'active' && !!phones[0].myRide()`));
  // app restart: the phone forgets which ride it was on, the server has not
  await p.reload(); await p.waitForTimeout(2500);
  check('after a restart the open ride is shown again', await waitFor(`phones[0].ride.step === 'active' && phones[0].myRide() && phones[0].myRide().status === 'arrived'`), await p.evaluate(`phones[0].ride.step`));
  // whatever screen the phone is on, a redraw with no ride in memory brings the open ride back
  await p.evaluate(`(() => { const P = phones[0]; P.ride.reqId = null; P.ride.step = 'home'; P.drawRideSheet(); })()`);
  check('an open ride is never hidden behind the home screen', await p.evaluate(`phones[0].ride.step === 'active' && /Cancel trip/.test(document.querySelector('.tab.on .sheet').innerText)`));
  await p.click('[data-cancel-ride]');
  check('cancelling frees the passenger and does not bring the ride back', await waitFor(`!Hub.requests.some(r => r.passengerId === phones[0].account.id && ['requested','accepted','arrived','ontrip'].includes(r.status)) && phones[0].ride.step !== 'active'`));
  check('a new fare ticket works after that', await ticket());
  await b.close();
  for (const x of res) console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.n}${x.ok ? '' : '  -- ' + x.ev}`);
  console.log(`${res.filter(x => x.ok).length} passed, ${res.filter(x => !x.ok).length} failed; page errors: ${errors.length}`, errors.slice(0, 3));
  process.exit(res.every(x => x.ok) && !errors.length ? 0 : 1);
})().catch(e => { console.error('CRASH', e.message); process.exit(2); });
