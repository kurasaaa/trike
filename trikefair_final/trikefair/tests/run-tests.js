'use strict';
/* ============================================================================
   PANAW tests — zero dependencies.      node tests/run-tests.js

   1. Fare regression   every input combination, compared with the outputs the
                        ORIGINAL code produced before the Guimaras expansion
                        (tests/fixtures/fare-golden.json, generated from the
                        untouched fare engine and the pre-expansion rules.json)
   2. Route engine      the cases CLAUDE.md §55 asks for, plus closures
   3. Data validation   broken data is reported, not fatal
   4. API               a real server.js, run from a temporary copy of the app
                        so the tests never write to this folder's data/
   ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..');
const fare = require('../src/fare');
const trips = require('../src/trips');
const network = require('../src/network');
const db = require('../src/db');

const results = [];
async function test(group, name, fn) {
  try { await fn(); results.push({ group, name, ok: true }); }
  catch (e) { results.push({ group, name, ok: false, err: e.message }); }
}
const clone = o => JSON.parse(JSON.stringify(o));
const stripTime = f => { const c = { ...f }; delete c.computedAt; return c; };

(async function main() {
  const rules = db.rules();
  const raw = db.networkData();
  const { network: net, report } = network.validate(raw, rules);

  /* ---------------------------------------------------------------- 1 */
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fare-golden.json'), 'utf8'));
  const preRules = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'rules.pre-expansion.json'), 'utf8'));

  await test('Fare regression', 'rules.json is unchanged from before the expansion', () => {
    const now = clone(rules);
    // The two Rules-screen demo toggles may legitimately be flipped by a user.
    for (const k of ['nightSurchargeEnabled', 'simulateNight']) { delete now[k]; delete preRules[k]; }
    assert.deepStrictEqual(now, preRules);
  });

  for (const viaTerminal of [false, true]) {
    await test('Fare regression',
      `${golden.length} golden cases, ${viaTerminal ? 'terminalId = New Poblacion' : 'no terminalId (old clients)'}`, () => {
      let checked = 0;
      for (const c of golden) {
        const r = { ...rules, nightSurchargeEnabled: c.nightEnabled, simulateNight: false };
        const body = viaTerminal ? { ...c.input, terminalId: 'terminal_buenavista_poblacion' } : c.input;
        const res = network.resolveTrip(r, net, body);
        assert.ok(!res.error, `${c.input.destinationId}: ${res.error}`);
        const out = fare.computeFare({ ...body, distanceKm: res.route.distanceKm }, res.fareRules, new Date(c.at));
        assert.deepStrictEqual(stripTime(out), c.fare, `mismatch for ${JSON.stringify(c.input)} ${c.time}`);
        checked++;
      }
      assert.strictEqual(checked, golden.length);
    });
  }

  await test('Fare regression', 'legacy createTrip path and route path lock the same fare', () => {
    for (const d of rules.destinations) {
      const body = { destinationId: d.id, passengers: 3, discountedPax: 1, discountType: 'senior', hireType: 'regular' };
      const legacy = trips.createTrip(body, rules).trip;
      const routed = trips.createTrip(body, rules, network.resolveTrip(rules, net, body)).trip;
      assert.deepStrictEqual(stripTime(routed.fare), stripTime(legacy.fare));
      assert.strictEqual(routed.destination.km, legacy.destination.km);
    }
  });

  await test('Fare regression', 'browser fallback (app.js localCompute) still matches the server engine', () => {
    // localCompute is a hand-kept mirror of fare.js; run it in isolation.
    const src = fs.readFileSync(path.join(APP, 'public', 'app.js'), 'utf8');
    const body = src.slice(src.indexOf('function localIsNight'), src.length);
    const S = { rules };
    const mk = new Function('S', 'termRules', body + '\nreturn localCompute;');
    const localCompute = mk(S, () => rules);
    for (const d of rules.destinations) for (const hireType of ['regular', 'special']) {
      const input = { distanceKm: d.km, passengers: 2, discountedPax: 1, discountType: 'student', hireType };
      const a = localCompute(input), b = fare.computeFare(input, rules);
      assert.strictEqual(a.total, b.total, `${d.id} ${hireType}`);
    }
  });

  /* ---------------------------------------------------------------- 2 */
  const T = 'terminal_buenavista_poblacion';
  await test('Route engine', 'shipped data validates with no errors', () => {
    assert.ok(report.ok, report.errors.join('; '));
  });
  await test('Route engine', 'all five municipalities exist and each has a terminal', () => {
    const names = net.municipalities.map(m => m.name).sort();
    assert.deepStrictEqual(names, ['Buenavista', 'Jordan', 'Nueva Valencia', 'San Lorenzo', 'Sibunag']);
    for (const m of net.municipalities) assert.ok(network.terminalsFor(net, m.id).length >= 1, m.name);
  });
  await test('Route engine', 'terminal list is filtered by municipality', () => {
    for (const m of net.municipalities) {
      for (const t of network.terminalsFor(net, m.id)) assert.strictEqual(t.municipality, m.id);
    }
  });
  await test('Route engine', 'destination list is filtered by terminal', () => {
    const jordan = network.destinationsFor(net, 'terminal_jordan_poblacion').map(d => d.id);
    assert.ok(jordan.includes('d8') && !jordan.includes('d1'));
  });
  await test('Route engine', 'Terminal A → Destination A (direct segment)', () => {
    const r = network.findRoute(net, T, 'd2');
    assert.ok(r.found); assert.strictEqual(r.distanceKm, 1.9); assert.deepStrictEqual(r.nodeIds, [T, 'd2']);
  });
  await test('Route engine', 'Terminal A → Destination B (through an intermediate place)', () => {
    const r = network.findRoute(net, 'd4', 'd2');
    assert.ok(r.found); assert.deepStrictEqual(r.nodeIds, ['d4', T, 'd2']); assert.strictEqual(r.distanceKm, 6.5);
  });
  await test('Route engine', 'Municipality A → Municipality B (Buenavista → Jordan → Nueva Valencia)', () => {
    const r = network.findRoute(net, T, 'center_nueva_valencia');
    assert.ok(r.found && r.crossesMunicipalities);
    assert.deepStrictEqual(r.municipalityNames, ['Buenavista', 'Jordan', 'Nueva Valencia']);
    assert.strictEqual(r.distanceKm, 32.1);   // OSRM road distances (routes.json 'osm' segments)
  });
  await test('Route engine', 'picks the shorter of two ways round the island', () => {
    const r = network.findRoute(net, 'center_sibunag', 'center_jordan');
    assert.deepStrictEqual(r.nodeIds, ['center_sibunag', 'center_nueva_valencia', 'center_jordan']); // 35.4 km, not 50.0
  });
  await test('Route engine', 'an unavailable segment is avoided', () => {
    const r = network.findRoute(net, T, 'center_nueva_valencia', { overrides: { e_jordan_nv: { available: false } } });
    assert.ok(r.found);
    assert.ok(!r.segments.some(s => s.id === 'e_jordan_nv'));
    assert.deepStrictEqual(r.municipalityNames, ['Buenavista', 'San Lorenzo', 'Sibunag', 'Nueva Valencia']);
  });
  await test('Route engine', 'No available route (all ways closed)', () => {
    const r = network.findRoute(net, T, 'center_nueva_valencia',
      { overrides: { e_jordan_nv: { available: false }, e_nv_sibunag: { available: false } } });
    assert.strictEqual(r.found, false); assert.ok(/no configured route/i.test(r.reason));
  });
  await test('Route engine', 'No route: destination has no verified coordinates', () => {
    const n = clone(net); n.destinations.find(d => d.id === 'dest_guisi_lighthouse').nodeId = null;   // shipped data now has its OSM point
    const r = network.resolveTrip(rules, n, { terminalId: 'terminal_nueva_valencia_poblacion', destinationId: 'dest_guisi_lighthouse' });
    assert.strictEqual(r.error, 'NO ROUTE AVAILABLE'); assert.ok(r.noRoute && /Coordinates required/.test(r.reason));
  });
  await test('Route engine', 'Invalid destination', () => {
    assert.strictEqual(network.resolveTrip(rules, net, { terminalId: T, destinationId: 'nope' }).error, 'Unknown destination.');
    assert.strictEqual(network.resolveTrip(rules, net, { terminalId: 'nope', destinationId: 'd1' }).error, 'Unknown terminal.');
    assert.strictEqual(network.findRoute(net, T, 'nope').found, false);
  });
  await test('Route engine', 'a terminal cannot be used for a destination it does not serve', () => {
    const r = network.resolveTrip(rules, net, { terminalId: 'terminal_sibunag_poblacion', destinationId: 'd1' });
    assert.ok(/does not serve/.test(r.error));
  });
  await test('Route engine', 'Disconnected route graph', () => {
    const n = clone(net);
    n.nodes.push({ id: 'island', name: 'Isolated islet', type: 'destination', municipality: 'sibunag', lat: 10.45, lng: 122.6 });
    const r = network.findRoute(n, T, 'island');
    assert.strictEqual(r.found, false);
  });
  await test('Route engine', 'never throws for any pair of places', () => {
    const ids = net.nodes.map(n => n.id).concat(['', null, undefined, 'x']);
    for (const a of ids) for (const b of ids) network.findRoute(net, a, b);
  });
  await test('Route engine', 'time-weighted cost is configurable', () => {
    const n = clone(net); n.settings.costWeights = { distance: 0, time: 1 };
    const r = network.findRoute(n, T, 'd2');
    assert.ok(r.found); assert.strictEqual(r.cost, 6);
  });
  await test('Route engine', 'demo terminals use the DEMO / SAMPLE RATE rule; New Poblacion uses rules.json', () => {
    const a = network.resolveTrip(rules, net, { terminalId: 'terminal_jordan_poblacion', destinationId: 'd8' });
    assert.ok(a.fareRule.isDemo); assert.strictEqual(a.fareRule.status, 'DEMO / SAMPLE RATE');
    const b = network.resolveTrip(rules, net, { terminalId: T, destinationId: 'd8' });
    assert.ok(!b.fareRule.isDemo); assert.strictEqual(b.fareRules, rules);
  });
  await test('Pick-up', 'an unanswered request expires after 2 minutes', () => {
    const pickups = require('../src/pickups');
    const p = { status: 'requested', createdAt: new Date(0).toISOString() };
    assert.strictEqual(pickups.statusAt(p, pickups.EXPIRE_MS - 1), 'requested');
    assert.strictEqual(pickups.statusAt(p, pickups.EXPIRE_MS + 1), 'expired');
    assert.ok(/expired/.test(pickups.move(p, 'accept', pickups.EXPIRE_MS + 1)));
  });
  await test('Route engine', 'demo vehicles stay on their path and are flagged demo', () => {
    for (const v of net.demoVehicles) for (const t of [0, 1e5, 3e5, 7e5]) {
      const p = network.simulateDemoVehicle(v, net, t);
      assert.ok(p && p.demo && Number.isFinite(p.latitude), v.vehicleId);
    }
  });

  /* ---------------------------------------------------------------- 3 */
  const bad = (mutate) => { const n = clone(raw); mutate(n); return network.validate(n, rules).report; };
  await test('Data validation', 'duplicate ids', () => {
    const r = bad(n => n.terminals.push(clone(n.terminals[1])));
    assert.ok(r.errors.some(e => /duplicate id/.test(e)));
  });
  await test('Data validation', 'invalid municipality id', () => {
    const r = bad(n => { n.terminals[2].municipality = 'atlantis'; });
    assert.ok(r.errors.some(e => /unknown municipality/.test(e)));
  });
  await test('Data validation', 'negative distance', () => {
    const r = bad(n => { n.edges[9].distance_km = -3; });
    assert.ok(r.errors.some(e => /positive number/.test(e)));
  });
  await test('Data validation', 'invalid coordinates', () => {
    const r = bad(n => { n.nodes[10].lat = 999; });
    assert.ok(r.errors.some(e => /invalid coordinates/.test(e)));
  });
  await test('Data validation', 'route pointing to a missing node', () => {
    const r = bad(n => { n.edges[10].to = 'nowhere'; });
    assert.ok(r.errors.some(e => /missing node/.test(e)));
  });
  await test('Data validation', 'missing terminal / destination references', () => {
    const r = bad(n => { n.terminals[3].nodeId = 'gone'; n.destinations[9].nodeId = 'gone'; });
    assert.ok(r.errors.some(e => /Terminal .*missing route node/.test(e)));
    assert.ok(r.errors.some(e => /Destination .*missing route node/.test(e)));
  });
  await test('Data validation', 'missing fare rule and incomplete rates', () => {
    const r = bad(n => { n.terminals[4].fareRuleId = 'none'; delete n.fareRules[1].rates.baseFare; });
    assert.ok(r.errors.some(e => /missing fare rule/.test(e)));
    assert.ok(r.errors.some(e => /baseFare/.test(e)));
  });
  await test('Data validation', 'duplicate route records', () => {
    const r = bad(n => n.edges.push({ ...n.edges[9], id: 'e_copy', from: n.edges[9].to, to: n.edges[9].from }));
    assert.ok(r.errors.some(e => /duplicates another segment/.test(e)));
  });
  await test('Data validation', 'routes.json drifting from rules.json is caught', () => {
    const r = bad(n => { n.edges.find(e => e.id === 'e_bv_d4').distance_km = 5; });
    assert.ok(r.errors.some(e => /Distance mismatch/.test(e)));
  });
  await test('Data validation', 'bad records are dropped and routing keeps working', () => {
    const n = clone(raw); n.edges.find(e => e.id === 'e_jordan_nv').to = 'nowhere';
    const v = network.validate(n, rules);
    const r = network.findRoute(v.network, T, 'center_nueva_valencia');
    assert.ok(r.found && !r.segments.some(s => s.id === 'e_jordan_nv'));
  });

  /* ---------------------------------------------------------------- 4 */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trikefair-test-'));
  for (const d of ['src', 'data', 'public']) fs.cpSync(path.join(APP, d), path.join(tmp, d), { recursive: true });
  fs.copyFileSync(path.join(APP, 'server.js'), path.join(tmp, 'server.js'));
  try { fs.unlinkSync(path.join(tmp, 'data', 'db.json')); } catch { /* none */ }
  const PORT = 3900 + Math.floor(Math.random() * 90);
  // PINs and the admin key on, as on the hosted server; call() sends the right ones unless a test overrides them
  const PINS = { 'BTODA-0142': '1111', 'BTODA-0087': '2222', 'BTODA-0219': '3333' };
  const server = spawn(process.execPath, ['server.js'], { cwd: tmp, env: { ...process.env, PORT: String(PORT), DATABASE_URL: '',
    DRIVER_PINS: Object.entries(PINS).map(([id, pin]) => id + ':' + pin).join(','), ADMIN_KEY: 'test-admin-key' } });
  let serverLog = ''; server.stdout.on('data', d => serverLog += d); server.stderr.on('data', d => serverLog += d);
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('server did not start: ' + serverLog)), 8000);
    server.stdout.on('data', () => { if (serverLog.includes('PANAW server running')) { clearTimeout(t); ok(); } });
  });

  function call(method, p, body, extra = {}) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const unit = (p.match(/BTODA-\d+/) || (body && String(body.driverId || '').match(/BTODA-\d+/)) || [])[0];
      const headers = { 'X-Admin-Key': 'test-admin-key', 'X-Driver-Pin': PINS[unit] || PINS['BTODA-0142'], ...extra };
      if (data) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
      const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, res => {
        let raw = ''; res.on('data', c => raw += c);
        res.on('end', () => { let j = null; try { j = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, body: j, raw }); });
      });
      req.on('error', reject); if (data) req.write(data); req.end();
    });
  }
  const get = (p, h) => call('GET', p, null, h), post = (p, b, h) => call('POST', p, b || {}, h);

  try {
    await test('API', 'GET /api/rules still works (original endpoint)', async () => {
      const r = await get('/api/rules');
      assert.strictEqual(r.status, 200); assert.strictEqual(r.body.destinations.length, 8);
    });
    await test('API', 'GET /api/network: 5 municipalities, demo data mode, central backend', async () => {
      const r = await get('/api/network');
      assert.strictEqual(r.body.municipalities.length, 5);
      assert.strictEqual(r.body.dataMode, 'DEMONSTRATION');
      assert.strictEqual(r.body.backend.mode, 'central');
      assert.ok(r.body.validation.ok);
    });
    await test('API', 'POST /api/quote without terminalId = original fare (old clients)', async () => {
      for (const d of rules.destinations) {
        const body = { destinationId: d.id, passengers: 2, discountedPax: 1, discountType: 'pwd', hireType: 'special' };
        const r = await post('/api/quote', body);
        assert.strictEqual(r.status, 200);
        const expect = fare.computeFare({ ...body, distanceKm: d.km }, rules, new Date(r.body.fare.computedAt));
        assert.deepStrictEqual(r.body.fare, expect);
      }
    });
    await test('API', 'POST /api/quote returns route + fare separately for a cross-municipal trip', async () => {
      const r = await post('/api/quote', { terminalId: T, destinationId: 'dest_nueva_valencia_center', passengers: 1, discountType: 'none', hireType: 'regular' });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.body.route.municipalityNames, ['Buenavista', 'Jordan', 'Nueva Valencia']);
      assert.strictEqual(r.body.fare.distanceKm, 32.1);
      // ₱15 base + 30.1 km × ₱1 = ₱45.10, rounded to the ₱0.25 fare step
      assert.strictEqual(r.body.fare.total, 45);
    });
    await test('API', 'NO ROUTE AVAILABLE → 422, unknown/unserved → 400', async () => {
      // every way out of Nueva Valencia toward Jordan closed
      const cut = ['e_jordan_nv', 'e_nv_sibunag'];
      for (const edgeId of cut) await post('/api/admin/network', { edgeId, available: false });
      const a = await post('/api/quote', { terminalId: 'terminal_nueva_valencia_poblacion', destinationId: 'dest_jordan_center', passengers: 1 });
      assert.strictEqual(a.status, 422); assert.strictEqual(a.body.error, 'NO ROUTE AVAILABLE');
      const b = await post('/api/quote', { terminalId: 'terminal_sibunag_poblacion', destinationId: 'd1', passengers: 1 });
      assert.strictEqual(b.status, 400);
      const c = await post('/api/trips', { terminalId: 'terminal_nueva_valencia_poblacion', destinationId: 'dest_jordan_center', passengers: 1 });
      assert.strictEqual(c.status, 422);
      for (const edgeId of cut) await post('/api/admin/network', { edgeId, available: true });
    });
    let trip;
    await test('API', 'lock → accept → start → event → complete, with route and municipality on the record', async () => {
      const lock = await post('/api/trips', { terminalId: 'terminal_jordan_poblacion', destinationId: 'dest_nueva_valencia_center',
        passengers: 2, discountedPax: 0, discountType: 'none', hireType: 'regular', deviceId: 'test', fare: { total: 1 }, total: 1 });
      assert.strictEqual(lock.status, 201);
      trip = lock.body;
      assert.notStrictEqual(trip.fare.total, 1, 'a client-sent amount must be ignored');
      assert.strictEqual(trip.municipality, 'jordan');
      assert.strictEqual(trip.terminal.name, 'Jordan Poblacion Terminal');
      assert.strictEqual(trip.route.distanceKm, 21.3);
      assert.ok(trip.fareRule.isDemo);
      assert.strictEqual((await post(`/api/trips/${trip.id}/accept`, { driverId: 'BTODA-0142' })).status, 200);
      assert.strictEqual((await post(`/api/trips/${trip.id}/start`)).status, 200);
      const ev = await post(`/api/trips/${trip.id}/events`, { type: 'deviation', coords: { lat: 10.62, lng: 122.70 } });
      assert.strictEqual(ev.status, 201); assert.strictEqual(ev.body.event.severity, 'major');
      const done = await post(`/api/trips/${trip.id}/complete`);
      assert.strictEqual(done.status, 200); trip = done.body;
    });
    await test('API', 'signed receipt verifies, and a tampered signature does not', async () => {
      const ok = await get(`/api/trips/${trip.id}/receipt?s=${trip.signature}`);
      assert.strictEqual(ok.body.signatureValid, true);
      assert.deepStrictEqual(ok.body.route.municipalityNames, ['Jordan', 'Nueva Valencia']);
      const badSig = await get(`/api/trips/${trip.id}/receipt?s=000000000000`);
      assert.strictEqual(badSig.body.signatureValid, false);
    });
    await test('API', 'GET /api/trip-records gives the structured trip record', async () => {
      const r = await get('/api/trip-records');
      const rec = r.body.find(x => x.tripId === trip.id);
      assert.deepStrictEqual(Object.keys(rec).sort(),
        ['destination', 'distance', 'estimatedTime', 'fare', 'municipality', 'status', 'terminal', 'timestamp', 'transportMode', 'tripId']);
      assert.strictEqual(rec.municipality, 'Jordan'); assert.strictEqual(rec.transportMode, 'tricycle');
    });
    await test('API', 'vehicle location: stored, validated, marked offline', async () => {
      const a = await post('/api/vehicles/BTODA-0087/location', { lat: 10.7, lng: 122.65, accuracy: 12, source: 'device' });
      assert.strictEqual(a.status, 201); assert.strictEqual(a.body.municipality, 'buenavista'); assert.strictEqual(a.body.source, 'device');
      assert.strictEqual((await post('/api/vehicles/BTODA-0087/location', { lat: 200, lng: 1 })).status, 400);
      assert.strictEqual((await post('/api/vehicles/NOT-A-UNIT/location', { lat: 10.7, lng: 122.6 })).status, 400);
      const sim = await post('/api/vehicles/BTODA-0142/location', { lat: 10.69, lng: 122.64, source: 'simulated' });
      assert.strictEqual(sim.body.source, 'simulated');
      const list = await get('/api/vehicles');
      assert.strictEqual(list.body.vehicles.length, 2); assert.strictEqual(list.body.backend.mode, 'central');
      const off = await post('/api/vehicles/BTODA-0087/offline');
      assert.strictEqual(off.body.status, 'offline');
    });
    await test('API', 'closing a segment from the monitor reroutes quotes; reopening restores', async () => {
      const body = { terminalId: T, destinationId: 'dest_nueva_valencia_center', passengers: 1, discountType: 'none', hireType: 'regular' };
      const closed = await post('/api/admin/network', { edgeId: 'e_jordan_nv', available: false });
      assert.strictEqual(closed.body.edges.find(e => e.id === 'e_jordan_nv').available, false);
      const q = await post('/api/quote', body);
      assert.strictEqual(q.body.route.distanceKm, 53.3);
      await post('/api/admin/network', { edgeId: 'e_jordan_nv', available: true });
      assert.strictEqual((await post('/api/quote', body)).body.route.distanceKm, 32.1);
      assert.strictEqual((await post('/api/admin/network', { edgeId: 'nope', available: true })).status, 400);
    });
    await test('API', 'night surcharge toggles still apply, to demo-rate terminals too', async () => {
      await post('/api/admin/rules', { nightSurchargeEnabled: true, simulateNight: true });
      const q = await post('/api/quote', { terminalId: 'terminal_jordan_poblacion', destinationId: 'd8', passengers: 1, discountType: 'none', hireType: 'regular' });
      assert.ok(q.body.fare.nightApplies);
      await post('/api/admin/rules', { nightSurchargeEnabled: false, simulateNight: false });
    });
    await test('API', 'pages and the shared route engine are served', async () => {
      for (const p of ['/', '/booking.html', '/passenger.js', '/vendor/leaflet/leaflet.js', '/driver', '/monitor', '/lib/network.js', '/lib/fare.js', '/netmap.js', '/r/x']) {
        const r = await get(p); assert.strictEqual(r.status, 200, p);
      }
    });
    await test('API', 'driver PIN and admin key are enforced when the host sets them', async () => {
      assert.strictEqual((await post('/api/vehicles/BTODA-0087/location', { lat: 10.7, lng: 122.65 }, { 'X-Driver-Pin': '' })).status, 401);
      assert.strictEqual((await post('/api/vehicles/BTODA-0087/location', { lat: 10.7, lng: 122.65 }, { 'X-Driver-Pin': '1111' })).status, 401); // another unit's PIN
      assert.strictEqual((await post('/api/drivers/BTODA-0087/check', {}, { 'X-Driver-Pin': '9999' })).status, 401);
      assert.strictEqual((await post('/api/drivers/BTODA-0087/check')).status, 200);
      assert.strictEqual((await get('/api/pickups?driver=BTODA-0087', { 'X-Driver-Pin': '' })).status, 401);
      assert.strictEqual((await post('/api/admin/reset', {}, { 'X-Admin-Key': 'guess' })).status, 401);
      assert.strictEqual((await get('/api/network')).body.auth.driverPin, true);
    });
    await test('API', 'pick-up request: driver accepts, passenger sees it, fare from the server', async () => {
      const unit = 'BTODA-0219', key = 'p'.repeat(24), own = { 'X-Driver-Pin': PINS[unit] };
      const cave = (await get('/api/network')).body.nodes.find(n => n.id === 'd5');
      const at = { lat: cave.lat + 0.001, lng: cave.lng };
      assert.strictEqual((await post('/api/pickups', { vehicleId: unit, ...at, deviceKey: key })).status, 409);   // not online yet
      assert.strictEqual((await post(`/api/vehicles/${unit}/location`, { lat: 10.69, lng: 122.64, source: 'simulated' })).status, 201);
      assert.strictEqual((await post('/api/pickups', { vehicleId: unit, lat: 14.6, lng: 121.0, deviceKey: key })).status, 400);   // Manila
      const r = await post('/api/pickups', { vehicleId: unit, ...at, label: 'By the cave entrance', destinationId: 'd2', passengers: 1, deviceKey: key });
      assert.strictEqual(r.status, 201); assert.strictEqual(r.body.status, 'requested'); assert.ok(!('deviceKey' in r.body));
      assert.strictEqual(r.body.nearestStop.id, 'd5'); assert.ok(r.body.fare.total > 0);
      assert.strictEqual((await post('/api/pickups', { vehicleId: unit, ...at, deviceKey: 'q'.repeat(24) })).status, 409);   // unit busy
      const inbox = await get('/api/pickups?driver=' + unit);
      assert.deepStrictEqual(inbox.body.map(p => p.id), [r.body.id]);
      assert.strictEqual((await post(`/api/pickups/${r.body.id}/accept`, {}, { 'X-Driver-Pin': '1111' })).status, 401);
      assert.strictEqual((await post(`/api/pickups/${r.body.id}/accept`, {}, own)).body.status, 'accepted');
      assert.strictEqual((await get('/api/pickups/' + r.body.id)).body.status, 'accepted');
      assert.strictEqual((await post(`/api/vehicles/${unit}/location`, { lat: 10.68, lng: 122.63 })).body.status, 'on_trip');
      assert.strictEqual((await post(`/api/pickups/${r.body.id}/cancel`, { deviceKey: 'wrong'.repeat(5) })).status, 403);
      assert.strictEqual((await post(`/api/pickups/${r.body.id}/arrived`, {}, own)).body.status, 'arrived');
      assert.strictEqual((await post(`/api/pickups/${r.body.id}/cancel`, { deviceKey: key })).status, 409);
      // a second request can be declined
      await post(`/api/vehicles/${unit}/location`, { lat: 10.69, lng: 122.64 });
      const again = await post('/api/pickups', { vehicleId: unit, ...at, deviceKey: key });
      assert.strictEqual((await post(`/api/pickups/${again.body.id}/decline`, {}, own)).body.status, 'declined');
      assert.strictEqual((await get('/api/pickups?driver=' + unit)).body.length, 0);
    });
    await test('API', 'place listings: validated, owner key hidden, only the owner or the monitor removes', async () => {
      const photo = 'data:image/jpeg;base64,' + Buffer.from('not really a jpeg').toString('base64');
      const good = { name: 'Test Beach Hut', category: 'Beach / resort', municipality: 'nueva_valencia', lat: 10.53, lng: 122.52,
                     description: 'Cottages by the sea', photos: [photo], ownerKey: 'k'.repeat(24) };
      const made = await post('/api/places', good);
      assert.strictEqual(made.status, 201); assert.strictEqual(made.body.status, 'unverified'); assert.ok(!('ownerKey' in made.body));
      for (const bad of [{ lat: 14.6, lng: 121.0 }, { municipality: 'atlantis' }, { category: 'Casino' }, { name: '' },
                         { photos: ['data:text/html;base64,PHNjcmlwdD4='] }, { photos: [photo, photo, photo, photo] }, { ownerKey: 'short' }]) {
        assert.strictEqual((await post('/api/places', { ...good, ...bad })).status, 400, JSON.stringify(bad).slice(0, 60));
      }
      const list = await get('/api/places');
      assert.strictEqual(list.body.places.length, 1); assert.ok(!('ownerKey' in list.body.places[0]));
      assert.strictEqual((await post(`/api/places/${made.body.id}/delete`, { ownerKey: 'x'.repeat(24) })).status, 403);
      assert.strictEqual((await post(`/api/places/${made.body.id}/delete`, { ownerKey: good.ownerKey })).status, 200);
      const again = await post('/api/places', good);
      assert.strictEqual((await post(`/api/admin/places/${again.body.id}/remove`)).status, 200);
      assert.strictEqual((await get('/api/places')).body.places.length, 0);
    });
    await test('API', 'reset clears trips, vehicles and segment overrides', async () => {
      await post('/api/admin/network', { edgeId: 'e_bv_jordan', available: false });
      await post('/api/admin/reset');
      assert.strictEqual((await get('/api/vehicles')).body.vehicles.length, 0);
      assert.ok((await get('/api/network')).body.edges.every(e => e.available));
    });
  } finally {
    // Windows keeps the folder locked until the server has actually exited.
    await new Promise(ok => { server.once('exit', ok); server.kill(); setTimeout(ok, 3000); });
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch { console.log(`(could not remove temp folder ${tmp})`); }
  }

  /* ------------------------------------------------------------- report */
  let group = '';
  for (const r of results) {
    if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '\n        ' + r.err}`);
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
