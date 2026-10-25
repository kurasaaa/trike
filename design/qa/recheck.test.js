// REDO_RECHECKED.md section 15.8, run on the REAL app build (public/app.html: no demo accounts, no simulated trikes),
// one phone at 390 x 844, offline mode.  node recheck.test.js ../../trikefair_final/trikefair/public/app.html
const { chromium } = require('playwright-core');
const file = 'file:///' + process.argv[2].split(String.fromCharCode(92)).join('/');
const res = [], errors = [];
const check = (n, ok, ev = '') => res.push({ n, ok: !!ok, ev: String(ev).slice(0, 200) });
// 1x1 PNG, a valid image without the network
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 10.69, longitude: 122.645 } });
  const p = await c.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  const ev = js => p.evaluate(js), txt = sel => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  const wait = ms => p.waitForTimeout(ms);
  await p.goto(file); await wait(800);

  /* ---------- the real app: no demo anything ---------- */
  check('real app: not the demo build', await ev(`DEMO_BUILD === false && isDemo() === false`));
  check('real app: no Demo access section, no shared password on screen', !(await p.$('details.demo-access')) && !/demo1234/.test(await txt('body')));
  check('real app: no sample accounts, operators or simulated trikes', await ev(`Hub.accounts.length === 0 && Hub.operators.length === 0 && Object.values(Hub.drivers).every(d => !d.bot)`));
  await p.click('[data-auth="login"]'); await p.fill('[name="mobile"]', '09171234567'); await p.fill('[name="password"]', 'demo1234'); await p.click('[data-login]'); await wait(200);
  check('real app: the old demo login is refused', /Wrong mobile number or password/.test(await txt('.form-error')));
  await p.click('[data-auth="welcome"]');

  /* ---------- 1. Explore as a guest ---------- */
  await p.click('[data-guest]'); await wait(300);
  await p.click('[data-go-tab="explore"]'); await wait(200);
  check('guest: Explore opens without starting a ride', await ev(`phones[0].tab === 'explore' && !phones[0].myRide()`));

  // put three owner listings on the board: a valid photo, a photo link that fails, and two photos where the first fails
  await ev(`(() => { Hub.listings.push(
    { id: 'PL-OK', name: 'Test Good Photo Resort', municipality: 'jordan', lat: 10.66, lng: 122.6, description: 'x', photos: ['${PNG}'], owner: null, kind: 'Beach / resort' },
    { id: 'PL-BAD', name: 'Test Broken Photo Eatery', municipality: 'sibunag', lat: 10.53, lng: 122.66, description: 'x', photos: ['data:image/png;base64,AAAA'], owner: null, kind: 'Food' },
    { id: 'PL-MIX', name: 'Test Mixed Photos Shop', municipality: 'jordan', lat: 10.65, lng: 122.6, description: 'x', photos: ['data:image/png;base64,AAAA', '${PNG}'], owner: null, kind: 'Pasalubong / shop' }
  ); phones[0].renderTab ? 0 : 0; Hub.emit(); phones[0].drawGrid(); })()`);
  await wait(400);

  /* ---------- 2. every municipality returns exactly its own records ---------- */
  const truth = muni => ev(`phones[0].allPlaces().filter(p => p.municipality === '${muni}').map(p => p.id).sort()`);
  const shown = () => ev(`(() => { const g = document.querySelector('[data-grid]'); return [...g.querySelectorAll('[data-place]')].map(e => e.dataset.place).sort(); })()`);
  for (const m of ['buenavista', 'jordan', 'nueva_valencia', 'san_lorenzo', 'sibunag']) {
    await p.selectOption('[data-muni-select]', m); await wait(150);
    const want = await truth(m), got = await shown(), line = await txt('.filter-line');
    check(`municipality ${m}: shows exactly its ${want.length} records`, JSON.stringify(want) === JSON.stringify(got), `want ${want.length} got ${got.length}`);
    check(`municipality ${m}: summary count matches the visible list`, new RegExp('^' + got.length + ' (place|barangay)s?\\b').test(line), line);
  }

  /* ---------- 3. All Guimaras and Clear filters ---------- */
  await p.click('.filter-line [data-clear-filters]'); await wait(150);
  const all = await ev(`(() => { const A = phones[0].allPlaces(), b = A.filter(p => p.category === 'Barangays');
    return { other: A.length - b.length, brgy: b.length, towns: new Set(b.map(p => p.municipality)).size }; })()`);
  const allLine = await txt('.filter-line');
  check('All Guimaras: summary describes places plus barangays grouped by town', allLine.startsWith(`${all.other} places · ${all.brgy} barangays by municipality (${all.towns} towns)`), allLine);
  check('All Guimaras: one row per town for barangays, every other place listed', (await p.$$('[data-brgy-town]')).length === all.towns
    && (await shown()).length === all.other, `${(await p.$$('[data-brgy-town]')).length} towns, ${(await shown()).length} places`);
  check('Clear filters returns to All Guimaras with no query', await ev(`phones[0].explore.cat === 'All' && phones[0].explore.muni === 'all' && phones[0].explore.q === ''`));

  /* ---------- 4. Barangays: all towns, one town, a search ---------- */
  await p.click('[data-cat="Barangays"]'); await wait(150);
  const bLine = await txt('.filter-line');
  check('Barangays, all towns: summary says grouped by municipality, not a flat count', bLine.startsWith(`${all.brgy} barangays by municipality (${all.towns} towns)`) && (await shown()).length === 0, bLine);
  await p.selectOption('[data-muni-select]', 'san_lorenzo'); await wait(150);
  const slWant = await ev(`phones[0].allPlaces().filter(p => p.category === 'Barangays' && p.municipality === 'san_lorenzo').length`);
  check('Barangays + San Lorenzo: individual rows, count matches', (await shown()).length === slWant && (await txt('.filter-line')).startsWith(`${slWant} barangays`), await txt('.filter-line'));
  await p.selectOption('[data-muni-select]', 'all'); await p.fill('[data-explore-q]', 'cabano'); await wait(250);
  const sGot = await shown(), sLine = await txt('.filter-line');
  check('Barangays + search: matching barangays listed one by one with the right count', sGot.length >= 1 && sGot.every(id => /brgy/.test(id)) && sLine.startsWith(sGot.length + ' barangay'), sLine + ' ' + sGot.join(','));
  await p.fill('[data-explore-q]', 'zzzz-nothing'); await wait(250);
  check('no results: empty state with Clear filters', /No places match/.test(await txt('[data-grid]')) && !!(await p.$('[data-grid] [data-clear-filters]')));
  await p.click('[data-grid] [data-clear-filters]'); await wait(200);

  /* ---------- 5. images: valid, missing, failing ---------- */
  await p.selectOption('[data-muni-select]', 'jordan'); await wait(300);
  check('grid: a valid photo is shown', await ev(`(() => { const i = document.querySelector('[data-place="PL-OK"] img'); return !!i && i.complete && i.naturalWidth > 0; })()`));
  check('grid: a failing photo becomes the placeholder (no broken image)', await ev(`(() => { const c = document.querySelector('[data-place="PL-MIX"] .pimg'); return c.classList.contains('broken') && !c.querySelector('img') && !!c.querySelector('svg'); })()`));
  await p.selectOption('[data-muni-select]', 'sibunag'); await wait(300);
  check('grid: failing photo in another town also falls back', await ev(`(() => { const c = document.querySelector('[data-place="PL-BAD"] .pimg'); return c && c.classList.contains('broken') && !c.querySelector('img'); })()`));
  await p.click('[data-place="PL-BAD"]'); await wait(300);
  check('place page: failing hero photo becomes the placeholder, once', await ev(`(() => { const h = document.querySelector('.page .hero'); return h.classList.contains('broken') && !h.querySelector('img') && h.querySelectorAll('svg.i').length === 1; })()`));
  await p.click('.page [data-back]'); await wait(150);
  await p.selectOption('[data-muni-select]', 'jordan'); await wait(200);
  await p.click('[data-place="PL-MIX"]'); await wait(300);
  check('place page: first of two photos fails, arrows still there', await ev(`!!document.querySelector('.page .hero.broken [data-ph="1"]')`));
  await p.click('.page [data-ph="1"]'); await wait(300);
  check('place page: the next photo loads after a failed one', await ev(`(() => { const i = document.querySelector('.page .hero img'); return !!i && i.naturalWidth > 0 && !document.querySelector('.page .hero.broken'); })()`));
  await p.click('.page [data-back]'); await wait(150);
  await p.click('[data-place="dest_jordan_wharf"]'); await wait(300);
  check('place page: a place with no photo shows the placeholder, no img', await ev(`(() => { const h = document.querySelector('.page .hero'); return h.classList.contains('empty') && !h.querySelector('img'); })()`));
  /* ---------- 11. truthful source ---------- */
  const page = await txt('.page');
  check('place page: no unsupported Tourism Office claim', !/Tourism Office/.test(page));
  check('place page: Place information matches the source badge', /Place information OpenStreetMap \(location\)/.test(page) && /Location: OpenStreetMap/.test(page), page.slice(0, 300));
  await p.click('.page [data-back]'); await wait(150);
  check('filters kept after opening places and returning', await ev(`phones[0].explore.muni === 'jordan' && document.querySelector('[data-muni-select]').value === 'jordan'`));

  /* ---------- 1b. signed-in passenger ---------- */
  await p.click('[data-go-tab="ride"]'); await wait(150);
  await p.click('[data-to-auth="role"]'); await p.click('[data-role="passenger"]'); await p.click('[data-auth="signup"]');
  await p.fill('[name="name"]', 'Recheck Rider'); await p.fill('[name="mobile"]', '09995550123'); await p.fill('[name="password"]', 'password1'); await p.click('[data-signup]'); await wait(400);
  check('sign-up works with no demo accounts present', await ev(`!!phones[0].account && phones[0].account.name === 'Recheck Rider'`));
  check('signed in: Explore still opens on its own', await (async () => { await p.click('[data-go-tab="explore"]'); await wait(200); return ev(`phones[0].tab === 'explore' && !phones[0].myRide()`); })());

  /* ---------- 6. place page before any pickup: no route verdict, no fare ---------- */
  await p.selectOption('[data-muni-select]', 'all'); await wait(150);
  await p.click('[data-place="dest_guisi_lighthouse"]'); await wait(300);
  let pg = await txt('.page');
  check('no pickup yet: no route failure, no fare, neutral guidance', !/No tricycle route|No road route/.test(pg) && !/₱\d+\.\d\d,/.test(pg) && /Choose your pickup point on the Ride screen to check the route and fare/.test(pg), pg.slice(0, 200));
  await p.click('.page [data-back]');
  await ev(`phones[0].openPage('place', 'dest_brgy_sibunag_inampologan')`); await wait(300);
  pg = await txt('.page');
  check('island barangay: "No road route to this place" whatever the pickup, no ride button', /No road route to this place/.test(pg) && !(await p.$('.page [data-ride-here]')), pg.slice(0, 200));
  await p.click('.page [data-back]');

  /* ---------- 9. Ride directly, and 7. pickup sources ---------- */
  await p.click('[data-go-tab="ride"]'); await wait(200);
  let ride = await txt('.tab.on .sheet');
  check('Ride: pickup starts unset, not a sample or "your location"', /Not chosen yet/.test(ride) && !/Sample point|Your current location/.test(ride), ride.slice(0, 160));
  check('Ride: no pickup marker on the map before a pickup exists', await ev(`!document.querySelector('.tab.on .map .leaflet-marker-pane .leaflet-marker-icon[style*="2F6FED"], .tab.on .map [style*="2F6FED"]')`));
  check('Ride: no vehicle count before a pickup', /Choose your pickup point to see which tricycles can come/.test(await txt('.tab.on .nearby')));
  check('Ride: no demo "use the sample point" shortcut', !(await p.$('[data-confirm-pickup]')));
  await p.click('.tab.on [data-ride="search"]'); await p.type('[data-q]', 'market'); await wait(150);
  check('destination search: no distances from an unchosen pickup', !(await p.$('[data-results] .km')));
  await p.click('[data-pick="d2"]'); await wait(150);
  check('direct ride: destination set, Review fare blocked until a pickup is chosen', /Market/.test(await txt('.dest-box')) && await ev(`document.querySelector('[data-review]').disabled`) && /Choose your pickup point first/.test(await txt('.tab.on .sheet')));
  // pickup by GPS
  await p.click('.tab.on [data-gps]'); await wait(600);
  check('pickup from GPS is labelled as GPS', /From your phone's GPS/.test(await txt('.pickup-box')), await txt('.pickup-box'));
  check('after a real pickup: vehicle line is honest (no simulated trikes in the real app)', /No tricycle online near this pickup/.test(await txt('.tab.on .nearby')), await txt('.tab.on .nearby'));
  // pickup by map tap
  const bb = await (await p.$('.tab.on .map')).boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + 110); await wait(250);
  check('pickup from a map tap is labelled as pinned', /Pinned by you on the map/.test(await txt('.pickup-box')), await txt('.pickup-box'));
  // pickup from the place picker: wording and ordering
  await p.click('.tab.on [data-pick-pickup]'); await wait(150);
  check('pickup search says it searches every place, not only nearby', (await p.getAttribute('[data-q]', 'placeholder')) === 'Search a place or landmark' && /not only those near you/.test(await txt('.tab.on .sheet')));
  check('pickup search: no distances while choosing the pickup', !(await p.$('[data-results] .km')));
  await p.type('[data-q]', 'hospital'); await wait(150);
  const hs = await p.$$eval('[data-results] .s', l => l.map(e => e.textContent));
  check('pickup search: each result shows its town', hs.length >= 2 && hs.every(s => /Buenavista|Jordan|Nueva Valencia|San Lorenzo|Sibunag/.test(s)), hs.join('|'));
  await p.click('[data-pick="d3"]'); await wait(200);
  check('pickup from the place picker is labelled', /Place you chose/.test(await txt('.pickup-box')) && /Hospital/.test(await txt('.pickup-box')));
  await p.click('[data-review]'); await wait(300);
  const fareShown = await txt('[data-option="terminal"] .price'), fareEngine = await ev(`(() => phones[0].quotes().qt.total)()`);
  check('Review fare: terminal fare equals the fare engine, unchanged', fareShown === '₱' + fareEngine.toFixed(2), `${fareShown} vs ${fareEngine}`);
  check('booking a trike is disabled when no tricycle is online (honest, nothing simulated)', await ev(`!document.querySelector('[data-option="pickup"]') || document.querySelector('[data-option="pickup"]').disabled`));

  /* ---------- 6b. pickup on an island: real route verdict, from that pickup ---------- */
  await ev(`(() => { const pl = byId(PLACES, 'dest_brgy_sibunag_inampologan'); phones[0].ride.pickup = { lat: pl.lat, lng: pl.lng, label: pl.name, src: 'place' }; })()`);
  await ev(`phones[0].openPage('place', 'dest_guisi_lighthouse')`); await wait(300);
  pg = await txt('.page');
  check('island pickup: place page says no route FROM your pickup, names it', /No tricycle route from your pickup point \(.*Inampologan.*\)/.test(pg) && !(await p.$('.page [data-ride-here]')), pg.slice(0, 240));
  await p.click('.page [data-back]');
  // a mainland pickup: the estimate is shown with its basis
  await ev(`(() => { const pl = byId(PLACES, 'd2'); phones[0].ride.pickup = { lat: pl.lat, lng: pl.lng, label: 'Buenavista New Terminal Market', src: 'place' }; })()`);
  await ev(`phones[0].openPage('place', 'dest_guisi_lighthouse')`); await wait(300);
  pg = await txt('.page');
  check('chosen pickup: estimate shown with its basis (nearest known stop, not door to door)', /Estimate from your pickup point/.test(pg) && /nearest to your pickup/.test(pg) && /Not a door-to-door measurement/.test(pg), pg.slice(0, 300));

  /* ---------- 8. Get a tricycle to this place ---------- */
  await ev(`phones[0].ride.pickup = defaultPickup(); phones[0].ride.stops = [];`);
  await p.click('.page [data-ride-here]'); await wait(300);
  check('Get a tricycle: Ride opens with the place as destination, nothing booked', await ev(`phones[0].tab === 'ride' && phones[0].ride.stops[0] === 'dest_guisi_lighthouse' && !phones[0].myRide()`) && /Guisi/.test(await txt('.dest-box')));
  check('Get a tricycle: pickup must still be chosen', /Not chosen yet/.test(await txt('.pickup-box')) && await ev(`document.querySelector('[data-review]').disabled`));

  /* ---------- driver in the real app: TODA approval, no self-confirm ---------- */
  await p.click('[data-go-tab="account"]'); await p.click('[data-logout]'); await wait(300);
  await p.click('[data-auth="role"]'); await p.click('[data-role="driver"]'); await p.click('[data-auth="signup"]');
  await p.fill('[name="name"]', 'Recheck Driver'); await p.fill('[name="mobile"]', '09995550124'); await p.fill('[name="password"]', 'password1');
  await p.fill('[name="unit"]', 'BTODA-0777'); await p.fill('[name="plate"]', '7777-AB'); await p.click('[data-signup]'); await wait(400);
  const dr = await txt('.tab.on .sheet');
  check('driver: waits for TODA approval, no "Confirm now (demo only)" button', /Waiting for TODA confirmation/.test(dr) && !(await p.$('[data-verify]')), dr.slice(0, 160));
  check('driver: cannot approve themselves through the hub', /approves your unit/.test((await ev(`H.run('verify', phones[0].account, {})`)).error || ''));

  /* ---------- narrow screen ---------- */
  await p.setViewportSize({ width: 320, height: 640 }); await wait(200);
  check('320 px wide: no horizontal page scroll', await ev(`document.documentElement.scrollWidth <= 320`));

  await b.close();
  for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok ? '' : '  -- ' + r.ev}`);
  console.log(`${res.filter(r => r.ok).length} passed, ${res.filter(r => !r.ok).length} failed; errors: ${errors.length}`, errors.slice(0, 3));
  process.exit(res.every(r => r.ok) && !errors.length ? 0 : 1);
})().catch(e => { console.error('CRASH', e.message); process.exit(2); });
