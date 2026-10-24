'use strict';
/* One-time helper: downloads the exact Google Fonts stylesheet the web app
   links to (Space Grotesk, Inter, JetBrains Mono) plus its .woff2 files into
   packaging/fonts/, so the APK renders the same typefaces with no internet.
   Run with:  node scripts/fetch-fonts.js                                    */

const fs = require('fs');
const path = require('path');

const CSS_URL = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap';
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const OUT = path.join(__dirname, '..', 'packaging', 'fonts');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();
  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g))];
  for (const url of urls) {
    const name = url.split('/').slice(-3).join('-');          // family-version-file.woff2
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(path.join(OUT, name), buf);
    css = css.split(url).join(name);
  }
  fs.writeFileSync(path.join(OUT, 'fonts.css'), css);
  console.log(`Saved fonts.css and ${urls.length} font files to ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
