// BUG-001 regression test: featured places must appear in FEATURED order (first = Guisi Lighthouse) in Explore and in Ride search suggestions.
const { chromium } = require('playwright-core');
const file = process.argv[2];
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto('file:///' + file.replace(/\\/g, '/')); await p.waitForTimeout(600);
  const r = await p.evaluate(() => {
    const P = phones[0];
    P.host.querySelector('[data-go-tab="explore"]').click();
    const explore = [...P.host.querySelectorAll('[data-place]')].slice(0, 3).map(e => e.dataset.place);
    P.host.querySelector('[data-go-tab="ride"]').click(); P.host.querySelector('[data-ride="search"]').click();
    const search = [...P.host.querySelectorAll('[data-pick]')].slice(0, 3).map(e => e.dataset.pick);
    return { featured: FEATURED.slice(0, 3), explore, search };
  });
  const ok = JSON.stringify(r.explore) === JSON.stringify(r.featured) && JSON.stringify(r.search) === JSON.stringify(r.featured);
  console.log(JSON.stringify(r), ok ? 'PASS' : 'FAIL');
  await b.close(); process.exit(ok ? 0 : 1);
})();
