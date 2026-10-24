// Builds design/panaw-prototype.html: one self-contained file with the app's real
// stylesheet, data files, fare engine, route engine and network map inlined.
// Run: node design/build-prototype.js
const fs = require('fs');
const path = require('path');

const app = path.join(__dirname, '..', 'trikefair_final', 'trikefair');
const read = p => fs.readFileSync(path.join(app, p), 'utf8');
const json = f => JSON.parse(read('data/' + f));

const data = {
  rules: json('rules.json'), municipalities: json('municipalities.json'), terminals: json('terminals.json'),
  destinations: json('destinations.json'), routes: json('routes.json'), fareRules: json('fare_rules.json'),
  demoVehicles: json('demo_vehicles.json'), transportModes: json('transport_modes.json')
};

// function replacers so "$" in the sources is never treated as a pattern
const out = fs.readFileSync(path.join(__dirname, 'prototype.src.html'), 'utf8')
  .replace('/*@STYLES@*/', () => read('public/styles.css'))
  .replace('/*@FARE@*/', () => read('src/fare.js'))
  .replace('/*@NETWORK@*/', () => read('src/network.js'))
  .replace('/*@NETMAP@*/', () => read('public/netmap.js'))
  .replace('/*@DATA@*/', () => JSON.stringify(data).replace(/</g, '\\u003c'));

fs.writeFileSync(path.join(__dirname, 'panaw-prototype.html'), out);
console.log('wrote design/panaw-prototype.html', out.length, 'bytes');
