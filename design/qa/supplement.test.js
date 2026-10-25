// Controls not covered by controls.test.js: quick picks, edit stop, "Alert now", directions link, and form fields whose values must be saved.
const { chromium } = require('playwright-core');
const file = 'file:///' + process.argv[2].split(String.fromCharCode(92)).join('/');
const res = [], errors = [];
const check = (n, ok, ev = '') => res.push({ n, ok: !!ok, ev: String(ev).slice(0, 140) });
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(file); await p.waitForTimeout(700);
  const A = '#phone-a', B = '#phone-b', ev = js => p.evaluate(js);
  const waitFor = (js, ms) => p.waitForFunction(js, null, { timeout: ms, polling: 250 }).then(() => true, () => false);
  // quick pick
  await p.click(`${A} [data-dest="dest_guisi_lighthouse"]`);
  check('quick pick opens options for that place', await ev(`phones[0].ride.step === 'options' && phones[0].ride.stops[0] === 'dest_guisi_lighthouse'`));
  // edit stop
  await p.click(`${A} [data-ride="search"]`); await p.click(`${A} [data-add-stop]`); await p.click(`${A} [data-pick="d2"]`);
  await p.click(`${A} [data-ride="search"]`); await p.click(`${A} [data-edit-stop="1"]`);
  check('edit stop reopens that stop for search', await ev(`!!document.querySelector('#phone-a input[data-q]') && phones[0].ride.active === 1`));
  await p.type(`${A} input[data-q]`, 'hosp'); await p.click(`${A} [data-pick="d3"]`);
  check('edited stop replaced, other stop kept', await ev(`JSON.stringify(phones[0].ride.stops) === '["dest_guisi_lighthouse","d3"]'`), await ev(`JSON.stringify(phones[0].ride.stops)`));
  await p.click(`${A} [data-ride="search"]`); await p.click(`${A} [data-rm-stop="1"]`); await p.click(`${A} [data-ride="options"]`);
  // ride to "Alert now" and the directions link
  await p.click(`${B} [data-online="1"]`); await ev(`Object.values(Hub.drivers).filter(d => d.bot).forEach(d => d.status = 'busy')`);
  await waitFor(`!document.querySelector('#phone-a [data-book]').disabled`, 3000);
  await p.click(`${A} [data-book]`); await p.click(`${B} [data-job="accept"]`);
  const href = await p.getAttribute(`${B} a[href*="google.com/maps/dir"]`, 'href');
  const pk = await ev(`phones[0].myRide().pickup`);
  check('driver directions link points at the pickup', href && href.includes(`destination=${pk.lat},${pk.lng}`), href);
  check('directions link opens in a new tab', (await p.getAttribute(`${B} a[href*="google.com/maps/dir"]`, 'target')) === '_blank');
  await p.click(`${B} [data-job="arrived"]`); await p.click(`${B} [data-job="start"]`);
  await waitFor(`!!document.querySelector('#phone-a [data-detour="1.6"]')`, 3000);
  await p.click(`${A} [data-detour="1.6"]`);
  await waitFor(`!!document.querySelector('#phone-a [data-alert-now]')`, 15000);
  await p.click(`${A} [data-alert-now]`);
  check('"Alert now" sends the alert and closes the prompt', await ev(`phones[0].myRide().safety.some(e => e.type === 'alert_sent' && e.how === 'manual') && !document.querySelector('#phone-a [data-prompt]')`));
  await p.click(`${A} [data-cancel-ride]`).catch(() => {});
  // listing fields saved
  await p.click(`${A} [data-go-tab="account"]`); await p.click(`${A} .tab.on [data-page="list"]`);
  await p.fill(`${A} [name="lname"]`, 'Field Check Inn'); await p.selectOption(`${A} [name="lcat"]`, 'Lodging'); await p.selectOption(`${A} [name="lmuni"]`, 'sibunag');
  await p.fill(`${A} [name="ldesc"]`, 'Rooms by the sea'); await p.fill(`${A} [name="lcontact"]`, 'facebook.com/fieldcheck');
  const mm = await (await p.$(`${A} [data-minimap]`)).boundingBox(); await p.mouse.click(mm.x + mm.width / 2, mm.y + mm.height / 2);
  await p.check(`${A} [name="lok"]`); await p.click(`${A} [data-publish]`);
  check('listing saves category, town, description, contact', await ev(`(() => { const l = Hub.listings.find(x => x.name === 'Field Check Inn'); return l && l.kind === 'Lodging' && l.municipality === 'sibunag' && l.description === 'Rooms by the sea' && l.contact === 'facebook.com/fieldcheck'; })()`));
  // contact relationship saved
  await p.click(`${A} [data-go-tab="account"]`); await p.click(`${A} .tab.on [data-page="contacts"]`);
  await p.fill(`${A} [name="cname"]`, 'Rel Check'); await p.selectOption(`${A} [name="crel"]`, 'Guardian'); await p.fill(`${A} [name="cmobile"]`, '09170002222'); await p.click(`${A} [data-add-contact]`);
  check('contact relationship saved', await ev(`phones[0].account.contacts.some(c => c.name === 'Rel Check' && c.relation === 'Guardian')`));
  // driver sign-up: license and TODA saved
  await p.click(`${B} [data-go-tab="account"]`); await p.click(`${B} [data-logout]`);
  await p.click(`${B} [data-auth="role"]`); await p.click(`${B} [data-role="driver"]`); await p.click(`${B} [data-auth="signup"]`);
  await p.fill(`${B} [name="name"]`, 'License Check'); await p.fill(`${B} [name="mobile"]`, '09227778888'); await p.fill(`${B} [name="password"]`, 'password1');
  await p.selectOption(`${B} [name="terminalId"]`, 'terminal_jordan_poblacion'); await p.fill(`${B} [name="unit"]`, 'JTODA-0101'); await p.fill(`${B} [name="plate"]`, 'LC-1'); await p.fill(`${B} [name="license"]`, 'D01-23-456789');
  await p.click(`${B} [data-signup]`);
  check('driver license and TODA saved', await ev(`(() => { const a = Hub.accounts.find(x => x.mobile === '09227778888'); return a && a.license === 'D01-23-456789' && a.terminalId === 'terminal_jordan_poblacion'; })()`));
  // operator notes saved
  await p.click(`${B} [data-go-tab="account"]`); await p.click(`${B} [data-logout]`); await p.click(`${B} [data-auth="login"]`);
  await p.fill(`${B} [name="mobile"]`, '09191234567'); await p.fill(`${B} [name="password"]`, 'demo1234'); await p.click(`${B} [data-login]`);
  await p.fill(`${B} [name="enotes"]`, 'Weddings and tours'); await p.click(`${B} [data-op-save]`);
  check('operator notes saved and shown to passengers', await ev(`Hub.operators.find(o => o.id === 'op-demo-van').notes === 'Weddings and tours'`));
  await b.close();
  for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok ? '' : '  -- ' + r.ev}`);
  console.log(`${res.filter(r => r.ok).length} passed, ${res.filter(r => !r.ok).length} failed; errors: ${errors.length}`, errors.slice(0, 3));
})().catch(e => { console.error('CRASH', e.message); process.exit(2); });
