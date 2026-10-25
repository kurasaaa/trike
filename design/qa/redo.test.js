// REDO.md acceptance checks at phone size (390 x 844), single phone, offline mode.
// node redo.test.js ../panaw-redesign.html
const { chromium } = require('playwright-core');
const file = 'file:///' + process.argv[2].split(String.fromCharCode(92)).join('/');
const res = [], errors = [];
const check = (n, ok, ev = '') => res.push({ n, ok: !!ok, ev: String(ev).slice(0, 160) });
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: [], geolocation: undefined });
  const p = await c.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  const ev = js => p.evaluate(js), txt = sel => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  await p.goto(file); await p.waitForTimeout(700);
  // welcome / login
  check('welcome: create account is the primary action', await ev(`document.querySelector('[data-auth="role"]').classList.contains('primary')`));
  check('welcome: guest action present', /Explore as guest/.test(await txt('.auth')));
  check('demo logins hidden in a closed Demo access section', await ev(`(() => { const d = document.querySelector('details.demo-access'); return d && !d.open && !document.querySelector('.auth').innerText.includes('demo1234'); })()`));
  await p.click('[data-auth="login"]');
  await p.fill('[name="password"]', 'secret99');
  await p.click('[data-pw-toggle]');
  check('password show/hide toggles type and state', await ev(`document.querySelector('[name="password"]').type === 'text' && document.querySelector('[data-pw-toggle]').getAttribute('aria-pressed') === 'true'`));
  await p.click('[data-pw-toggle]');
  await p.fill('[name="mobile"]', '09171234567'); await p.click('[data-login]');
  check('wrong password: error shown next to the form, mobile kept', /Wrong mobile number or password/.test(await txt('.form-error')) && (await p.inputValue('[name="mobile"]')) === '09171234567');
  await p.fill('[name="password"]', 'demo1234'); await p.click('[data-login]'); await p.waitForTimeout(300);
  // Ride landing
  const ride = await txt('.tab.on .sheet');
  check('Ride: heading, Pickup point and destination labels', /Where do you need a ride\?/.test(ride) && /Pickup point/.test(ride) && /Where are you going\?/.test(ride), ride.slice(0, 120));
  check('Ride: sample pickup labelled as not your location', /Sample point for the demo, not your location/.test(ride));
  check('Ride: no "Your location" claim before GPS', !/Your current location/.test(ride));
  check('Ride: Review fare disabled without a destination, reason shown', await ev(`document.querySelector('[data-review]').disabled`) && /Choose where you are going/.test(ride));
  check('Ride: no tourism filters on the Ride screen', !(await p.$('.tab.on [data-cat], .tab.on [data-muni-select]')));
  check('Ride: no vehicle count from an unconfirmed sample pickup', /Choose your pickup point/.test(await txt('.tab.on .nearby')), await txt('.tab.on .nearby'));
  // direct ride, no Explore needed
  await p.click('.tab.on [data-ride="search"]'); await p.type('[data-q]', 'hosp'); await p.click('[data-pick="d3"]');
  check('direct ride: destination chosen from Ride search', /Hospital/i.test(await txt('.dest-box')));
  check('direct ride: Review fare still blocked by sample pickup', await ev(`document.querySelector('[data-review]').disabled`) && /Confirm or change your pickup point/.test(await txt('.tab.on .sheet')));
  await p.click('[data-pick-pickup]'); await p.type('[data-q]', 'market'); await p.click('[data-pick="d2"]');
  check('Ride: simulated trikes labelled DEMO, not real', /DEMO/.test(await txt('.tab.on .nearby')) && /simulated/.test(await txt('.tab.on .nearby')), await txt('.tab.on .nearby'));
  check('pickup chosen from a known place, labelled', /Place you chose/.test(await txt('.pickup-box')) && /Market/.test(await txt('.pickup-box')));
  await p.click('[data-review]');
  check('Review fare opens options with pickup and fare', await ev(`!!document.querySelector('[data-book]') && !document.querySelector('[data-book]').disabled || /No trike online/.test(document.querySelector('.tab.on .sheet').innerText)`) && /Pickup:/.test(await txt('.tab.on .sheet')));
  const fare = await ev(`(() => { const q = phones[0].quotes().qp; return q.total; })()`);
  check('fare unchanged: same engine total as the hub quote', (await txt('[data-option="pickup"] .price')) === '₱' + fare.toFixed(2), fare);
  await p.click('.tab.on [data-ride="home"]'); await p.click('[data-clear-dest]');
  // Explore
  await p.click('[data-go-tab="explore"]');
  const top = await ev(`(() => { const s = document.querySelector('.tab.on .scroll'); const grid = s.querySelector('[data-grid] [data-place]').getBoundingClientRect().top; const hire = s.querySelector('[data-hire]').getBoundingClientRect().top; return { grid, hire }; })()`);
  check('Explore: places come before group trips', top.grid < top.hire, JSON.stringify(top));
  check('Explore: first place visible without scrolling', top.grid < 844 - 70, top.grid);
  check('Explore: one Municipality selector with All Guimaras', await ev(`(() => { const s = document.querySelector('[data-muni-select]'); return s && s.options[0].text === 'All Guimaras' && s.options.length === 6; })()`));
  await p.selectOption('[data-muni-select]', 'jordan');
  const rows = await p.$$eval('[data-grid] .list-row .s', l => l.map(e => e.textContent));
  check('Municipality filter returns that town only', rows.length && rows.every(s => /Jordan|barangay/.test(s)), rows.slice(0, 4).join('|'));
  await p.click('[data-cat="Heritage"]');
  check('category and municipality combine, active filters shown', /Heritage · Jordan/.test(await txt('.filter-line')), await txt('.filter-line'));
  await p.click('[data-grid] [data-place]'); await p.click('.page [data-back]');
  check('filters kept after opening a place and returning', await ev(`phones[0].explore.cat === 'Heritage' && document.querySelector('[data-muni-select]').value === 'jordan'`));
  await p.click('.filter-line [data-clear-filters]');
  check('Clear filters restores the full list', await ev(`phones[0].explore.cat === 'All' && phones[0].explore.muni === 'all'`) && /in Guimaras/.test(await txt('.filter-line')));
  // place -> ride
  await p.click('[data-place="dest_guisi_lighthouse"]');
  check('place page: explicit Get a tricycle action, no booking yet', /Get a tricycle to this place/.test(await txt('.page')) && !(await ev(`!!phones[0].myRide()`)));
  await p.click('[data-ride-here]');
  check('place -> Ride keeps the destination and asks for pickup', await ev(`phones[0].tab === 'ride' && phones[0].ride.step === 'home' && phones[0].ride.stops[0] === 'dest_guisi_lighthouse'`) && /Guisi/.test(await txt('.dest-box')));
  // safety still there
  await p.click('[data-review]'); await p.waitForTimeout(200);
  const book = await p.$('[data-book]:not([disabled])');
  if (book) {
    await book.click(); await p.waitForFunction(`phones[0].myRide() && ['accepted','arrived','ontrip'].includes(phones[0].myRide().status)`, null, { timeout: 30000 }).catch(() => {});
    check('safety: Emergency button and Share trip on an active ride', !!(await p.$('[data-sos]')) && !!(await p.$('[data-share]')));
    check('safety: safety watch line with contacts', /Safety watch on/.test(await txt('.tab.on .sheet')));
  } else check('safety: a trike was available to test the active ride', false, 'no trike online');
  // narrow screen: no horizontal overflow
  await p.setViewportSize({ width: 320, height: 640 });
  await p.click('[data-go-tab="explore"]'); await p.waitForTimeout(200);
  check('320 px wide: no horizontal page scroll', await ev(`document.documentElement.scrollWidth <= 320`), await ev(`document.documentElement.scrollWidth`));
  await b.close();
  for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok ? '' : '  -- ' + r.ev}`);
  console.log(`${res.filter(r => r.ok).length} passed, ${res.filter(r => !r.ok).length} failed; errors: ${errors.length}`, errors.slice(0, 3));
  process.exit(res.every(r => r.ok) && !errors.length ? 0 : 1);
})().catch(e => { console.error('CRASH', e.message); process.exit(2); });
