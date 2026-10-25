// Barangays grouped by town in Explore.
const { chromium } = require('playwright-core');
const file = 'file:///' + process.argv[2].split(String.fromCharCode(92)).join('/');
const res = [], errors = [], check = (n, ok, ev = '') => res.push({ n, ok: !!ok, ev: String(ev).slice(0, 160) });
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await p.goto(file); await p.waitForTimeout(700);
  const A = '#phone-a', txt = s => p.$eval(s, e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  await p.click(`${A} [data-go-tab="explore"]`);
  const towns = await p.$$eval(`${A} [data-brgy-town]`, l => l.map(e => e.dataset.brgyTown + ':' + e.querySelector('.s').textContent));
  check('Explore lists the 5 towns under Barangays', towns.length === 5, towns.join(' | '));
  check('official counts 36/14/22/12/14', towns.join() === 'buenavista:36 barangays,jordan:14 barangays,nueva_valencia:22 barangays,san_lorenzo:12 barangays,sibunag:14 barangays', towns.join());
  check('barangays not mixed into the place list', !(await p.$$eval(`${A} [data-grid] [data-place]`, l => l.some(e => /^dest_brgy|^d6$/.test(e.dataset.place)))));
  for (const [m, n] of [['buenavista', 36], ['jordan', 14], ['nueva_valencia', 22], ['san_lorenzo', 12], ['sibunag', 14]]) {
    await p.click(`${A} [data-brgy-town="${m}"]`);
    const rows = await p.$$(`${A} .page [data-place]`);
    const head = await txt(`${A} .page-head`);
    check(`${m}: page lists ${n} barangays`, rows.length === n && head.includes('Barangays of'), head + ' rows=' + rows.length);
    await p.click(`${A} .page [data-back]`);
  }
  await p.click(`${A} [data-brgy-town="sibunag"]`);
  check('island barangay marked "No road route"', /Inampologan No road route \(island\)/.test(await txt(`${A} .page`)));
  await p.click(`${A} .page [data-place="dest_brgy_sibunag_inampologan"]`);
  check('island place page: no Ride here, explains why', !(await p.$(`${A} .page [data-ride-here]`)) && /No tricycle route here/.test(await txt(`${A} .page`)));
  await p.click(`${A} .page [data-back]`); await p.click(`${A} .page [data-back]`);
  await p.click(`${A} [data-brgy-town="jordan"]`); await p.click(`${A} .page [data-place="dest_brgy_jordan_hoskyn"]`);
  check('barangay page: "Barangay Hoskyn · Jordan", PhilAtlas tag', /Barangay Hoskyn · Jordan/.test(await txt(`${A} .page`)) && /Location: PhilAtlas/.test(await txt(`${A} .page`)));
  await p.click(`${A} .page [data-ride-here]`);
  await p.click(`${A} [data-confirm-pickup]`); await p.click(`${A} [data-review]`);
  check('Get a tricycle from a barangay opens fares', await p.evaluate(() => phones[0].tab === 'ride' && phones[0].ride.stops[0] === 'dest_brgy_jordan_hoskyn' && !!document.querySelector('#phone-a [data-book]')));
  await p.click(`${A} [data-go-tab="explore"]`);
  await p.selectOption(`${A} [data-muni-select]`, "san_lorenzo");
  check('town filter lists that town\'s barangays directly', (await p.$$(`${A} [data-grid] [data-place^="dest_brgy_san_lorenzo"]`)).length === 12);
  await p.selectOption(`${A} [data-muni-select]`, "all");
  await p.fill(`${A} [data-explore-q]`, 'concordia'); await p.dispatchEvent(`${A} [data-explore-q]`, 'input');
  const found = await p.$$eval(`${A} [data-grid] [data-place]`, l => l.map(e => e.dataset.place));
  check('search finds barangays in any town (Concordia Norte + Sur)', found.length === 2, found.join());
  await p.fill(`${A} [data-explore-q]`, ''); await p.dispatchEvent(`${A} [data-explore-q]`, 'input');
  await p.click(`${A} [data-cat="Barangays"]`);
  check('Barangays chip shows the town rows', (await p.$$(`${A} [data-brgy-town]`)).length === 5);
  await b.close();
  for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok ? '' : '  -- ' + r.ev}`);
  console.log(`${res.filter(r => r.ok).length} passed, ${res.filter(r => !r.ok).length} failed; errors: ${errors.length}`, errors.slice(0, 3));
})().catch(e => { console.error('CRASH', e.message.split('\n')[0]); process.exit(2); });
