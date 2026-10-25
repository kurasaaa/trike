/* ============================================================================
   PANAW HUB: accounts, drivers, ride requests, safety watch, listings.
   One implementation, two hosts:
     - the browser runs it in the tab           (LOCAL DEMO MODE, works offline)
     - server.js runs it for every phone at once (CONNECTED CENTRALIZED MODE)
   Every change goes through ACTIONS, so both hosts apply the same rules.
   Fares come from src/fare.js and routes from src/network.js, unchanged.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanawHub = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const randomHex = n => {
  const b = new Uint8Array(n);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(b);
  else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
};

/* opts.hash / opts.verify: how passwords are kept. The server passes scrypt; the in-tab demo keeps them as typed. */
function create({ N, F, RAW, hash = p => p, verify = (p, h) => p === h }) {
const RULES = RAW.rules;
const NET = N.validate({
  province: RAW.municipalities.province, municipalities: RAW.municipalities.municipalities,
  defaultTerminalId: RAW.terminals.defaultTerminalId, terminals: RAW.terminals.terminals,
  destinations: RAW.destinations.destinations, settings: RAW.routes.settings,
  nodes: RAW.routes.nodes, edges: RAW.routes.edges, fareRules: RAW.fareRules.fareRules,
  demoVehicles: RAW.demoVehicles.vehicles, transportModes: RAW.transportModes.modes
}, RULES).network;
const FAST = { ...NET, settings: { ...NET.settings, costWeights: { distance: 0, time: 1 } } };
const SPEED = NET.settings.assumedSpeedKph || 20;
const DEMO_SPEEDUP = 30;              // demo trikes move 30x faster than real time so a ride takes seconds
const GPS_FRESH_MS = 30000;           // a driver's phone position counts as current for 30 s

const byId = (a, id) => a.find(x => x.id === id);
const muniName = id => (byId(NET.municipalities, id) || { name: id || '' }).name;
const short = s => String(s).replace(/ \(.*\)$/, '').replace(' town proper', '').replace(' TODA Terminal', ' Terminal');
const initials = name => String(name).replace(/".*?"/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const offMin = km => km / SPEED * 60;
const fmtMin = m => m < 1 ? 'under 1 min' : Math.ceil(m) + ' min';
const nearestNode = pos => NET.nodes.reduce((b, n) => { const km = F.haversineKm(pos, n); return km < b.km ? { n, km } : b; }, { n: null, km: Infinity });
const zero = id => ({ found: true, nodeIds: [id], steps: [byId(NET.nodes, id)].map(n => ({ ...n, municipalityName: muniName(n.municipality) })), segments: [], distanceKm: 0, estimatedMinutes: 0, municipalityNames: [], crossesMunicipalities: false });
const route = (net, a, b) => a === b ? zero(a) : N.findRoute(net, a, b);
// New Poblacion uses its TODA's fare card (data/fare_rules.json "npbtoda_card").
byId(NET.terminals, NET.defaultTerminalId).fareRuleId = 'npbtoda_card';

/* ---------- places ---------- */
const CATEGORY = { d5: 'Nature', d7: 'Heritage', d4: 'Ports', d6: 'Towns', d1: 'Schools', d8: 'Schools', d2: 'Essentials', d3: 'Essentials' };
const FEATURED = ['dest_guisi_lighthouse', 'dest_trappist_abbey', 'dest_raymen_beach', 'd7', 'dest_san_lorenzo_wind_farm', 'd5', 'dest_balaan_bukid', 'dest_tatlong_pulo'];
const PLACES = NET.destinations.filter(d => d.nodeId != null).map(d => {
  const n = byId(NET.nodes, d.nodeId);
  return { id: d.id, name: short(d.name), municipality: d.municipality, barangay: d.barangay || null, note: d.note || '',
    category: d.barangay ? 'Barangays' : d.category || CATEGORY[d.id] || (d.dataStatus === 'reference' ? 'Towns' : 'Other'),
    lat: n.lat, lng: n.lng, nodeId: d.nodeId, source: d.dataStatus, rank: FEATURED.indexOf(d.id), card: d.todaCard ? d.todaCard.special : null };
});

/* ---------- state ---------- */
const Hub = {
  accounts: [], drivers: {}, requests: [], listings: [], reports: [], operators: [], listeners: new Set(), seq: 1,
  emit() { this.listeners.forEach(f => f()); }
};
function seedHub() {
  Hub.accounts = [
    { id: 'u-ana', role: 'passenger', name: 'Ana Reyes', mobile: '09171234567', password: hash('demo1234'), history: [], ratings: [], demo: true,
      contacts: [{ id: 'c1', name: 'Elena Reyes', relation: 'Parent', mobile: '09170001111' }] },
    { id: 'u-bobong', role: 'driver', name: RULES.drivers[0].name, mobile: '09181234567', password: hash('demo1234'), history: [], demo: true,
      unit: RULES.drivers[0].id, vehicle: RULES.drivers[0].unit, plate: '6283-YB', terminalId: NET.defaultTerminalId, verified: true, earnings: 0 }
  ];
  Hub.requests = []; Hub.listings = []; Hub.reports = []; Hub.drivers = {};
  // DEMO operators only: no real names or numbers. Real operators sign up themselves.
  Hub.accounts.push({ id: 'u-vanop', role: 'operator', name: 'Demo Operator', mobile: '09191234567', password: hash('demo1234'), history: [], contacts: [], demo: true });
  Hub.operators = [
    { id: 'op-demo-van', owner: 'u-vanop', type: 'van', name: 'DEMO Van for hire', seats: 14, municipality: 'jordan', plate: 'DEMO',
      rate: 'Sample: ₱3,500 per day within Guimaras, fuel included', notes: 'Port and airport transfers, island tours.', contact: '', messenger: '', available: true, demo: true },
    { id: 'op-demo-jeep', owner: null, type: 'jeepney', name: 'DEMO Jeepney for hire', seats: 22, municipality: 'buenavista', plate: 'DEMO',
      rate: 'Sample: ₱2,500 per half day', notes: 'School trips, church groups, beach outings.', contact: '', messenger: '', available: true, demo: true }
  ];
  seedBots();
}
// other trikes on the road: the shipped DEMO vehicles, driven by the demo itself
function seedBots() {
  NET.demoVehicles.forEach((v, i) => {
    Hub.drivers[v.vehicleId] = { id: v.vehicleId, name: 'Demo driver ' + (i + 1), unit: v.vehicleId, vehicle: 'Tricycle', plate: 'DEMO',
      terminalId: v.terminalId, online: true, status: 'available', bot: true, sim: v, pos: null, ratings: (Hub.drivers[v.vehicleId] || {}).ratings || [] };
  });
}
seedHub();

/* the trike record of a driver account, made on first use */
function ensureDriver(a) {
  let d = Hub.drivers[a.unit];
  if (!d) {
    const t = byId(NET.terminals, a.terminalId) || byId(NET.terminals, NET.defaultTerminalId), n = byId(NET.nodes, t.nodeId);
    d = Hub.drivers[a.unit] = { id: a.unit, name: a.name, unit: a.unit, vehicle: a.vehicle, plate: a.plate, terminalId: t.id, online: false, status: 'offline', bot: false, pos: { lat: n.lat, lng: n.lng }, ratings: [] };
  }
  return d;
}
const gpsFresh = (d, now) => d.gps && now - d.gps.at < GPS_FRESH_MS;

/* where a trike is right now */
function tickPositions(now) {
  for (const d of Object.values(Hub.drivers)) {
    if (gpsFresh(d, now)) {
      // a real phone is reporting: its GPS is the position; the planned motion only gives the minutes left
      d.pos = { lat: d.gps.lat, lng: d.gps.lng };
      if (d.motion) { const m = d.motion, end = m.path[m.path.length - 1], a = approach(d.pos, end); d.remainingMin = a ? a.min : 0; }
    } else if (d.motion) {
      const m = d.motion, t = Math.min(1, (now - m.t0) / m.dur);
      d.pos = alongPath(m.path, t);
      if (d.detour && d.detour.until > now) d.pos = { lat: d.pos.lat + d.detour.dLat, lng: d.pos.lng };
      d.remainingMin = (1 - t) * m.min;
      if (t >= 1) { d.motion = null; m.done && m.done(); }
    } else if (d.bot && d.status === 'available') {
      const p = N.simulateDemoVehicle(d.sim, NET, now); if (p) d.pos = { lat: p.latitude, lng: p.longitude };
    }
  }
}
function alongPath(path, t) {
  const seg = [], total = path.slice(1).reduce((s, p, i) => { const k = F.haversineKm(path[i], p); seg.push(k); return s + k; }, 0);
  let d = t * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) { const f = seg[i] ? Math.min(1, d / seg[i]) : 1; return { lat: path[i].lat + (path[i + 1].lat - path[i].lat) * f, lng: path[i].lng + (path[i + 1].lng - path[i].lng) * f }; }
    d -= seg[i];
  }
  return path[path.length - 1];
}
/* ---------- safety: the trike's distance from the planned route ---------- */
const TOL = RULES.deviationToleranceKm || 0.35, CONFIRM_S = RULES.confirmWindowSeconds || 8;
function offRouteKm(p, path) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, F.distanceFromCorridorKm(p, path[i - 1], path[i]));
  return best;
}
const severity = km => km > TOL * 3 ? 'major' : km > TOL ? 'minor' : 'on_route';
function safetyEvent(req, type, extra = {}) { req.safety.push({ at: Date.now(), type, ...extra }); }
function sendAlert(req, how) {
  const p = byId(Hub.accounts, req.passengerId), d = Hub.drivers[req.driverId];
  const names = (p && p.contacts || []).map(c => c.name);
  if (!names.length) return false;
  safetyEvent(req, 'alert_sent', { how, notified: names, pos: d && d.pos ? { ...d.pos } : null });
  req.watch.prompt = null; req.watch.quietUntil = Date.now() + 60000;
  return true;
}
/* link: the live tracking page for this ride, when the ride runs on a server */
function alertText(req, e, link) {
  const d = Hub.drivers[req.driverId];
  const where = e.pos ? `https://maps.google.com/?q=${e.pos.lat.toFixed(5)},${e.pos.lng.toFixed(5)}` : 'unknown';
  return `PANAW SAFETY ALERT: ${req.passengerName || 'A passenger'} may need help. ${e.how === 'automatic' ? 'The tricycle left its route and the safety check went unanswered.' : 'The emergency button was pressed.'} `
    + `Tricycle unit ${d ? d.unit : ''}, plate ${d ? d.plate : ''}, driver ${d ? d.name : ''}. Last location ${new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${where}`
    + (link ? ` Follow the trip live: ${link}` : '');
}
function confirmSafe(req) { safetyEvent(req, 'safe_confirmed'); req.watch.prompt = null; req.watch.quietUntil = Date.now() + 60000; }
function watchRide(req, now) {
  const d = Hub.drivers[req.driverId]; if (!d || !d.pos) return;
  const W = req.watch;
  if (W.prompt) { if (now - W.prompt.at > CONFIRM_S * 1000) sendAlert(req, 'automatic'); return; }
  const km = offRouteKm(d.pos, [req.pickup, ...req.quote.steps]), sev = severity(km);
  if (sev === 'major' && now > W.quietUntil) { safetyEvent(req, 'deviation', { severity: 'major', km, pos: { ...d.pos } }); W.prompt = { at: now, km }; }
  else if (sev === 'minor' && now - (W.minorAt || 0) > 30000) { W.minorAt = now; safetyEvent(req, 'deviation', { severity: 'minor', km, pos: { ...d.pos } }); }
}
/* DEMO: push the trike off its route for a while, as the original's deviation buttons did */
function simulateDetour(req, km) { const d = Hub.drivers[req.driverId]; if (d) d.detour = { dLat: km / 111, until: Date.now() + 14000 }; }

function moveDriver(d, path, min, done) {
  d.motion = { path, min, t0: Date.now(), dur: Math.max(4000, min * 60000 / DEMO_SPEEDUP), done };
}
/* a trike's way to a point: onto the network, fastest stored route, last stretch */
function approach(from, to) {
  const a = nearestNode(from), b = nearestNode(to);
  const r = route(FAST, a.n.id, b.n.id);
  if (!r.found) return null;
  return { min: offMin(a.km) + r.estimatedMinutes + offMin(b.km), km: a.km + r.distanceKm + b.km,
    path: [from, ...r.steps.map(s => ({ lat: s.lat, lng: s.lng })), to] };
}
function availableTrikes(to, exclude = []) {
  return Object.values(Hub.drivers).filter(d => d.online && d.status === 'available' && d.pos && !exclude.includes(d.id))
    .map(d => ({ d, a: approach(d.pos, to) })).filter(x => x.a && F.haversineKm(x.d.pos, to) < 25).sort((x, y) => x.a.min - y.a.min);
}

/* ---------- quotes: the same fare engine, per leg ---------- */
function termRuleFor(municipality) {
  return NET.terminals.find(t => t.municipality === municipality && t.dataStatus === 'existing') || NET.terminals.find(t => t.municipality === municipality) || byId(NET.terminals, NET.defaultTerminalId);
}
function quote(fromNodeId, stopIds, opts, terminal) {
  const fr = N.fareRulesFor(RULES, NET, terminal), info = N.fareRuleInfo(RULES, NET, terminal);
  const set = byId(NET.fareRules, terminal.fareRuleId) || {};
  let at = fromNodeId; const legs = [];
  for (const id of stopIds) {
    const p = byId(PLACES, id); const r = route(NET, at, p.nodeId);
    if (!r.found) return { error: r.reason };
    // the TODA card's flat regular fare covers its own zone only; farther trips are special trips
    const outside = set.regularFlatInZoneOnly && p.municipality !== set.zone;
    const hire = outside ? 'special' : opts.hire;
    legs.push({ to: p, route: r, forcedSpecial: outside && opts.hire !== 'special',
      fare: F.computeFare({ distanceKm: r.distanceKm, passengers: opts.pax, discountedPax: opts.dpax, discountType: opts.disc, hireType: hire }, fr) });
    at = p.nodeId;
  }
  const steps = legs.flatMap((l, i) => i ? l.route.steps.slice(1) : l.route.steps);
  const munis = []; steps.forEach(s => { if (munis[munis.length - 1] !== s.municipalityName) munis.push(s.municipalityName); });
  return { legs, steps, munis, terminal, info, set, forcedSpecial: legs.some(l => l.forcedSpecial), total: legs.reduce((s, l) => s + l.fare.total, 0),
    km: legs.reduce((s, l) => s + l.route.distanceKm, 0), min: legs.reduce((s, l) => s + l.route.estimatedMinutes, 0) };
}
/* both ways to ride: a trike to the pickup (qp) or a fare ticket from the nearest terminal (qt) */
function rideQuotes(pickup, stops, o) {
  const snap = nearestNode(pickup);
  const qp = quote(snap.n.id, stops, o, termRuleFor(snap.n.municipality));
  const trikes = availableTrikes(pickup);
  // nearest terminal by its routing point
  const term = NET.terminals.map(t => ({ t, n: byId(NET.nodes, t.nodeId) })).map(x => ({ ...x, km: F.haversineKm(pickup, x.n) })).sort((a, b) => a.km - b.km)[0];
  const qt = quote(term.n.id, stops, o, term.t);
  return { snap, qp, qt, trikes, term };
}

/* ---------- ride requests ---------- */
function dispatch(req) {
  const pick = availableTrikes(req.pickup, req.declinedBy)[0];
  if (!pick) { req.status = 'nodriver'; Hub.emit(); return; }
  req.driverId = pick.d.id; req.askedAt = Date.now(); req.etaMin = pick.a.min; req.status = 'requested';
  pick.d.status = 'asked';
  if (pick.d.bot) setTimeout(() => { if (req.status === 'requested' && req.driverId === pick.d.id) acceptRide(req); }, 2500);
  Hub.emit();
}
function createRide(passenger, pickup, stopIds, q, opts) {
  const req = { id: 'R' + String(Hub.seq++).padStart(4, '0'), share: randomHex(10), passengerId: passenger.id, passengerName: passenger.name,
    pickup, stopIds, quote: q, opts, status: 'requested', declinedBy: [], createdAt: Date.now(),
    safety: [], watch: { prompt: null, quietUntil: 0 }, contacts: (passenger.contacts || []).map(c => c.name) };
  Hub.requests.unshift(req);
  dispatch(req);
  return req;
}
/* Terminal ride: the passenger is already in the unit, so the trip starts at "arrived".
   A unit not on PANAW gets a placeholder record; the passenger's phone GPS then tracks the ride. */
function boardRide(passenger, t, unitId) {
  let d = Hub.drivers[unitId];
  if (!d) d = Hub.drivers[unitId] = { id: unitId, name: 'Unit ' + unitId, unit: unitId, vehicle: 'Tricycle', plate: 'not on PANAW',
    terminalId: t.terminalId, online: false, status: 'busy', noApp: true, pos: null, ratings: [] };
  const n = byId(NET.nodes, t.nodeId);
  d.motion = null; d.status = 'busy'; d.pos = { lat: n.lat, lng: n.lng };
  const req = { id: 'R' + String(Hub.seq++).padStart(4, '0'), share: randomHex(10), kind: 'terminal', ticket: t.code, passengerId: passenger.id, passengerName: passenger.name,
    pickup: { lat: n.lat, lng: n.lng, label: t.terminal }, stopIds: t.stops.slice(), quote: t.quote, opts: t.opts, status: 'arrived',
    driverId: d.id, declinedBy: [], createdAt: Date.now(), safety: [], watch: { prompt: null, quietUntil: 0 }, contacts: (passenger.contacts || []).map(c => c.name) };
  Hub.requests.unshift(req); Hub.emit();
  return req;
}
const passengerDrives = d => !d || d.noApp || d.bot || !d.online;   // nobody else can press Start / End for this ride
function acceptRide(req) {
  const d = Hub.drivers[req.driverId]; if (!d || req.status !== 'requested') return;
  const a = approach(d.pos, req.pickup);
  req.status = 'accepted'; req.acceptedAt = Date.now(); d.status = 'busy';
  moveDriver(d, a.path, a.min, () => { if (req.status === 'accepted') { req.status = 'arrived'; Hub.emit(); if (d.bot) setTimeout(() => startRide(req), 2500); } });
  Hub.emit();
}
function declineRide(req) {
  const d = Hub.drivers[req.driverId]; if (d) d.status = 'available';
  req.declinedBy.push(req.driverId); req.driverId = null;
  dispatch(req);
}
function arrivedRide(req) {
  const d = Hub.drivers[req.driverId]; if (d) { d.motion = null; d.pos = { ...req.pickup }; }
  req.status = 'arrived'; Hub.emit();
}
function startRide(req) {
  if (req.status !== 'arrived') return;
  const d = Hub.drivers[req.driverId];
  req.status = 'ontrip'; req.startedAt = Date.now();
  const path = [req.pickup, ...req.quote.steps.map(s => ({ lat: s.lat, lng: s.lng }))];
  moveDriver(d, path, req.quote.min + offMin(nearestNode(req.pickup).km), () => { if (req.status === 'ontrip') { req.reachedDest = true; Hub.emit(); if (d.bot) setTimeout(() => completeRide(req), 1500); } });
  Hub.emit();
}
function completeRide(req) {
  if (req.status !== 'ontrip') return;
  const d = Hub.drivers[req.driverId];
  req.status = 'completed'; req.completedAt = Date.now();
  if (d) { d.motion = null; d.status = d.noApp ? 'offline' : 'available'; const last = req.quote.steps[req.quote.steps.length - 1]; d.pos = { lat: last.lat, lng: last.lng }; }
  const rec = { id: req.id, kind: 'ride', at: req.completedAt, from: req.pickup.label, to: req.stopIds.map(id => byId(PLACES, id).name), fare: req.quote.total,
    km: req.quote.km, driver: d ? d.name : '', unit: d ? d.unit : '', plate: d ? d.plate : '', fareStatus: req.quote.info.status, ticket: req.ticket || null,
    legs: req.quote.legs.map(l => ({ to: l.to.name, km: l.route.distanceKm, fare: l.fare })), ordinance: req.quote.info.ordinance, safety: req.safety.slice(), opts: req.opts };
  const p = byId(Hub.accounts, req.passengerId); if (p) p.history.unshift(rec);
  const da = Hub.accounts.find(a => a.role === 'driver' && a.unit === req.driverId);
  if (da) { da.history.unshift({ ...rec, passenger: req.passengerName }); da.earnings += req.quote.total; }
  Hub.emit();
}
function cancelRide(req) {
  const d = Hub.drivers[req.driverId]; if (d) { d.motion = null; d.status = 'available'; }
  req.status = 'cancelled'; Hub.emit();
}
/* average stars a unit has received, or null before its first rating */
function ratingOf(unitId) {
  const r = (Hub.drivers[unitId] || {}).ratings || [];
  return r.length ? { avg: r.reduce((s, x) => s + x.stars, 0) / r.length, n: r.length } : null;
}

/* the clock: both hosts call this every 700 ms */
function tick(now = Date.now()) {
  tickPositions(now);
  for (const r of Hub.requests) {
    if (r.status === 'requested' && now - r.askedAt > 60000) declineRide(r);   // no answer in 60 s: next trike
    if (r.status === 'ontrip') watchRide(r, now);
  }
  Hub.emit();
}

/* =====================================================================
   ACTIONS: every change a phone can ask for. me = the signed-in account.
   Each returns a result object, or { error } with a message for the user.
   ===================================================================== */
const ACTIVE = ['requested', 'accepted', 'arrived', 'ontrip'];
const MOBILE = /^09\d{9}$/;
const mine = (me, id) => { const r = byId(Hub.requests, id); return r && me && r.passengerId === me.id ? r : null; };
const jobOf = (me, id) => { const r = byId(Hub.requests, id); return r && me && me.role === 'driver' && r.driverId === me.unit ? r : null; };
const okPos = p => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
const cleanOpts = o => {
  const pax = Math.min(4, Math.max(1, Math.round(+o.pax) || 1)), disc = ['student', 'senior', 'pwd'].includes(o.disc) ? o.disc : 'none';
  return { pax, hire: o.hire === 'special' ? 'special' : 'regular', disc, dpax: disc === 'none' ? 0 : Math.min(pax, Math.max(1, Math.round(+o.dpax) || 1)) };
};
const cleanStops = s => Array.isArray(s) && s.length >= 1 && s.length <= 5 && s.every(id => byId(PLACES, id)) ? s.slice() : null;
const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

const ACTIONS = {
  signup(me, v) {
    v = Object.fromEntries(Object.entries(v || {}).map(([k, x]) => [k, txt(x, 200)]));
    const role = ['passenger', 'driver', 'operator'].includes(v.role) ? v.role : 'passenger';
    const err = !v.name || v.name.length < 3 ? 'Enter your full name.' : !MOBILE.test(v.mobile) ? 'Enter an 11-digit mobile number starting with 09.'
      : v.password.length < 8 ? 'Use at least 8 characters for the password.' : Hub.accounts.some(a => a.mobile === v.mobile) ? 'That mobile number already has an account.'
      : role === 'driver' && !/^[A-Z]{2,6}-\d{3,5}$/i.test(v.unit) ? 'Enter the unit number your TODA gave you, e.g. BTODA-0301.'
      : role === 'driver' && Hub.accounts.some(a => a.unit === v.unit.toUpperCase()) ? 'That unit already has a driver account.'
      : role === 'driver' && !v.plate ? 'Enter the plate number.'
      : role === 'driver' && !byId(NET.terminals, v.terminalId) ? 'Choose your TODA / terminal.'
      : role === 'operator' && !(+v.oseats >= 4 && +v.oseats <= 40) ? 'Enter the number of seats (4 to 40).'
      : role === 'operator' && v.oname.length < 3 ? 'Enter the name passengers will see.'
      : role === 'operator' && !v.oplate ? 'Enter the plate number.'
      : role === 'operator' && v.orate.length < 3 ? 'Enter your rate, e.g. ₱3,500 per day.'
      : role === 'operator' && !['van', 'jeepney'].includes(v.otype) ? 'Choose the vehicle.'
      : role === 'operator' && !byId(NET.municipalities, v.omuni) ? 'Choose where the vehicle is based.'
      : role === 'operator' && v.omsg && !/^https:\/\/(m\.me|www\.facebook\.com|facebook\.com)\//.test(v.omsg) ? 'The link must start with https://m.me/ or https://facebook.com/' : '';
    if (err) return { error: err };
    const acc = { id: 'u-' + randomHex(8), role, name: v.name, mobile: v.mobile, password: hash(v.password), history: [], contacts: [] };
    if (role === 'driver') Object.assign(acc, { unit: v.unit.toUpperCase(), plate: v.plate.toUpperCase(), license: v.license, terminalId: v.terminalId, vehicle: 'Tricycle', verified: false, earnings: 0 });
    Hub.accounts.push(acc);
    if (role === 'operator') Hub.operators.push({ id: 'op-' + randomHex(6), owner: acc.id, type: v.otype, name: v.oname, seats: +v.oseats, municipality: v.omuni,
      plate: v.oplate.toUpperCase(), rate: v.orate, notes: '', contact: v.mobile, messenger: v.omsg, available: true, demo: false });
    if (role === 'driver') ensureDriver(acc);
    return { account: acc };
  },
  login(me, v) {
    const a = Hub.accounts.find(x => x.mobile === txt(v && v.mobile, 20));
    if (!a || !verify(String((v && v.password) || ''), a.password)) return { error: 'Wrong mobile number or password.' };
    if (a.role === 'driver') ensureDriver(a);
    return { account: a };
  },
  logout(me) {
    if (me && me.role === 'driver') { const d = Hub.drivers[me.unit]; if (d) { d.online = false; d.status = 'offline'; d.gps = null; } }
    return {};
  },
  /* passenger */
  book(me, p) {
    const stops = cleanStops(p.stops); if (!stops || !okPos(p.pickup)) return { error: 'Choose where you are and where you are going.' };
    if (Hub.requests.some(r => r.passengerId === me.id && ACTIVE.includes(r.status))) return { error: 'You already have a ride in progress.' };
    const pickup = { lat: +p.pickup.lat, lng: +p.pickup.lng, label: txt(p.pickup.label, 80) || 'Pinned on the map', src: txt(p.pickup.src, 10) };
    if (nearestNode(pickup).km > 25) return { error: 'That pickup is outside Guimaras.' };
    const opts = cleanOpts(p.opts || {}), q = rideQuotes(pickup, stops, opts).qp;   // the fare is computed here, never taken from the phone
    if (q.error) return { error: q.error };
    return { id: createRide(me, pickup, stops, q, opts).id };
  },
  ticket(me, p) {
    const stops = cleanStops(p.stops); if (!stops || !okPos(p.pickup)) return { error: 'Choose where you are and where you are going.' };
    const opts = cleanOpts(p.opts || {}), { qt, term } = rideQuotes({ lat: +p.pickup.lat, lng: +p.pickup.lng }, stops, opts);
    if (qt.error) return { error: qt.error };
    const t = { code: 'PN-' + randomHex(3).slice(0, 5).toUpperCase(), terminal: term.t.name, to: stops.map(id => byId(PLACES, id).name).join(' → '),
      total: qt.total, km: qt.km, pax: opts.pax, ordinance: qt.info.ordinance || '', status: qt.info.status,
      terminalId: term.t.id, nodeId: term.n.id, stops, quote: qt, opts };
    me.tickets = [t, ...(me.tickets || [])].slice(0, 5);
    me.history.unshift({ id: t.code, kind: 'ticket', at: Date.now(), from: term.t.name, to: stops.map(id => byId(PLACES, id).name), fare: qt.total, km: qt.km, driver: '' });
    return { ticket: t };
  },
  board(me, p) {
    const t = (me.tickets || []).find(x => x.code === p.code); if (!t) return { error: 'That fare ticket was not found. Get a new one.' };
    const unit = txt(p.unit, 20).toUpperCase(), typed = !!p.typed;
    // a unit picked from the list is already known; only a typed one needs checking
    if (typed && (unit === t.code.toUpperCase() || /^PN-/.test(unit))) return { error: 'That is your ticket code. Enter the unit number painted on the tricycle.' };
    if (typed && (!/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(unit) || unit.length < 3)) return { error: 'Enter the unit number painted on the tricycle, e.g. BTODA-0315' };
    if (!typed && !Hub.drivers[unit]) return { error: 'Choose your tricycle from the list.' };
    if (Hub.requests.some(r => r.passengerId === me.id && ACTIVE.includes(r.status))) return { error: 'You already have a ride in progress.' };
    me.tickets = me.tickets.filter(x => x !== t);
    return { id: boardRide(me, t, unit).id };
  },
  cancel(me, p) { const r = mine(me, p.id); if (r && ACTIVE.concat('nodriver').includes(r.status)) { if (r.status === 'nodriver') r.status = 'cancelled'; else cancelRide(r); } return {}; },
  retry(me, p) { const r = mine(me, p.id); if (!r || r.status !== 'nodriver') return { error: 'Nothing to retry.' }; r.declinedBy = []; dispatch(r); return {}; },
  sos(me, p) { const r = mine(me, p.id); if (!r || !ACTIVE.includes(r.status)) return { error: 'No trip in progress.' }; return sendAlert(r, 'manual') ? {} : { error: 'No emergency contacts to alert' }; },
  safe(me, p) { const r = mine(me, p.id); if (r) confirmSafe(r); return {}; },
  detour(me, p) { const r = mine(me, p.id); if (r && r.status === 'ontrip') simulateDetour(r, Math.min(3, Math.max(0, +p.km || 0))); return {}; },
  pstart(me, p) { const r = mine(me, p.id); if (r && passengerDrives(Hub.drivers[r.driverId])) startRide(r); return {}; },
  pend(me, p) { const r = mine(me, p.id); if (r && passengerDrives(Hub.drivers[r.driverId])) completeRide(r); return {}; },
  rate(me, p) {
    const r = mine(me, p.id), stars = Math.round(+p.stars);
    if (!r || r.status !== 'completed' || !(stars >= 1 && stars <= 5)) return { error: 'You can rate a finished ride only.' };
    const d = Hub.drivers[r.driverId]; if (!d) return {};
    d.ratings = (d.ratings || []).filter(x => x.rideId !== r.id).concat({ rideId: r.id, stars, at: Date.now() }).slice(-200);
    r.rating = stars; const h = (me.history || []).find(x => x.id === r.id); if (h) h.rating = stars;
    return {};
  },
  addContact(me, v) {
    const name = txt(v.name, 60), mobile = txt(v.mobile, 20);
    if (name.length < 3) return { error: 'Enter the contact\'s full name' };
    if (!MOBILE.test(mobile)) return { error: 'Enter an 11-digit mobile number starting with 09' };
    if ((me.contacts || []).length >= 5) return { error: 'Up to 5 contacts.' };
    (me.contacts = me.contacts || []).push({ id: 'c' + randomHex(4), name, relation: txt(v.relation, 20) || 'Other', mobile });
    return {};
  },
  rmContact(me, p) { me.contacts = (me.contacts || []).filter(x => x.id !== p.id); return {}; },
  report(me, v) {
    const r = { ref: 'FR-' + (1001 + Hub.reports.length), rideId: txt(v.rideId, 20), by: me.id, type: txt(v.type, 80), details: txt(v.details, 800), at: Date.now() };
    Hub.reports.push(r); return { ref: r.ref };
  },
  publish(me, v) {
    if (txt(v.name, 80).length < 3) return { error: 'Enter the name of the place' };
    if (!okPos(v)) return { error: 'Tap the map to set the location' };
    const photos = Array.isArray(v.photos) ? v.photos.slice(0, 3) : [];
    const item = { id: 'PL-' + randomHex(5).toUpperCase(), name: txt(v.name, 80), municipality: v.municipality, lat: +v.lat, lng: +v.lng,
      description: txt(v.description, 600), contact: txt(v.contact, 80), photos, owner: me ? me.id : null, kind: txt(v.kind, 40) };
    const err = ACTIONS.checkListing && ACTIONS.checkListing(item); if (err) return { error: err };
    Hub.listings.unshift(item); return { id: item.id };
  },
  /* operator */
  opToggle(me, p) { const o = Hub.operators.find(x => x.id === p.id && x.owner === me.id); if (o) o.available = !o.available; return {}; },
  opSave(me, v) {
    const o = Hub.operators.find(x => x.id === v.id && x.owner === me.id); if (!o) return { error: 'Not your listing.' };
    if (txt(v.rate, 120).length < 3) return { error: 'Enter your rate' };
    if (!(+v.seats >= 4 && +v.seats <= 40)) return { error: 'Seats must be 4 to 40' };
    Object.assign(o, { rate: txt(v.rate, 120), seats: +v.seats, notes: txt(v.notes, 300) }); return {};
  },
  /* driver */
  verify(me) { if (me.role === 'driver') me.verified = true; return {}; },   // DEMO: the TODA officer's check
  online(me, p) {
    if (me.role !== 'driver' || !me.verified) return { error: 'Your unit is not confirmed yet.' };
    const d = ensureDriver(me); if (ACTIVE.some(s => Hub.requests.some(r => r.driverId === d.id && r.status === s)) && !p.on) return { error: 'Finish your trip first.' };
    d.online = !!p.on; d.status = d.online ? 'available' : 'offline'; if (!d.online) d.gps = null;
    Hub.emit(); return {};
  },
  gps(me, p) {
    if (me.role !== 'driver' || !okPos(p)) return {};
    const d = ensureDriver(me); if (d.online || d.status === 'busy') d.gps = { lat: +p.lat, lng: +p.lng, at: Date.now() };
    return {};
  },
  job(me, p) {
    const r = jobOf(me, p.id); if (!r) return { error: 'That trip is no longer yours.' };
    const fn = { accept: acceptRide, decline: declineRide, arrived: arrivedRide, start: startRide, complete: completeRide }[p.move];
    if (!fn) return { error: 'Unknown step.' };
    fn(r); return { fare: r.quote.total };
  }
};
function run(name, me, payload) {
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, name) || name === 'checkListing') return { error: 'Unknown action.' };
  if (!me && !['signup', 'login', 'publish'].includes(name)) return { error: 'Log in first.' };
  return ACTIONS[name](me, payload || {});
}

/* =====================================================================
   What one signed-in phone may see. The server sends only this.
   A driver never sees the passenger's contacts or alerts (silent alarm).
   ===================================================================== */
const publicAccount = a => { const { password, tickets, ...rest } = a; return { ...rest, tickets: (tickets || []).map(t => ({ ...t })) }; };
const publicDriver = d => ({ id: d.id, name: d.name, unit: d.unit, vehicle: d.vehicle, plate: d.plate, terminalId: d.terminalId, online: d.online, status: d.status,
  bot: !!d.bot, noApp: !!d.noApp, pos: d.pos, remainingMin: d.remainingMin, ratings: (d.ratings || []).map(x => ({ stars: x.stars })), gps: !!(d.gps && Date.now() - d.gps.at < GPS_FRESH_MS) });
function driverCopy(r) {
  const { contacts, watch, ...rest } = r;
  return { ...rest, watch: { prompt: null, quietUntil: 0 }, safety: r.safety.filter(e => e.type === 'deviation').map(e => ({ ...e, pos: null })) };
}
function view(me) {
  const unit = me && me.role === 'driver' ? me.unit : null;
  const reqs = me ? Hub.requests.filter(r => r.passengerId === me.id || (unit && r.driverId === unit)).slice(0, 30) : [];
  const drivers = {};
  for (const d of Object.values(Hub.drivers)) if (d.online || d.status === 'busy' || d.id === unit || reqs.some(r => r.driverId === d.id)) drivers[d.id] = publicDriver(d);
  return {
    me: me ? publicAccount(me) : null,
    accounts: me ? [publicAccount(me)] : [],
    drivers,
    requests: reqs.map(r => r.passengerId === (me && me.id) ? r : driverCopy(r)),
    listings: Hub.listings.map(({ ownerKey, ...l }) => ({ ...l, kind: l.kind || l.category, owner: l.owner || null, photos: l.photos || [] })),
    operators: Hub.operators,
    reports: me ? Hub.reports.filter(r => r.by === me.id) : [],
    seq: Hub.seq, serverTime: Date.now()
  };
}
/* the public tracking page for a shared ride: no account needed, only the unguessable share code */
function trackView(share) {
  const r = Hub.requests.find(x => x.share && x.share === share);
  if (!r || (['completed', 'cancelled'].includes(r.status) && Date.now() - (r.completedAt || r.createdAt) > 2 * 3600e3)) return null;
  const d = Hub.drivers[r.driverId];
  return { status: r.status, passenger: String(r.passengerName || '').split(' ')[0], from: r.pickup.label, to: r.stopIds.map(id => byId(PLACES, id).name),
    unit: d ? d.unit : null, plate: d ? d.plate : null, driver: d ? d.name : null, pos: d && d.pos ? d.pos : null,
    source: d && d.gps && Date.now() - d.gps.at < GPS_FRESH_MS ? 'gps' : 'simulated', remainingMin: d ? d.remainingMin || 0 : null,
    path: [r.pickup, ...r.quote.steps].map(p => ({ lat: p.lat, lng: p.lng })), alerted: r.safety.some(e => e.type === 'alert_sent'), at: Date.now() };
}

/* ---------- saving and restoring (server: database; tab: browser storage) ---------- */
function dump() {
  return { v: 1, seq: Hub.seq, accounts: Hub.accounts, operators: Hub.operators, reports: Hub.reports.slice(-500),
    requests: Hub.requests.slice(0, 200).map(({ watch, ...r }) => ({ ...r, watch: { prompt: null, quietUntil: 0 } })),
    drivers: Object.values(Hub.drivers).map(({ motion, sim, gps, ...d }) => d) };
}
function restore(s) {
  if (!s || s.v !== 1) return false;
  Object.assign(Hub, { seq: s.seq, accounts: s.accounts, operators: s.operators, reports: s.reports, requests: s.requests, drivers: {} });
  for (const d of s.drivers) if (!d.bot) Hub.drivers[d.id] = { ...d, motion: null, gps: null };
  const old = Object.fromEntries(s.drivers.filter(d => d.bot).map(d => [d.id, d]));
  NET.demoVehicles.forEach(v => { Hub.drivers[v.vehicleId] = { ratings: (old[v.vehicleId] || {}).ratings || [] }; });
  seedBots();
  // shortcut: a trike's planned motion is not saved, so rides that were moving end here; save motions if restarts mid-ride matter
  for (const r of Hub.requests) if (ACTIVE.includes(r.status)) {
    const d = Hub.drivers[r.driverId];
    if (!d || d.bot || r.status === 'requested') { r.status = 'cancelled'; if (d && !d.noApp) d.status = d.online ? 'available' : 'offline'; }
  }
  return true;
}

return { RULES, NET, FAST, SPEED, DEMO_SPEEDUP, TOL, CONFIRM_S, PLACES, FEATURED, Hub, ACTIONS,
  byId, muniName, short, initials, offMin, fmtMin, nearestNode, route, ensureDriver, seedHub, tick, run, view, trackView, dump, restore,
  approach, availableTrikes, termRuleFor, quote, rideQuotes, alertText, passengerDrives, ratingOf, offRouteKm,
  // the ride steps, for the in-tab demo and tests
  dispatch, createRide, boardRide, acceptRide, declineRide, arrivedRide, startRide, completeRide, cancelRide, sendAlert, confirmSafe, watchRide, simulateDetour };
}
return { create };
});
