/* ============================================================================
   PANAW — Android packaging: embedded server
   ----------------------------------------------------------------------------
   The APK has no Node process, so this file answers the web app's /api/*
   requests inside the WebView. Every route below mirrors server.js line for
   line and calls the SAME, unmodified src/fare.js and src/trips.js — the fare
   engine is not re-implemented here.

   Storage mirrors src/db.js, with the phone's localStorage standing in for
   data/db.json. The Rules-screen toggles are persisted the same way.

   Guimaras expansion: the route network (src/network.js, unmodified) and the
   data/*.json network files are bundled too. There is no central server on
   the phone, so this backend reports itself as LOCAL DEMO MODE — vehicle
   positions stored here never leave the device.

   Packaging layer only — not part of the web app. Loaded before app.js.
   ========================================================================== */
(function () {
  'use strict';

  const fare    = window.__tfRequire('./fare');
  const trips   = window.__tfRequire('./trips');
  const network = window.__tfRequire('./network');
  const places  = window.__tfRequire('./places');
  const pickups = window.__tfRequire('./pickups');
  const BASE_RULES = window.__TF_BASE_RULES__;
  const NETWORK_DATA = window.__TF_NETWORK__;

  const BACKEND = {
    mode: 'local',
    label: 'LOCAL DEMO MODE',
    detail: 'No central server is connected — data stays on this phone.'
  };

  /* ------------------------------------------------------ datastore (db.js) */
  const DB_KEY = 'tf_embedded_db';
  const RULES_KEY = 'tf_embedded_rules_patch';

  // Re-read once per request: the passenger app and the driver console are
  // separate pages sharing this storage, just as both devices shared db.json.
  let db = null;

  function seed() {
    return { trips: [], reports: [], vehicles: {}, networkOverrides: {}, places: [], pickups: [], meta: { seededAt: new Date().toISOString(), version: 1 } };
  }
  const store = {
    load() {
      if (db) return db;
      try { db = JSON.parse(localStorage.getItem(DB_KEY)); } catch { db = null; }
      if (!db || !Array.isArray(db.trips)) { db = seed(); store.save(); }
      if (!db.vehicles) db.vehicles = {};
      if (!db.networkOverrides) db.networkOverrides = {};
      if (!db.places) db.places = [];
      if (!db.pickups) db.pickups = [];
      return db;
    },
    save() { localStorage.setItem(DB_KEY, JSON.stringify(db)); },
    reset() { db = seed(); store.save(); return db; },
    rules() {
      let patch = {};
      try { patch = JSON.parse(localStorage.getItem(RULES_KEY)) || {}; } catch { patch = {}; }
      return { ...JSON.parse(JSON.stringify(BASE_RULES)), ...patch };
    },
    patchRules(patch) {
      const current = store.rules();
      const saved = {};
      const allowed = ['nightSurchargeEnabled', 'simulateNight'];
      for (const key of allowed) {
        if (key in patch) current[key] = Boolean(patch[key]);
        saved[key] = current[key];
      }
      localStorage.setItem(RULES_KEY, JSON.stringify(saved));
      return current;
    }
  };

  /* --------------------------------------------------------------- helpers */
  class HttpReply { constructor(code, payload) { this.code = code; this.payload = payload; } }
  const json = (code, payload) => new HttpReply(code, payload);
  const findTrip = id => store.load().trips.find(t => t.id === id);
  const net = () => network.validate(NETWORK_DATA, store.rules());
  function networkView() {
    const { network: n, report } = net();
    const overrides = store.load().networkOverrides;
    const rules = store.rules();
    return {
      ...n,
      edges: n.edges.map(e => ({ ...e, available: network.edgeAvailable(e, overrides) })),
      fareRules: n.fareRules.map(r => r.source === 'rules.json'
        ? { ...r, rates: Object.fromEntries(network.RATE_KEYS.map(k => [k, rules[k]])), lgu: rules.lgu, ordinance: rules.ordinance }
        : r),
      validation: report,
      dataMode: 'DEMONSTRATION',
      backend: BACKEND,
      auth: { driverPin: false, adminKey: false },   // one phone, one user: nothing to protect from
      serverTime: new Date().toISOString()
    };
  }
  function vehicleStatus(s, id) {
    const t = s.trips.find(t => t.driver && t.driver.id === id && ['accepted', 'in_progress'].includes(t.status));
    const p = s.pickups.find(p => p.vehicleId === id && p.status === 'accepted');
    return t || p ? 'on_trip' : 'available';
  }

  /* ---------------------------------------------------- routes (server.js) */
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  route('GET', /^\/api\/rules$/, () => {
    const r = store.rules();
    return json(200, { ...r, serverTime: new Date().toISOString(), isNightNow: fare.isNight(new Date(), r) });
  });

  route('GET', /^\/api\/network$/, () => json(200, networkView()));

  route('POST', /^\/api\/quote$/, (body) => {
    const r = store.rules();
    const resolved = network.resolveTrip(r, net().network, body, store.load().networkOverrides);
    if (resolved.error) return json(resolved.noRoute ? 422 : 400, resolved);
    return json(200, {
      destination: { ...resolved.destination, km: resolved.route.distanceKm },
      terminal: resolved.terminal,
      route: resolved.route,
      fareRule: resolved.fareRule,
      fare: fare.computeFare({ ...body, distanceKm: resolved.route.distanceKm }, resolved.fareRules)
    });
  });

  route('POST', /^\/api\/trips$/, (body) => {
    const r = store.rules();
    const resolved = network.resolveTrip(r, net().network, body, store.load().networkOverrides);
    if (resolved.error) return json(resolved.noRoute ? 422 : 400, resolved);
    const result = trips.createTrip(body, r, resolved);
    if (result.error) return json(400, result);
    const s = store.load();
    s.trips.unshift(result.trip);
    if (result.trip.preferredDriverId) {
      const driver = r.drivers.find(d => d.id === result.trip.preferredDriverId);
      if (driver) trips.accept(result.trip, driver);
    }
    store.save();
    return json(201, result.trip);
  });

  route('GET', /^\/api\/trips$/, (_b, _m, query) => {
    let list = store.load().trips;
    if (query.status) list = list.filter(t => t.status === query.status);
    if (query.device) list = list.filter(t => t.passengerDevice === query.device);
    if (query.driver) list = list.filter(t => t.driver && t.driver.id === query.driver);
    if (query.open === '1') list = list.filter(t => !['completed', 'cancelled'].includes(t.status));
    return json(200, list.slice(0, Number(query.limit) || 50));
  });

  route('GET', /^\/api\/trips\/([\w-]+)$/, (_b, m) => {
    const trip = findTrip(m[1]);
    return trip ? json(200, trip) : json(404, { error: 'Trip not found.' });
  });

  route('POST', /^\/api\/trips\/([\w-]+)\/accept$/, (body, m) => {
    const trip = findTrip(m[1]);
    if (!trip) return json(404, { error: 'Trip not found.' });
    const driver = store.rules().drivers.find(d => d.id === body.driverId);
    if (!driver) return json(400, { error: 'Unknown driver.' });
    const result = trips.accept(trip, driver);
    if (result.error) return json(409, result);
    store.save();
    return json(200, trip);
  });

  route('POST', /^\/api\/trips\/([\w-]+)\/start$/, (_b, m) => {
    const trip = findTrip(m[1]);
    if (!trip) return json(404, { error: 'Trip not found.' });
    const result = trips.start(trip);
    if (result.error) return json(409, result);
    store.save();
    return json(200, trip);
  });

  route('POST', /^\/api\/trips\/([\w-]+)\/events$/, (body, m) => {
    const trip = findTrip(m[1]);
    if (!trip) return json(404, { error: 'Trip not found.' });
    const result = trips.addEvent(trip, body, store.rules());
    if (result.error) return json(409, result);
    store.save();
    return json(201, { trip, event: result.event });
  });

  route('POST', /^\/api\/trips\/([\w-]+)\/complete$/, (_b, m) => {
    const trip = findTrip(m[1]);
    if (!trip) return json(404, { error: 'Trip not found.' });
    const result = trips.complete(trip);
    if (result.error) return json(409, result);
    store.save();
    return json(200, trip);
  });

  route('POST', /^\/api\/trips\/([\w-]+)\/cancel$/, (body, m) => {
    const trip = findTrip(m[1]);
    if (!trip) return json(404, { error: 'Trip not found.' });
    const result = trips.cancel(trip, body.reason);
    if (result.error) return json(409, result);
    store.save();
    return json(200, trip);
  });

  route('GET', /^\/api\/trips\/([\w-]+)\/receipt$/, (_b, m, query) => {
    const trip = findTrip(m[1]);
    if (!trip) return json(404, { error: 'Receipt not found.' });
    const view = trips.receiptView(trip);
    view.signatureValid = query.s ? trips.verify(trip, query.s) : null;
    return json(200, view);
  });

  route('POST', /^\/api\/reports$/, (body) => {
    const s = store.load();
    const report = {
      ref: 'FR-' + String(1000 + s.reports.length + 1),
      at: new Date().toISOString(),
      tripId: String(body.tripId || '').slice(0, 40),
      type: String(body.type || 'Other concern').slice(0, 80),
      details: String(body.details || '').slice(0, 800)
    };
    s.reports.unshift(report);
    store.save();
    return json(201, report);
  });

  route('GET', /^\/api\/reports$/, () => json(200, store.load().reports));

  route('GET', /^\/api\/places$/, () =>
    json(200, { categories: places.CATEGORIES, places: store.load().places.map(places.publicPlace) }));

  route('POST', /^\/api\/places$/, (body) => {
    const r = places.cleanPlace(body, net().network.municipalities);
    if (r.error) return json(400, r);
    const s = store.load();
    const full = places.limitError(s.places, r.place.ownerKey);
    if (full) return json(429, { error: full });
    s.places.unshift(r.place);
    // photos live in the phone's localStorage, which holds a few MB at most
    try { store.save(); } catch { s.places.shift(); return json(507, { error: 'This phone has no room left for more photos. Remove a listing or post fewer photos.' }); }
    return json(201, places.publicPlace(r.place));
  });

  route('POST', /^\/api\/places\/([\w-]+)\/delete$/, (body, m) => {
    const s = store.load();
    const i = s.places.findIndex(p => p.id === m[1]);
    if (i < 0) return json(404, { error: 'No such listing.' });
    if (!body.ownerKey || body.ownerKey !== s.places[i].ownerKey) return json(403, { error: 'Only the owner can remove this listing.' });
    s.places.splice(i, 1);
    store.save();
    return json(200, { ok: true });
  });

  route('POST', /^\/api\/pickups$/, (body) => {
    const s = store.load();
    const r = pickups.createPickup(body, { net: net().network, rules: store.rules(), vehicles: s.vehicles,
      pickups: s.pickups, overrides: s.networkOverrides });
    if (r.error) return json(r.code || 400, r);
    s.pickups.unshift(r.pickup);
    s.pickups.splice(200);
    store.save();
    return json(201, pickups.publicPickup(r.pickup));
  });

  route('GET', /^\/api\/pickups\/([\w-]+)$/, (_b, m) => {
    const p = store.load().pickups.find(x => x.id === m[1]);
    return p ? json(200, pickups.publicPickup(p)) : json(404, { error: 'Pick-up request not found.' });
  });

  route('GET', /^\/api\/pickups$/, (_b, _m, query) => {
    if (!query.driver) return json(400, { error: 'driver is required.' });
    return json(200, store.load().pickups.filter(p => p.vehicleId === query.driver && pickups.isOpen(p)).map(p => pickups.publicPickup(p)));
  });

  route('POST', /^\/api\/pickups\/([\w-]+)\/(accept|decline|arrived|cancel)$/, (body, m) => {
    const s = store.load();
    const p = s.pickups.find(x => x.id === m[1]);
    if (!p) return json(404, { error: 'Pick-up request not found.' });
    if (pickups.MOVES[m[2]].by === 'passenger' && body.deviceKey !== p.deviceKey) return json(403, { error: 'Only the passenger who asked can cancel.' });
    const err = pickups.move(p, m[2]);
    if (err) return json(409, { error: err });
    if (s.vehicles[p.vehicleId]) s.vehicles[p.vehicleId].status = vehicleStatus(s, p.vehicleId);
    store.save();
    return json(200, pickups.publicPickup(p));
  });

  route('POST', /^\/api\/drivers\/([\w-]+)\/check$/, (_b, m) =>
    store.rules().drivers.some(d => d.id === m[1]) ? json(200, { ok: true }) : json(404, { error: 'Unknown driver.' }));

  route('GET', /^\/api\/trip-records$/, (_b, _m, query) =>
    json(200, store.load().trips.slice(0, Number(query.limit) || 50).map(trips.tripRecord)));

  route('GET', /^\/api\/vehicles$/, () => {
    const s = store.load();
    return json(200, { backend: BACKEND, serverTime: new Date().toISOString(), vehicles: Object.values(s.vehicles) });
  });

  route('POST', /^\/api\/vehicles\/([\w-]+)\/location$/, (body, m) => {
    const r = store.rules();
    const driver = r.drivers.find(d => d.id === m[1]);
    if (!driver) return json(400, { error: 'Unknown vehicle.' });
    const pos = network.cleanPosition(body);
    if (!pos) return json(400, { error: 'Invalid coordinates.' });
    const n = net().network;
    const terminal = n.terminals.find(t => (t.driverIds || []).includes(driver.id))
                  || n.terminals.find(t => t.id === n.defaultTerminalId);
    const s = store.load();
    s.vehicles[driver.id] = {
      vehicleId: driver.id, driverName: driver.name, unit: driver.unit,
      municipality: terminal ? terminal.municipality : null,
      terminalId: terminal ? terminal.id : null,
      terminalName: terminal ? terminal.name : null,
      latitude: pos.lat, longitude: pos.lng, accuracy: pos.accuracy,
      source: body.source === 'simulated' ? 'simulated' : 'device',
      status: vehicleStatus(s, driver.id),
      timestamp: new Date().toISOString()
    };
    store.save();
    return json(201, s.vehicles[driver.id]);
  });

  route('POST', /^\/api\/vehicles\/([\w-]+)\/offline$/, (_b, m) => {
    const s = store.load();
    const v = s.vehicles[m[1]];
    if (!v) return json(404, { error: 'Vehicle has not reported a location.' });
    v.status = 'offline';
    store.save();
    return json(200, v);
  });

  route('POST', /^\/api\/admin\/rules$/, (body) => {
    const updated = store.patchRules(body);
    return json(200, { ...updated, isNightNow: fare.isNight(new Date(), updated) });
  });

  route('POST', /^\/api\/admin\/network$/, (body) => {
    const edge = net().network.edges.find(e => e.id === body.edgeId);
    if (!edge) return json(400, { error: 'Unknown route segment.' });
    const s = store.load();
    if (typeof body.available !== 'boolean') return json(400, { error: 'available must be true or false.' });
    if (body.available === (edge.available !== false)) delete s.networkOverrides[edge.id];
    else s.networkOverrides[edge.id] = { available: body.available, at: new Date().toISOString() };
    store.save();
    return json(200, networkView());
  });

  route('POST', /^\/api\/admin\/places\/([\w-]+)\/remove$/, (_b, m) => {
    const s = store.load();
    const i = s.places.findIndex(p => p.id === m[1]);
    if (i < 0) return json(404, { error: 'No such listing.' });
    s.places.splice(i, 1);
    store.save();
    return json(200, { ok: true });
  });

  route('POST', /^\/api\/admin\/reset$/, () => {
    store.reset();
    return json(200, { ok: true, message: 'Database cleared.' });
  });

  route('GET', /^\/api\/health$/, () => {
    const s = store.load();
    return json(200, { ok: true, trips: s.trips.length, reports: s.reports.length, time: new Date().toISOString() });
  });

  /* ---------------------------------------------------------- dispatcher */
  function dispatch(method, url, rawBody) {
    db = null;
    const query = Object.fromEntries(url.searchParams);
    if (method === 'OPTIONS') return json(204, null);
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = url.pathname.match(r.pattern);
      if (!m) continue;
      try {
        let body = {};
        if (method === 'POST' && rawBody) {
          try { body = JSON.parse(rawBody); } catch { throw new Error('Invalid JSON body'); }
        }
        return r.handler(body, m, query);
      } catch (err) {
        console.error('[error]', url.pathname, err.message);
        return json(500, { error: err.message });
      }
    }
    return json(404, { error: 'No such endpoint.' });
  }

  /* ------------------------------------------- fetch() for /api/* only */
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = String((init && init.method) || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const reply = dispatch(method, url, init && init.body);
    const body = reply.code === 204 ? null : JSON.stringify(reply.payload);
    return Promise.resolve(new Response(body, {
      status: reply.code,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    }));
  };
})();
