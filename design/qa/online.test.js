// Connected mode: two separate phones (browser contexts) on one PANAW server.
// Run a server first (a copy, so its data/ is throwaway):  PORT=3456 node server.js
// Then: node online.test.js http://localhost:3456
// No SMS is sent: the alert only opens an sms: link, which this test reads but never follows.
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:3456';
const res = [], errors = [];
const check = (n, ok, ev = '') => res.push({ n, ok: !!ok, ev: String(ev).slice(0, 160) });
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const phone = async () => {
    const c = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage();
    p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto(BASE + '/'); await p.waitForTimeout(800); return p;
  };
  const waitFor = (p, js, ms = 8000) => p.waitForFunction(js, null, { timeout: ms, polling: 250 }).then(() => true, () => false);
  const login = async (p, mobile) => {
    await p.click('[data-auth="login"]'); await p.fill('[name="mobile"]', mobile); await p.fill('[name="password"]', 'demo1234'); await p.click('[data-login]');
    return waitFor(p, `!!phones[0].account && phones[0].account.mobile === '${mobile}'`);
  };
  const A = await phone(), B = await phone();
  check('served page runs in connected mode', await A.evaluate(`REMOTE === true && API === ''`));
  check('wrong password is refused', await (async () => {
    await A.click('[data-auth="login"]'); await A.fill('[name="mobile"]', '09171234567'); await A.fill('[name="password"]', 'nope12345'); await A.click('[data-login]');
    await A.waitForTimeout(600); const t = await A.textContent('.auth'); await A.click('[data-auth="welcome"]'); return t.includes('Wrong mobile number or password');
  })());
  check('passenger logs in on phone A', await login(A, '09171234567'));
  check('driver logs in on phone B', await login(B, '09181234567'));
  check('view has no password hash', await A.evaluate(`!JSON.stringify(Hub.accounts).includes('scrypt')`));
  // demo trikes busy so the request goes to the real driver phone
  await B.click('[data-online="1"]');
  check('driver goes online on the server', await waitFor(B, `phones[0].me().online === true`));
  await fetch(BASE + '/api/hub/view').then(r => check('view needs a login', r.status === 401));
  // the request must reach phone B through the server
  await A.evaluate(`(() => { const P = phones[0]; P.ride.stops = ['d6']; P.ride.step = 'options'; P.drawRideSheet(); })()`);
  // make bots unavailable on the server would need a server hook; instead decline bots by waiting for B's request
  let gotIt = false;
  for (let i = 0; i < 6 && !gotIt; i++) {
    if (!(await A.evaluate(`!!phones[0].myRide()`))) { await waitFor(A, `!document.querySelector('[data-book]').disabled`); await A.click('[data-book]'); }
    gotIt = await waitFor(B, `!!document.querySelector('[data-job="accept"]')`, 4000);
    if (!gotIt) { await A.evaluate(`(() => { const r = phones[0].myRide(); if (r) phones[0].act('cancel', { id: r.id }); phones[0].ride.reqId = null; phones[0].ride.step = 'options'; phones[0].drawRideSheet(); })()`); await A.waitForTimeout(800); }
  }
  check('booking on phone A reaches the driver on phone B', gotIt);
  const fareA = await A.evaluate(`phones[0].myRide().quote.total`), fareB = await B.evaluate(`phones[0].myJob().quote.total`);
  check('both phones show the same server-computed fare', fareA === fareB && fareA > 0, `${fareA} vs ${fareB}`);
  check('driver view hides passenger contacts', await B.evaluate(`!('contacts' in phones[0].myJob())`));
  await B.click('[data-job="accept"]');
  check('passenger sees the acceptance', await waitFor(A, `phones[0].myRide().status === 'accepted'`));
  await B.click('[data-job="arrived"]'); await waitFor(B, `phones[0].myJob().status === 'arrived'`);
  await B.click('[data-job="start"]');
  check('trip starts on both phones', await waitFor(A, `phones[0].myRide().status === 'ontrip'`));
  // live tracking link
  const share = await A.evaluate(`phones[0].myRide().share`);
  const tv = await fetch(BASE + '/api/track/' + share).then(r => r.json());
  check('tracking API shows the trip without an account', tv.status === 'ontrip' && tv.unit && tv.path.length > 1, JSON.stringify(tv).slice(0, 120));
  check('tracking API hides the passenger surname', tv.passenger === 'Ana');
  check('unknown tracking code is 404', (await fetch(BASE + '/api/track/doesnotexist')).status === 404);
  const T = await (await b.newContext()).newPage(); T.on('pageerror', e => errors.push('track: ' + e.message));
  await T.goto(BASE + '/t/' + share);
  check('tracking page renders the trip', await waitFor(T, `document.body.innerText.includes('On the trip') && document.body.innerText.includes('Tricycle unit')`));
  // emergency: alert prepared, sms link includes the live link
  await A.click('[data-sos]');
  check('Emergency prepares the alert', await waitFor(A, `phones[0].myRide().safety.some(e => e.type === 'alert_sent')`));
  const href = await A.getAttribute('a[href^="sms:"]', 'href').catch(() => '');
  check('alert SMS link carries the contact number and tracking link', href.startsWith('sms:09170001111') && decodeURIComponent(href).includes('/t/' + share), href.slice(0, 120));
  check('driver does not see the alert (silent alarm)', await B.evaluate(`!phones[0].myJob().safety.some(e => e.type === 'alert_sent') && !document.body.innerText.includes('alert')`));
  await B.click('[data-job="complete"]');
  check('trip completes on the passenger phone', await waitFor(A, `phones[0].ride.step === 'done' || phones[0].myRide().status === 'completed'`));
  await waitFor(A, `!!document.querySelector('[data-rate="5"]')`); await A.click('[data-rate="5"]');
  check('rating reaches the driver record', await waitFor(B, `(phones[0].me().ratings || []).some(r => r.stars === 5)`));
  check('earnings recorded on the driver account', await waitFor(B, `phones[0].account.earnings === ${fareA}`), await B.evaluate(`phones[0].account.earnings`));
  // a fresh login on another phone sees the history (state is on the server, not the phone)
  const C = await phone(); await login(C, '09171234567');
  check('history is kept on the server account', await C.evaluate(`phones[0].account.history.some(h => h.kind === 'ride' && h.fare === ${fareA})`));
  // sign-up and logout
  const D = await phone();
  await D.click('[data-auth="role"]'); await D.click('[data-auth="signup"]');
  await D.fill('[name="name"]', 'Online Tester'); await D.fill('[name="mobile"]', '09995550001'); await D.fill('[name="password"]', 'password1'); await D.click('[data-signup]');
  check('sign-up creates a server account', await waitFor(D, `phones[0].account && phones[0].account.name === 'Online Tester'`));
  await D.reload(); await D.waitForTimeout(2500);
  check('session survives an app restart', await D.evaluate(`!!phones[0].account && phones[0].account.name === 'Online Tester'`));
  await D.click('[data-go-tab="account"]'); await D.click('[data-logout]'); await D.waitForTimeout(800); await D.reload(); await D.waitForTimeout(1500);
  check('logout ends the session', await D.evaluate(`!phones[0].account`));
  await b.close();
  for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok ? '' : '  -- ' + r.ev}`);
  console.log(`${res.filter(r => r.ok).length} passed, ${res.filter(r => !r.ok).length} failed; page errors: ${errors.length}`, errors.slice(0, 3));
  process.exit(res.every(r => r.ok) && !errors.length ? 0 : 1);
})().catch(e => { console.error('CRASH', e.message); process.exit(2); });
