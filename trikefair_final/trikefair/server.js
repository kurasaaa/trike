'use strict';
/* ============================================================================
   PANAW SERVER
   Zero dependencies — Node's own http module. Nothing to npm install, which
   means the demo runs on a laptop with no internet.

       node server.js
       → http://localhost:3000            passenger app
       → http://localhost:3000/driver     driver console
       → http://<your-LAN-ip>:3000        the second device

   ========================================================================== */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const db      = require('./src/db');
const fare    = require('./src/fare');
const trips   = require('./src/trips');
const network = require('./src/network');
const places  = require('./src/places');
const pickups = require('./src/pickups');
const crypto  = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

// Every device that talks to this process shares one database, so locations
// sent here really are centralized. The Android build answers the same calls
// on the phone itself and reports itself as LOCAL DEMO MODE instead.
const BACKEND = {
  mode: 'central',
  label: 'CONNECTED CENTRALIZED MODE',
  detail: 'PANAW server — every device connected to it shares this data.'
};

/* Access, set on the host (Render dashboard), never in the code:
     DRIVER_PINS="BTODA-0142:4821,BTODA-0087:1937"   driver actions need the X-Driver-Pin header
     ADMIN_KEY="a long random phrase"                  monitor actions need the X-Admin-Key header
   Left unset (laptop demo) they are open, and the start-up log says so. */
const DRIVER_PINS = Object.fromEntries(String(process.env.DRIVER_PINS || '').split(',')
  .map(s => s.split(':').map(x => x.trim())).filter(([id, pin]) => id && pin));
const ADMIN_KEY = String(process.env.ADMIN_KEY || '').trim();
const AUTH = { driverPin: Object.keys(DRIVER_PINS).length > 0, adminKey: ADMIN_KEY !== '' };
const same = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};
const driverOk = (req, id) => !AUTH.driverPin || (id in DRIVER_PINS && same(req.headers['x-driver-pin'], DRIVER_PINS[id]));
const adminOk = req => !AUTH.adminKey || same(req.headers['x-admin-key'], ADMIN_KEY);
const DENIED_DRIVER = { error: 'Driver PIN missing or wrong.' };
const DENIED_ADMIN = { error: 'Admin key missing or wrong.' };

/* The PANAW app's hub, the same code the phone runs offline (src/hub.js).
   Passwords are kept as scrypt hashes, never as typed. */
const hashPw = pw => { const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt:' + salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex'); };
const verifyPw = (pw, stored) => {
  const [kind, salt, h] = String(stored || '').split(':');
  return kind === 'scrypt' && !!h && same(crypto.scryptSync(pw, salt, 32).toString('hex'), h);
};
const readData = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', f), 'utf8'));
// PANAW_DEMO=1 adds the sample accounts and simulated trikes for a laptop demo; left unset, only real sign-ups exist.
const DEMO = process.env.PANAW_DEMO === '1';
const H = require('./src/hub').create({ N: network, F: fare, hash: hashPw, verify: verifyPw, demo: DEMO, RAW: {
  rules: db.rules(), municipalities: readData('municipalities.json'), terminals: readData('terminals.json'),
  destinations: readData('destinations.json'), routes: readData('routes.json'), fareRules: readData('fare_rules.json'),
  demoVehicles: readData('demo_vehicles.json'), transportModes: readData('transport_modes.json') } });
const hubSessions = () => db.load().hubSessions || (db.load().hubSessions = {});
/* listings from the app and from the older pages are one board: store.places */
function linkHub() {
  H.Hub.listings = db.load().places;
  H.ACTIONS.checkListing = item => {
    if (!item.owner) return 'Log in to list a place.';
    const ownerKey = ('account:' + item.owner).padEnd(16, '_');
    const r = places.cleanPlace({ ...item, category: item.kind, ownerKey }, net().network.municipalities);
    if (r.error) return r.error;
    const full = places.limitError(db.load().places, ownerKey); if (full) return full;
    Object.assign(item, { category: item.kind, ownerKey, status: 'unverified', createdAt: new Date().toISOString(), locationSource: 'map' });
    return null;
  };
}
function saveHub() {
  const store = db.load();
  store.hub = H.dump();
  // sessions older than 30 days end
  for (const [t, s] of Object.entries(hubSessions())) if (Date.now() - s.at > 30 * 86400e3) delete store.hubSessions[t];
  db.save();
}

/* ---------------------------------------------------------------- helpers */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',   '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',             '.ico': 'image/x-icon',
  '.png': 'image/png'
};

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1e6) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}
function findTrip(id) {
  return db.load().trips.find(t => t.id === id);
}
/** The validated route network. Invalid records are dropped, not fatal. */
function net() {
  return network.validate(db.networkData(), db.rules());
}
/** Network as the apps see it: segment availability includes monitor overrides. */
function networkView() {
  const { network: n, report } = net();
  const overrides = db.load().networkOverrides;
  const rules = db.rules();
  return {
    ...n,
    edges: n.edges.map(e => ({ ...e, available: network.edgeAvailable(e, overrides) })),
    fareRules: n.fareRules.map(r => r.source === 'rules.json'
      ? { ...r, rates: Object.fromEntries(network.RATE_KEYS.map(k => [k, rules[k]])), lgu: rules.lgu, ordinance: rules.ordinance }
      : r),
    validation: report,
    dataMode: 'DEMONSTRATION',
    backend: BACKEND,
    auth: AUTH,
    serverTime: new Date().toISOString()
  };
}
function vehicleStatus(store, id) {
  const t = store.trips.find(t => t.driver && t.driver.id === id && ['accepted', 'in_progress'].includes(t.status));
  const p = store.pickups.find(p => p.vehicleId === id && p.status === 'accepted');
  return t || p ? 'on_trip' : 'available';
}
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- routes  */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

/* --- reference data ----------------------------------------------------- */
route('GET', /^\/api\/rules$/, (req, res) => {
  const r = db.rules();
  json(res, 200, {
    ...r,
    serverTime: new Date().toISOString(),
    isNightNow: fare.isNight(new Date(), r)
  });
});

/* --- Guimaras route network ---------------------------------------------- */
route('GET', /^\/api\/network$/, (req, res) => json(res, 200, networkView()));

/* --- quote: arithmetic only, nothing stored ----------------------------- */
// Route engine → distance → the unchanged fare engine. With no terminalId the
// default (New Poblacion) terminal is used, so older requests get the same fare.
route('POST', /^\/api\/quote$/, async (req, res) => {
  const body = await readBody(req);
  const r = db.rules();
  const resolved = network.resolveTrip(r, net().network, body, db.load().networkOverrides);
  if (resolved.error) return json(res, resolved.noRoute ? 422 : 400, resolved);
  json(res, 200, {
    destination: { ...resolved.destination, km: resolved.route.distanceKm },
    terminal: resolved.terminal,
    route: resolved.route,
    fareRule: resolved.fareRule,
    fare: fare.computeFare({ ...body, distanceKm: resolved.route.distanceKm }, resolved.fareRules)
  });
});

/* --- create (= lock) ---------------------------------------------------- */
route('POST', /^\/api\/trips$/, async (req, res) => {
  const body = await readBody(req);
  const r = db.rules();
  const resolved = network.resolveTrip(r, net().network, body, db.load().networkOverrides);
  if (resolved.error) return json(res, resolved.noRoute ? 422 : 400, resolved);
  const result = trips.createTrip(body, r, resolved);
  if (result.error) return json(res, 400, result);

  const store = db.load();
  store.trips.unshift(result.trip);

  // Booking mode: the passenger picked a specific unit, so bind it immediately.
  if (result.trip.preferredDriverId) {
    const driver = r.drivers.find(d => d.id === result.trip.preferredDriverId);
    if (driver) trips.accept(result.trip, driver);
  }
  db.save();
  json(res, 201, result.trip);
});

/* --- listing ------------------------------------------------------------ */
route('GET', /^\/api\/trips$/, (req, res, _m, query) => {
  let list = db.load().trips;
  if (query.status) list = list.filter(t => t.status === query.status);
  if (query.device) list = list.filter(t => t.passengerDevice === query.device);
  if (query.driver) list = list.filter(t => t.driver && t.driver.id === query.driver);
  if (query.open === '1') list = list.filter(t => !['completed', 'cancelled'].includes(t.status));
  json(res, 200, list.slice(0, Number(query.limit) || 50));
});

route('GET', /^\/api\/trips\/([\w-]+)$/, (req, res, m) => {
  const trip = findTrip(m[1]);
  return trip ? json(res, 200, trip) : json(res, 404, { error: 'Trip not found.' });
});

/* --- lifecycle transitions ---------------------------------------------- */
route('POST', /^\/api\/trips\/([\w-]+)\/accept$/, async (req, res, m) => {
  const trip = findTrip(m[1]);
  if (!trip) return json(res, 404, { error: 'Trip not found.' });
  const body = await readBody(req);
  const driver = db.rules().drivers.find(d => d.id === body.driverId);
  if (!driver) return json(res, 400, { error: 'Unknown driver.' });
  if (!driverOk(req, driver.id)) return json(res, 401, DENIED_DRIVER);
  const result = trips.accept(trip, driver);
  if (result.error) return json(res, 409, result);
  db.save();
  json(res, 200, trip);
});

route('POST', /^\/api\/trips\/([\w-]+)\/start$/, (req, res, m) => {
  const trip = findTrip(m[1]);
  if (!trip) return json(res, 404, { error: 'Trip not found.' });
  if (!driverOk(req, trip.driver && trip.driver.id)) return json(res, 401, DENIED_DRIVER);
  const result = trips.start(trip);
  if (result.error) return json(res, 409, result);
  db.save();
  json(res, 200, trip);
});

route('POST', /^\/api\/trips\/([\w-]+)\/events$/, async (req, res, m) => {
  const trip = findTrip(m[1]);
  if (!trip) return json(res, 404, { error: 'Trip not found.' });
  const body = await readBody(req);
  const result = trips.addEvent(trip, body, db.rules());
  if (result.error) return json(res, 409, result);
  db.save();
  json(res, 201, { trip, event: result.event });
});

route('POST', /^\/api\/trips\/([\w-]+)\/complete$/, (req, res, m) => {
  const trip = findTrip(m[1]);
  if (!trip) return json(res, 404, { error: 'Trip not found.' });
  if (!driverOk(req, trip.driver && trip.driver.id)) return json(res, 401, DENIED_DRIVER);
  const result = trips.complete(trip);
  if (result.error) return json(res, 409, result);
  db.save();
  json(res, 200, trip);
});

route('POST', /^\/api\/trips\/([\w-]+)\/cancel$/, async (req, res, m) => {
  const trip = findTrip(m[1]);
  if (!trip) return json(res, 404, { error: 'Trip not found.' });
  const body = await readBody(req);
  const result = trips.cancel(trip, body.reason);
  if (result.error) return json(res, 409, result);
  db.save();
  json(res, 200, trip);
});

/* --- the QR target: public, signed, verifiable -------------------------- */
route('GET', /^\/api\/trips\/([\w-]+)\/receipt$/, (req, res, m, query) => {
  const trip = findTrip(m[1]);
  if (!trip) return json(res, 404, { error: 'Receipt not found.' });
  const view = trips.receiptView(trip);
  view.signatureValid = query.s ? trips.verify(trip, query.s) : null;
  json(res, 200, view);
});

/* --- fare disputes ------------------------------------------------------ */
route('POST', /^\/api\/reports$/, async (req, res) => {
  const body = await readBody(req);
  const store = db.load();
  const report = {
    ref: 'FR-' + String(1000 + store.reports.length + 1),
    at: new Date().toISOString(),
    tripId: String(body.tripId || '').slice(0, 40),
    type: String(body.type || 'Other concern').slice(0, 80),
    details: String(body.details || '').slice(0, 800)
  };
  store.reports.unshift(report);
  db.save();
  json(res, 201, report);
});

route('GET', /^\/api\/reports$/, (req, res) => json(res, 200, db.load().reports));

/* --- place listings: owner-submitted, shown as unverified --------------- */
route('GET', /^\/api\/places$/, (req, res) =>
  json(res, 200, { categories: places.CATEGORIES, places: db.load().places.map(places.publicPlace) }));

route('POST', /^\/api\/places$/, async (req, res) => {
  const body = await readBody(req);
  const r = places.cleanPlace(body, net().network.municipalities);
  if (r.error) return json(res, 400, r);
  const store = db.load();
  const full = places.limitError(store.places, r.place.ownerKey);
  if (full) return json(res, 429, { error: full });
  store.places.unshift(r.place);
  db.save();
  json(res, 201, places.publicPlace(r.place));
});

// Only the phone that posted a listing holds its owner key.
route('POST', /^\/api\/places\/([\w-]+)\/delete$/, async (req, res, m) => {
  const body = await readBody(req);
  const store = db.load();
  const i = store.places.findIndex(p => p.id === m[1]);
  if (i < 0) return json(res, 404, { error: 'No such listing.' });
  if (!body.ownerKey || body.ownerKey !== store.places[i].ownerKey) return json(res, 403, { error: 'Only the owner can remove this listing.' });
  store.places.splice(i, 1);
  db.save();
  json(res, 200, { ok: true });
});

/* --- pick-up requests: a trike comes to the passenger's pin ------------ */
route('POST', /^\/api\/pickups$/, async (req, res) => {
  const body = await readBody(req);
  const store = db.load();
  const r = pickups.createPickup(body, { net: net().network, rules: db.rules(), vehicles: store.vehicles,
    pickups: store.pickups, overrides: store.networkOverrides });
  if (r.error) return json(res, r.code || 400, r);
  store.pickups.unshift(r.pickup);
  store.pickups.splice(200);   // keep the stored document small
  db.save();
  json(res, 201, pickups.publicPickup(r.pickup));
});

route('GET', /^\/api\/pickups\/([\w-]+)$/, (req, res, m) => {
  const p = db.load().pickups.find(x => x.id === m[1]);
  if (!p) return json(res, 404, { error: 'Pick-up request not found.' });
  json(res, 200, pickups.publicPickup(p));
});

// The driver's inbox. It holds passengers' pick-up points, so it needs the driver's PIN.
route('GET', /^\/api\/pickups$/, (req, res, _m, query) => {
  if (!query.driver) return json(res, 400, { error: 'driver is required.' });
  if (!driverOk(req, query.driver)) return json(res, 401, DENIED_DRIVER);
  json(res, 200, db.load().pickups.filter(p => p.vehicleId === query.driver && pickups.isOpen(p)).map(p => pickups.publicPickup(p)));
});

route('POST', /^\/api\/pickups\/([\w-]+)\/(accept|decline|arrived|cancel)$/, async (req, res, m) => {
  const body = await readBody(req);
  const store = db.load();
  const p = store.pickups.find(x => x.id === m[1]);
  if (!p) return json(res, 404, { error: 'Pick-up request not found.' });
  if (pickups.MOVES[m[2]].by === 'driver' && !driverOk(req, p.vehicleId)) return json(res, 401, DENIED_DRIVER);
  if (pickups.MOVES[m[2]].by === 'passenger' && body.deviceKey !== p.deviceKey) return json(res, 403, { error: 'Only the passenger who asked can cancel.' });
  const err = pickups.move(p, m[2]);
  if (err) return json(res, 409, { error: err });
  if (store.vehicles[p.vehicleId]) store.vehicles[p.vehicleId].status = vehicleStatus(store, p.vehicleId);
  db.save();
  json(res, 200, pickups.publicPickup(p));
});

/* --- trip records: the structured summary of each trip ------------------ */
route('GET', /^\/api\/trip-records$/, (req, res, _m, query) => {
  const list = db.load().trips.slice(0, Number(query.limit) || 50);
  json(res, 200, list.map(trips.tripRecord));
});

/* --- vehicle locations (GPS) -------------------------------------------- */
// Stores only what tracking needs: who, where, when, and whether the point
// came from the device's GPS or was simulated for a demo.
route('GET', /^\/api\/vehicles$/, (req, res) => {
  const store = db.load();
  json(res, 200, {
    backend: BACKEND,
    serverTime: new Date().toISOString(),
    vehicles: Object.values(store.vehicles)
  });
});

route('POST', /^\/api\/vehicles\/([\w-]+)\/location$/, async (req, res, m) => {
  const body = await readBody(req);
  const r = db.rules();
  const driver = r.drivers.find(d => d.id === m[1]);
  if (!driver) return json(res, 400, { error: 'Unknown vehicle.' });
  if (!driverOk(req, driver.id)) return json(res, 401, DENIED_DRIVER);
  const pos = network.cleanPosition(body);
  if (!pos) return json(res, 400, { error: 'Invalid coordinates.' });
  const n = net().network;
  const terminal = n.terminals.find(t => (t.driverIds || []).includes(driver.id))
                || n.terminals.find(t => t.id === n.defaultTerminalId);
  const store = db.load();
  store.vehicles[driver.id] = {
    vehicleId: driver.id,
    driverName: driver.name,
    unit: driver.unit,
    municipality: terminal ? terminal.municipality : null,
    terminalId: terminal ? terminal.id : null,
    terminalName: terminal ? terminal.name : null,
    latitude: pos.lat,
    longitude: pos.lng,
    accuracy: pos.accuracy,
    source: body.source === 'simulated' ? 'simulated' : 'device',
    status: vehicleStatus(store, driver.id),
    timestamp: new Date().toISOString()
  };
  db.save();
  json(res, 201, store.vehicles[driver.id]);
});

route('POST', /^\/api\/vehicles\/([\w-]+)\/offline$/, (req, res, m) => {
  if (!driverOk(req, m[1])) return json(res, 401, DENIED_DRIVER);
  const store = db.load();
  const v = store.vehicles[m[1]];
  if (!v) return json(res, 404, { error: 'Vehicle has not reported a location.' });
  v.status = 'offline';
  db.save();
  json(res, 200, v);
});

/* --- PANAW app: accounts, rides, safety watch (src/hub.js) ------------- */
// The phone sends "Authorization: Bearer <token>"; the token comes from signup or login.
const sessionOf = req => {
  const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const s = t && hubSessions()[t];
  return s ? { token: t, me: H.byId(H.Hub.accounts, s.id) } : null;
};
const failedLogins = new Map();   // ip -> [times], so a password cannot be guessed endlessly
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// Phones ask every 1.5 s. Listings carry photos, so they are sent only when the board changed (lrev).
route('GET', /^\/api\/hub\/view$/, (req, res, _m, query) => {
  const s = sessionOf(req);
  if (!s || !s.me) return json(res, 401, { error: 'Please log in again.' });
  const v = H.view(s.me);
  v.listingsRev = crypto.createHash('sha1').update(v.listings.map(l => l.id).join()).digest('hex').slice(0, 12);
  if (query.lrev === v.listingsRev) delete v.listings;
  json(res, 200, { view: v });
});

route('POST', /^\/api\/hub\/(\w+)$/, async (req, res, m) => {
  const body = await readBody(req), name = m[1], s = sessionOf(req);
  if (name === 'login') {
    const ip = clientIp(req), recent = (failedLogins.get(ip) || []).filter(t => Date.now() - t < 10 * 60e3);
    if (recent.length >= 10) return json(res, 429, { error: 'Too many wrong passwords. Wait 10 minutes and try again.' });
    failedLogins.set(ip, recent);
  }
  const result = H.run(name, s && s.me, body);
  let token;
  if (!result.error && result.account && (name === 'login' || name === 'signup')) {
    token = crypto.randomBytes(24).toString('hex');
    hubSessions()[token] = { id: result.account.id, at: Date.now() };
  }
  if (result.error && name === 'login') failedLogins.get(clientIp(req)).push(Date.now());
  if (name === 'logout' && s) delete hubSessions()[s.token];
  const me = token ? result.account : name === 'logout' ? null : s && s.me;
  saveHub();
  const { account, ...rest } = result;   // the account goes back as the view's "me", never with its password hash
  const view = H.view(me);
  if (!['login', 'signup', 'publish'].includes(name)) delete view.listings;   // photos travel only when needed; the next poll brings changes
  json(res, result.error ? 400 : 200, { result: rest, view, token });
});

/* the page and data behind the link a passenger sends to an emergency contact */
route('GET', /^\/api\/track\/(\w+)$/, (req, res, m) => {
  const v = H.trackView(m[1]);
  return v ? json(res, 200, v) : json(res, 404, { error: 'This trip link has expired or does not exist.' });
});

/* --- demo controls ------------------------------------------------------ */
route('POST', /^\/api\/admin\/rules$/, async (req, res) => {
  if (!adminOk(req)) return json(res, 401, DENIED_ADMIN);
  const body = await readBody(req);
  const updated = db.patchRules(body);
  json(res, 200, { ...updated, isNightNow: fare.isNight(new Date(), updated) });
});

/* Route segment availability, from the monitor. The route engine skips an
   unavailable segment and finds the next-best path, if there is one. */
route('POST', /^\/api\/admin\/network$/, async (req, res) => {
  if (!adminOk(req)) return json(res, 401, DENIED_ADMIN);
  const body = await readBody(req);
  const edge = net().network.edges.find(e => e.id === body.edgeId);
  if (!edge) return json(res, 400, { error: 'Unknown route segment.' });
  const store = db.load();
  if (typeof body.available !== 'boolean') return json(res, 400, { error: 'available must be true or false.' });
  if (body.available === (edge.available !== false)) delete store.networkOverrides[edge.id];
  else store.networkOverrides[edge.id] = { available: body.available, at: new Date().toISOString() };
  db.save();
  json(res, 200, networkView());
});

route('POST', /^\/api\/admin\/places\/([\w-]+)\/remove$/, (req, res, m) => {
  if (!adminOk(req)) return json(res, 401, DENIED_ADMIN);
  const store = db.load();
  const i = store.places.findIndex(p => p.id === m[1]);
  if (i < 0) return json(res, 404, { error: 'No such listing.' });
  store.places.splice(i, 1);
  db.save();
  json(res, 200, { ok: true });
});

/* TODA approval of driver accounts: a driver can go online only after this */
route('GET', /^\/api\/admin\/app-drivers$/, (req, res) => {
  if (!adminOk(req)) return json(res, 401, DENIED_ADMIN);
  json(res, 200, { pending: H.pendingDrivers() });
});
route('POST', /^\/api\/admin\/app-drivers\/([\w-]+)\/approve$/, (req, res, m) => {
  if (!adminOk(req)) return json(res, 401, DENIED_ADMIN);
  if (!H.approveDriver(m[1])) return json(res, 404, { error: 'No such driver account.' });
  saveHub();
  json(res, 200, { pending: H.pendingDrivers() });
});

route('POST', /^\/api\/admin\/reset$/, (req, res) => {
  if (!adminOk(req)) return json(res, 401, DENIED_ADMIN);
  db.reset();
  H.seedHub(); linkHub(); saveHub();
  json(res, 200, { ok: true, message: 'Database cleared.' });
});

route('POST', /^\/api\/drivers\/([\w-]+)\/check$/, (req, res, m) => {
  if (!db.rules().drivers.some(d => d.id === m[1])) return json(res, 404, { error: 'Unknown driver.' });
  json(res, driverOk(req, m[1]) ? 200 : 401, driverOk(req, m[1]) ? { ok: true } : DENIED_DRIVER);
});

route('GET', /^\/api\/health$/, (req, res) => {
  const store = db.load();
  json(res, 200, { ok: true, storage: db.mode(), trips: store.trips.length, reports: store.reports.length, time: new Date().toISOString() });
});

/* ---------------------------------------------------------------- static */
function serveStatic(req, res, pathname) {
  // The route and fare engines are shared with the browser, so routes and fares also work offline.
  if (pathname === '/lib/network.js' || pathname === '/lib/fare.js') {
    return fs.readFile(path.join(__dirname, 'src', path.basename(pathname)), (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  const clean = pathname === '/' || pathname === '/app' ? '/app.html'
              : pathname === '/classic' ? '/index.html'
              : pathname.startsWith('/t/') ? '/track.html'
              : pathname === '/driver' ? '/driver.html'
              : pathname === '/monitor' ? '/monitor.html'
              : pathname.startsWith('/r/') ? '/receipt.html'
              : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(clean).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

/* ---------------------------------------------------------------- server */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const query = Object.fromEntries(url.searchParams);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Driver-Pin, X-Admin-Key'
    });
    return res.end();
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.pattern);
    if (!m) continue;
    try {
      return await r.handler(req, res, m, query);
    } catch (err) {
      console.error('[error]', url.pathname, err.message);
      return json(res, 500, { error: err.message });
    }
  }

  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'No such endpoint.' });
  serveStatic(req, res, url.pathname);
});

db.init().then(storage => {
  if (!H.restore(db.load().hub)) H.seedHub();
  linkHub();
  setInterval(() => H.tick(), 700);
  // rides move between actions too (demo trikes, the 60 s answer window): keep the database close behind
  setInterval(() => { if (H.Hub.requests.some(r => ['requested', 'accepted', 'arrived', 'ontrip'].includes(r.status))) saveHub(); }, 15000);
  return storage;
}).then(storage => server.listen(PORT, '0.0.0.0', () => {
  const r = db.rules();
  console.log('');
  console.log('  PANAW server running');
  console.log('  ------------------------------------------');
  console.log(`  Passenger app : http://localhost:${PORT}`);
  console.log(`  Driver console: http://localhost:${PORT}/driver`);
  console.log(`  Monitor       : http://localhost:${PORT}/monitor`);
  lanAddresses().forEach(ip =>
    console.log(`  On this network: http://${ip}:${PORT}   <-- open this on the phone`));
  console.log('  ------------------------------------------');
  console.log(`  Ordinance: ${r.ordinance} (${r.lgu})`);
  console.log(`  Night window ${r.nightStart}:00-0${r.nightEnd}:00 · currently ${fare.isNight(new Date(), r) ? 'NIGHT' : 'DAY'}`);
  const { network: n, report } = net();
  console.log(`  Network: ${n.municipalities.length} municipalities · ${n.terminals.length} terminals · ${n.edges.length} route segments · data mode DEMONSTRATION`);
  if (!report.ok) report.errors.forEach(e => console.log(`  [data error] ${e}`));
  console.log(`  Storage: ${storage === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : 'data/db.json'}`);
  console.log(`  App accounts  : ${DEMO ? 'DEMO (sample accounts and simulated trikes, PANAW_DEMO=1)' : 'real sign-ups only'}`);
  console.log(`  Driver PINs: ${AUTH.driverPin ? 'required' : 'OFF (set DRIVER_PINS before going public)'} · Admin key: ${AUTH.adminKey ? 'required' : 'OFF (set ADMIN_KEY before going public)'}`);
  console.log('');
})).catch(err => { console.error('Could not open the database:', err.message); process.exit(1); });
