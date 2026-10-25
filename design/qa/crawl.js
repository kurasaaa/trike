// Visits every reachable screen of the PANAW redesign, screenshots it, and inventories its interactive controls.
// usage: node crawl.js <html file> <out dir>
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const [file, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const inventory = {}, errors = [];
  async function page(w, h) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', e => errors.push(`[${w}] pageerror: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`[${w}] console: ${m.text()}`); });
    await p.goto('file:///' + file.replace(/\\/g, '/'));
    await p.waitForTimeout(800);
    return p;
  }
  // controls inside one phone
  const controls = (p, sel) => p.$$eval(`${sel} button, ${sel} a[href], ${sel} input, ${sel} select, ${sel} textarea, ${sel} summary`, els => els
    .filter(e => e.offsetParent !== null || e.tagName === 'SUMMARY')
    .map(e => {
      const data = [...e.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name + (a.value ? '=' + a.value : '')).join(' ');
      const r = e.getBoundingClientRect();
      return { tag: e.tagName.toLowerCase(), type: e.type || '', name: e.getAttribute('name') || '', data,
        text: (e.innerText || e.value || e.getAttribute('aria-label') || e.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 50),
        label: e.getAttribute('aria-label') || '', w: Math.round(r.width), h: Math.round(r.height), disabled: !!e.disabled };
    }));
  async function snap(p, name, sel) {
    await p.waitForTimeout(350);
    const el = sel ? await p.$(sel) : null;
    await (el || p).screenshot({ path: path.join(out, name + '.png') });
    inventory[name] = await controls(p, sel || 'body');
  }
  const ev = (p, js) => p.evaluate(js);

  // ---------- laptop: passenger + driver phones ----------
  const L = await page(1280, 900);
  const A = '#phone-a', B = '#phone-b';
  await snap(L, 'L-passenger-ride-home', A);
  await snap(L, 'L-driver-drive-offline', B);
  await ev(L, `phones[0].host.querySelector('[data-ride="search"]').click()`); await snap(L, 'L-passenger-ride-search', A);
  await ev(L, `(() => { const P = phones[0]; P.ride.stops = ['d7']; P.ride.step = 'options'; P.drawRideSheet(); })()`); await snap(L, 'L-passenger-ride-options', A);
  await ev(L, `phones[0].host.querySelector('[data-fare-opts]').click()`); await snap(L, 'L-passenger-fare-modal', A);
  await ev(L, `phones[0].host.querySelector('[data-mod="done"]').click()`);
  await ev(L, `phones[1].host.querySelector('[data-online="1"]').click()`); await snap(L, 'L-driver-drive-online', B);
  await ev(L, `Object.values(Hub.drivers).filter(d => d.bot).forEach(d => d.status = 'busy'); phones[0].host.querySelector('[data-book]').click()`);
  await snap(L, 'L-passenger-ride-requested', A); await snap(L, 'L-driver-request', B);
  await ev(L, `phones[1].host.querySelector('[data-job="accept"]').click()`); await snap(L, 'L-passenger-ride-accepted', A); await snap(L, 'L-driver-accepted', B);
  await ev(L, `phones[1].host.querySelector('[data-job="arrived"]').click()`); await snap(L, 'L-passenger-ride-arrived', A);
  await ev(L, `phones[1].host.querySelector('[data-job="start"]').click()`); await snap(L, 'L-passenger-ride-ontrip', A); await snap(L, 'L-driver-ontrip', B);
  await ev(L, `phones[0].host.querySelector('[data-share]').click()`); await snap(L, 'L-passenger-share-modal', A);
  await ev(L, `phones[0].host.querySelector('[data-close-modal]').click(); phones[0].host.querySelector('[data-report]').click()`); await snap(L, 'L-passenger-report-modal', A);
  await ev(L, `phones[0].host.querySelector('[data-close-modal]').click()`);
  await ev(L, `phones[1].host.querySelector('[data-job="complete"]').click()`); await snap(L, 'L-passenger-ride-done', A);
  await ev(L, `phones[0].host.querySelector('[data-ride-new]').click()`);
  // terminal ticket
  await ev(L, `(() => { const P = phones[0]; P.ride.stops = ['dest_jordan_center']; P.ride.option = 'terminal'; P.ride.step = 'options'; P.drawRideSheet(); P.host.querySelector('[data-confirm-pickup]').click(); P.host.querySelector('[data-book]').click(); })()`);
  await snap(L, 'L-passenger-ticket', A);
  await ev(L, `phones[0].host.querySelector('[data-ride-new]').click()`);
  // vehicles
  await ev(L, `phones[0].host.querySelector('[data-go-tab="explore"]').click(); phones[0].host.querySelector('[data-hire="van"]').click()`); await snap(L, 'L-passenger-hire-van', A); await ev(L, `phones[0].host.querySelector('.page [data-back]').click(); phones[0].host.querySelector('[data-go-tab="ride"]').click()`);
  await ev(L, `phones[0].host.querySelector('[data-vehicle="tricycle"]') && phones[0].host.querySelector('[data-vehicle="tricycle"]').click()`);
  // explore + pages
  await ev(L, `phones[0].host.querySelector('[data-go-tab="explore"]').click()`); await snap(L, 'L-passenger-explore', A);
  await ev(L, `phones[0].host.querySelector('[data-place="dest_trappist_abbey"]').click()`); await snap(L, 'L-passenger-place', A);
  await ev(L, `phones[0].host.querySelector('[data-back]').click(); phones[0].host.querySelector('[data-page="list"]').click()`); await snap(L, 'L-passenger-list-place', A);
  await ev(L, `phones[0].host.querySelector('[data-back]').click(); phones[0].host.querySelector('[data-go-tab="account"]').click()`); await snap(L, 'L-passenger-account', A);
  for (const pg of ['history', 'mine', 'contacts', 'reports', 'fares', 'assoc', 'tourism', 'offline', 'about']) {
    await ev(L, `(() => { const b = phones[0].host.querySelector('[data-page="${pg}"]'); if (b) b.click(); })()`);
    await snap(L, 'L-passenger-page-' + pg, A);
    await ev(L, `(() => { const b = phones[0].host.querySelector('.page [data-back]'); if (b) b.click(); })()`);
  }
  await ev(L, `phones[0].host.querySelector('[data-page="history"]').click(); (phones[0].host.querySelector('[data-receipt]') || {click(){}}).click()`); await snap(L, 'L-passenger-page-receipt', A);
  await ev(L, `phones[1].host.querySelector('[data-go-tab="earnings"]').click()`); await snap(L, 'L-driver-earnings', B);
  await ev(L, `phones[1].host.querySelector('[data-go-tab="account"]').click()`); await snap(L, 'L-driver-account', B);
  await ev(L, `phones[1].host.querySelector('[data-page="vehicle"]').click()`); await snap(L, 'L-driver-page-vehicle', B);
  // operator
  await ev(L, `(() => { const P = phones[1]; P.logout(); P.auth.step = 'login'; P.renderAuth(); })()`); await snap(L, 'L-auth-login', B);
  await ev(L, `(() => { const P = phones[1]; P.q('[name="mobile"]').value = '09191234567'; P.q('[name="password"]').value = 'demo1234'; P.q('[data-login]').click(); })()`);
  await snap(L, 'L-operator-vehicle', B);
  await L.close();

  // ---------- phone width: one phone, auth flow ----------
  const M = await page(390, 844);
  await snap(M, 'M-auth-welcome', '#phone-a');
  await ev(M, `phones[0].host.querySelector('[data-auth="role"]').click()`); await snap(M, 'M-auth-role', '#phone-a');
  for (const r of ['passenger', 'driver', 'operator']) {
    await ev(M, `(() => { const P = phones[0]; P.auth.step = 'signup'; P.auth.role = '${r}'; P.renderAuth(); })()`); await snap(M, 'M-auth-signup-' + r, '#phone-a');
  }
  await ev(M, `(() => { const P = phones[0]; P.auth.step = 'welcome'; P.renderAuth(); P.q('[data-guest]').click(); })()`); await snap(M, 'M-guest-explore', '#phone-a');
  await ev(M, `phones[0].host.querySelector('[data-go-tab="ride"]').click()`); await snap(M, 'M-guest-ride', '#phone-a');
  await ev(M, `phones[0].host.querySelector('[data-go-tab="account"]').click()`); await snap(M, 'M-guest-account', '#phone-a');
  await M.close();

  await browser.close();
  fs.writeFileSync(path.join(out, 'inventory.json'), JSON.stringify(inventory, null, 1));
  fs.writeFileSync(path.join(out, 'errors.txt'), errors.join('\n'));
  const total = Object.values(inventory).reduce((s, l) => s + l.length, 0);
  console.log('screens', Object.keys(inventory).length, 'controls (with repeats)', total, 'errors', errors.length);
  if (errors.length) console.log(errors.slice(0, 10).join('\n'));
})().catch(e => { console.error('CRAWL FAILED', e); process.exit(1); });
