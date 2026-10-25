// BUG-003 regression test: the "Are you safe?" buttons must stay the same element while the countdown runs, and a real click must register.
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto('file:///' + process.argv[2].split(String.fromCharCode(92)).join('/')); await p.waitForTimeout(600);
  await p.evaluate(() => {
    const [A, B] = phones; B.host.querySelector('[data-online="1"]').click();
    Object.values(Hub.drivers).filter(d => d.bot).forEach(d => d.status = 'busy');
    A.ride.stops = ['dest_jordan_center']; A.ride.step = 'options'; A.drawRideSheet(); A.host.querySelector('[data-confirm-pickup]').click(); A.host.querySelector('[data-book]').click();
    
    
  });
  await p.waitForSelector('#phone-b [data-job="accept"]', { timeout: 15000 });
  await p.evaluate(() => { window.__accBtn = document.querySelector('#phone-b [data-job="accept"]'); });
  await p.waitForTimeout(2200);
  const same = await p.evaluate(() => document.querySelector('#phone-b [data-job="accept"]') === window.__accBtn);
  let clicked = true; try { await p.click('#phone-b [data-job="accept"]', { timeout: 3000 }); } catch { clicked = false; }
  const logged = await p.evaluate(() => phones[0].myRide().status === 'accepted');
  console.log(JSON.stringify({ sameElementAfter2s: same, realClickWorked: clicked, accepted: logged }), same && clicked && logged ? 'PASS' : 'FAIL');
  await b.close(); process.exit(same && clicked && logged ? 0 : 1);
})();
