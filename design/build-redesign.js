// Builds design/panaw-redesign.html: one self-contained file with the app's real
// fare engine, route engine, data files and Leaflet inlined, so it opens by double-click.
// Run: node design/build-redesign.js
const fs = require('fs');
const path = require('path');

const app = path.join(__dirname, '..', 'trikefair_final', 'trikefair');
const read = p => fs.readFileSync(path.join(app, p), 'utf8');
const json = f => JSON.parse(read('data/' + f));

const data = {
  rules: json('rules.json'), municipalities: json('municipalities.json'), terminals: json('terminals.json'),
  destinations: json('destinations.json'), routes: json('routes.json'), fareRules: json('fare_rules.json'),
  demoVehicles: json('demo_vehicles.json'), transportModes: json('transport_modes.json'), basemap: json('basemap.json')
};

// function replacers so "$" in the sources is never treated as a pattern
const out = fs.readFileSync(path.join(__dirname, 'redesign.src.html'), 'utf8')
  .replace('/*@LEAFLET_CSS@*/', () => read('public/vendor/leaflet/leaflet.css'))
  .replace('/*@LEAFLET_JS@*/', () => read('public/vendor/leaflet/leaflet.js'))
  .replace('/*@FARE@*/', () => read('src/fare.js'))
  .replace('/*@NETWORK@*/', () => read('src/network.js'))
  .replace('/*@NETMAP@*/', () => read('public/netmap.js'))
  .replace('/*@HUB@*/', () => read('src/hub.js'))
  .replace('/*@DATA@*/', () => JSON.stringify(data).replace(/</g, '\\u003c'));

// the laptop design preview is the demo: sample accounts, simulated trikes, two phones side by side
fs.writeFileSync(path.join(__dirname, 'panaw-redesign.html'), out.replace('</head>', () => '<script>window.PANAW_DEMO = true;</script></head>'));
// the real app: the server's page at / and both APKs. No demo accounts or simulated trikes
fs.writeFileSync(path.join(app, 'public', 'app.html'), out);
console.log('wrote design/panaw-redesign.html', out.length, 'bytes');
