// Offline map check: with the network cut, the map must still draw Guimaras (stored OSM coastline and roads).
// node offline-map.js ../panaw-redesign.html [shot.png]
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, offline: true }), p = await c.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto('file:///' + process.argv[2].split(String.fromCharCode(92)).join('/')); await p.waitForTimeout(800);
  await p.click('[data-guest]'); await p.click('[data-go-tab="ride"]'); await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const cv = document.querySelector('.tab.on .leaflet-pane canvas'); if (!cv) return { canvas: false };
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let ink = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 0) ink++;
    return { canvas: true, ink, attribution: document.querySelector('.tab.on .leaflet-control-attribution').textContent.includes('OpenStreetMap') };
  });
  if (process.argv[3]) await p.screenshot({ path: process.argv[3] });
  const ok = r.canvas && r.ink > 2000 && r.attribution && !errors.length;
  console.log(JSON.stringify({ ...r, errors }), ok ? 'PASS' : 'FAIL');
  await b.close(); process.exit(ok ? 0 : 1);
})();
