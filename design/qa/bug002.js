// BUG-002 regression test: the "Are you safe?" buttons must stay the same element while the countdown runs, and a real click must register.
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto('file:///' + process.argv[2].split(String.fromCharCode(92)).join('/')); await p.waitForTimeout(600);
  await p.evaluate(async () => {
    const tick = () => new Promise(r => setTimeout(r, 0));   // actions resolve asynchronously since the hub can run on a server
    const [A, B] = phones; B.host.querySelector('[data-online="1"]').click();
    Object.values(Hub.drivers).filter(d => d.bot).forEach(d => d.status = 'busy');
    A.ride.stops = ['dest_jordan_center']; A.ride.step = 'options'; A.drawRideSheet(); A.host.querySelector('[data-confirm-pickup]').click(); A.host.querySelector('[data-book]').click(); await tick();
    B.host.querySelector('[data-job="accept"]').click(); await tick(); B.host.querySelector('[data-job="arrived"]').click(); await tick(); B.host.querySelector('[data-job="start"]').click(); await tick();
    H.simulateDetour(A.myRide(), 1.6);
  });
  await p.waitForSelector('#phone-a [data-safe]', { timeout: 15000 });
  await p.evaluate(() => { window.__safeBtn = document.querySelector('#phone-a [data-safe]'); });
  await p.waitForTimeout(2200);
  const same = await p.evaluate(() => document.querySelector('#phone-a [data-safe]') === window.__safeBtn);
  let clicked = true; try { await p.click('#phone-a [data-safe]', { timeout: 3000 }); } catch { clicked = false; }
  const logged = await p.evaluate(() => phones[0].myRide().safety.some(e => e.type === 'safe_confirmed'));
  console.log(JSON.stringify({ sameElementAfter2s: same, realClickWorked: clicked, safeLogged: logged }), same && clicked && logged ? 'PASS' : 'FAIL');
  await b.close(); process.exit(same && clicked && logged ? 0 : 1);
})();
