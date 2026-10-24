'use strict';
/* ============================================================================
   Builds www/ — the folder Capacitor bundles into the APK.

   The web app in trikefair_final/trikefair is the source of truth. This
   script copies it and adds only the packaging layer:

     1. public/*            copied as-is (HTML, CSS, JS, vendor/qrcode.js)
     2. fonts/              the same Google Fonts, bundled for offline use
     3. embedded/           the unmodified src/fare.js, src/trips.js and
                            src/network.js, data/rules.json and the Guimaras
                            network files (data/*.json), plus a small runtime
                            that answers the app's /api/* calls on the phone
     4. lib/network.js      the route engine, which the pages also load
                            directly (the Node server serves it from src/)
     5. In the COPIED html: the Google Fonts <link> points at fonts/fonts.css,
                            the embedded scripts load before the app's own,
                            and the driver/monitor links name their .html file.

   node scripts/build-www.js            LOCAL DEMO MODE: the backend runs on the phone
   node scripts/build-www.js --online   the pages call the hosted server named in
                                        packaging/environments.json (or --api <url>)
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const APP     = path.join(ROOT, 'trikefair_final', 'trikefair');
const PUBLIC  = path.join(APP, 'public');
const PACK    = path.join(ROOT, 'packaging');
const WWW     = path.join(ROOT, 'www');

const ONLINE = process.argv.includes('--online');
const API = !ONLINE ? '' : String(process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : JSON.parse(fs.readFileSync(path.join(PACK, 'environments.json'), 'utf8')).online.apiOrigin).replace(/\/+$/, '');
// the phone loads its pages over https://localhost, so a plain-http or private address would be blocked or unreachable
if (ONLINE && !/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?$/i.test(API)) {
  throw new Error('build-www: --online needs a public https:// server address, got ' + API);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name), dst = path.join(to, entry.name);
    entry.isDirectory() ? copyDir(src, dst) : fs.copyFileSync(src, dst);
  }
}
function mustReplace(html, find, replacement, file) {
  if (!html.includes(find)) throw new Error(`build-www: expected text not found in ${file}: ${find}`);
  return html.split(find).join(replacement);
}

/* 1. fresh copy of the web app */
fs.rmSync(WWW, { recursive: true, force: true });
copyDir(PUBLIC, WWW);

/* 2. offline fonts */
copyDir(path.join(PACK, 'fonts'), path.join(WWW, 'fonts'));
// JetBrains Mono has no peso sign (U+20B1). Desktop browsers fall back to a
// system font that has one; Android's monospace font does not, so every ₱ in
// the fare meter/amounts rendered as a box. Draw just that one character from
// the bundled Inter file that contains it (checked: latin-ext subset).
const PESO_FONT = 'inter-v20-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7W0Q5n-wU.woff2';
if (!fs.existsSync(path.join(WWW, 'fonts', PESO_FONT))) throw new Error('build-www: peso fallback font missing');
// Chrome only merges faces whose descriptors match exactly, so mirror each
// weight Google declares for JetBrains Mono (500/600/700) rather than a range.
fs.appendFileSync(path.join(WWW, 'fonts', 'fonts.css'),
  `\n/* Android: peso sign for JetBrains Mono (which lacks it) */\n` +
  [500, 600, 700].map(w =>
    `@font-face {\n  font-family: 'JetBrains Mono';\n  font-style: normal;\n  font-weight: ${w};\n  font-display: swap;\n` +
    `  src: url(${PESO_FONT}) format('woff2');\n  unicode-range: U+20B1;\n}\n`).join(''));

/* 3. embedded backend */
const EMB = path.join(WWW, 'embedded');
fs.mkdirSync(EMB, { recursive: true });
fs.copyFileSync(path.join(PACK, 'embedded', 'runtime.js'), path.join(EMB, 'runtime.js'));
fs.copyFileSync(path.join(PACK, 'embedded', 'server.js'),  path.join(EMB, 'server.js'));

const wrap = (name, file) =>
  `__tfDefine(${JSON.stringify(name)}, function (module, exports, require, Buffer, process) {\n` +
  fs.readFileSync(path.join(APP, file), 'utf8') +
  `\n});\n`;
const rules = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'rules.json'), 'utf8'));
// The network files, assembled exactly as the Node server's db.js does it.
const { assembleNetwork, NETWORK_FILES } = require(path.join(APP, 'src', 'db.js'));
const netFiles = {};
for (const [k, file] of Object.entries(NETWORK_FILES)) {
  netFiles[k] = JSON.parse(fs.readFileSync(path.join(APP, 'data', file), 'utf8'));
}
fs.writeFileSync(path.join(EMB, 'modules.js'),
  '/* GENERATED by scripts/build-www.js — verbatim copies of src/fare.js, src/trips.js, src/network.js and the data/ files. */\n' +
  `window.__TF_BASE_RULES__ = ${JSON.stringify(rules, null, 2)};\n` +
  `window.__TF_NETWORK__ = ${JSON.stringify(assembleNetwork(netFiles), null, 2)};\n` +
  wrap('./fare', 'src/fare.js') +
  wrap('./network', 'src/network.js') +
  wrap('./places', 'src/places.js') +
  wrap('./pickups', 'src/pickups.js') +
  wrap('./trips', 'src/trips.js'));

/* 3b. the route engine for the pages themselves */
fs.mkdirSync(path.join(WWW, 'lib'), { recursive: true });
fs.copyFileSync(path.join(APP, 'src', 'network.js'), path.join(WWW, 'lib', 'network.js'));
fs.copyFileSync(path.join(APP, 'src', 'fare.js'), path.join(WWW, 'lib', 'fare.js'));

/* 4. wire the copied pages */
const GOOGLE_FONTS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
];
const GOOGLE_CSS = /<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]+" rel="stylesheet">/;
const EMBEDDED_SCRIPTS = ONLINE
  ? `<script>window.PANAW_API = ${JSON.stringify(API)};</script>\n<script src="/online.js"></script>\n`
  : '<script src="/embedded/runtime.js"></script>\n' +
    '<script src="/embedded/modules.js"></script>\n' +
    '<script src="/embedded/server.js"></script>\n';
if (ONLINE) {
  fs.copyFileSync(path.join(PACK, 'online.js'), path.join(WWW, 'online.js'));
  fs.rmSync(path.join(WWW, 'embedded'), { recursive: true, force: true });   // unused: the hosted server answers /api
}
// The Node server maps /driver → driver.html and /monitor → monitor.html.
// Capacitor serves index.html for extension-less paths, so the copied links
// must name the file directly.
const PAGE_LINK = /href="\/(driver|monitor)"/g;

for (const file of fs.readdirSync(WWW).filter(f => f.endsWith('.html'))) {
  const p = path.join(WWW, file);
  let html = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  for (const line of GOOGLE_FONTS) html = mustReplace(html, line, '', file);
  if (!GOOGLE_CSS.test(html)) throw new Error(`build-www: Google Fonts link not found in ${file}`);
  html = html.replace(GOOGLE_CSS, '<link rel="stylesheet" href="/fonts/fonts.css">');
  html = mustReplace(html, '</head>', EMBEDDED_SCRIPTS + '</head>', file);
  if (file === 'index.html' && !html.includes('href="/driver"')) throw new Error('build-www: driver link not found in index.html');
  html = html.replace(PAGE_LINK, 'href="/$1.html"');
  fs.writeFileSync(p, html);
}

console.log('www/ built from', path.relative(ROOT, PUBLIC), ONLINE ? '· ONLINE → ' + API : '· LOCAL DEMO MODE');
