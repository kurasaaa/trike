'use strict';
/* ============================================================================
   PICK-UP REQUESTS
   A passenger asks one online trike to come to a pin (not to a terminal).
   requested → accepted → arrived, or declined / cancelled / expired.
   If a destination is given, the fare is computed here with the same fare
   engine and the fare rule of the driver's terminal, so the driver sees the
   amount the passenger saw. The pick-up distance itself is not charged: no
   ordinance sets a pick-up fee.
   Shared by server.js and the Android embedded server.
   ========================================================================== */

const crypto = require('crypto');
const fare = require('./fare');
const network = require('./network');
const { BOUNDS } = require('./places');

const EXPIRE_MS = 2 * 60 * 1000;          // a driver who has not answered in 2 minutes is not coming
const DRIVER_FRESH_MS = 5 * 60 * 1000;    // older positions do not count as "online"
const MAX_SNAP_KM = 3;                    // same limit the passenger app uses
const OPEN = ['requested', 'accepted'];

const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function nearestNode(net, pos) {
  let best = null;
  for (const n of net.nodes) {
    const km = fare.haversineKm(pos, n);
    if (!best || km < best.km) best = { n, km };
  }
  return best;
}

/** Status as of `now`: an unanswered request turns into "expired". */
function statusAt(p, now) {
  return p.status === 'requested' && now - Date.parse(p.createdAt) > EXPIRE_MS ? 'expired' : p.status;
}

/**
 * Validate a request. ctx: { net, rules, vehicles (store.vehicles), pickups, overrides, now }.
 * Returns { error, code } or { pickup }.
 */
function createPickup(body, ctx) {
  const { net, rules, vehicles, pickups, overrides } = ctx;
  const now = ctx.now || Date.now();
  const deviceKey = text(body.deviceKey, 64);
  if (deviceKey.length < 16) return { error: 'Missing device key.', code: 400 };
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) {
    return { error: 'The pick-up point must be in Guimaras.', code: 400 };
  }
  const v = vehicles[body.vehicleId];
  const driver = (rules.drivers || []).find(d => d.id === body.vehicleId);
  if (!v || !driver || v.status !== 'available' || now - Date.parse(v.timestamp) > DRIVER_FRESH_MS) {
    return { error: 'That trike is no longer online. Choose another one.', code: 409 };
  }
  if (pickups.some(p => p.vehicleId === driver.id && OPEN.includes(statusAt(p, now)))) {
    return { error: 'That trike already has a pick-up request. Choose another one.', code: 409 };
  }
  if (pickups.some(p => p.deviceKey === deviceKey && OPEN.includes(statusAt(p, now)))) {
    return { error: 'You already have an open pick-up request. Cancel it first.', code: 409 };
  }
  const snap = nearestNode(net, { lat, lng });
  if (!snap || snap.km > MAX_SNAP_KM) return { error: 'The pick-up point is too far from the route network.', code: 400 };

  // optional destination: route from the nearest stored point, priced with the driver's terminal rule
  let destination = null, route = null, quote = null;
  if (body.destinationId) {
    const d = net.destinations.find(x => x.id === body.destinationId);
    if (!d || d.nodeId == null) return { error: 'Unknown destination.', code: 400 };
    destination = { id: d.id, name: d.name };
    if (d.nodeId !== snap.n.id) {
      const r = network.findRoute(net, snap.n.id, d.nodeId, { overrides });
      if (!r.found) return { error: 'NO ROUTE AVAILABLE', reason: r.reason, code: 422 };
      const term = net.terminals.find(t => t.id === v.terminalId) || net.terminals.find(t => t.id === net.defaultTerminalId);
      const fr = network.fareRulesFor(rules, net, term);
      if (!fr) return { error: 'Missing fare rule for this trike\'s terminal.', code: 400 };
      route = { distanceKm: r.distanceKm, estimatedMinutes: r.estimatedMinutes, steps: r.steps.map(s => s.name) };
      quote = { ...fare.computeFare({ ...body, distanceKm: r.distanceKm }, fr), fareStatus: network.fareRuleInfo(rules, net, term).status };
    }
  }
  const at = new Date(now).toISOString();
  return {
    pickup: {
      id: 'PU-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      vehicleId: driver.id, driverName: driver.name, unit: driver.unit,
      pin: { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 },
      label: text(body.label, 80) || 'Pin on the map',
      nearestStop: { id: snap.n.id, name: snap.n.name, km: Math.round(snap.km * 100) / 100 },
      destination, route, fare: quote,
      etaMinutes: Number.isFinite(Number(body.etaMinutes)) ? Math.max(0, Math.min(240, Math.round(Number(body.etaMinutes)))) : null,
      status: 'requested', createdAt: at, updatedAt: at, deviceKey
    }
  };
}

const MOVES = {
  accept:  { from: ['requested'], to: 'accepted', by: 'driver' },
  decline: { from: ['requested'], to: 'declined', by: 'driver' },
  arrived: { from: ['accepted'],  to: 'arrived',  by: 'driver' },
  cancel:  { from: ['requested', 'accepted'], to: 'cancelled', by: 'passenger' }
};
/** Apply an action in place. Returns an error message, or null. */
function move(p, action, now = Date.now()) {
  const m = MOVES[action];
  if (!m) return 'Unknown action.';
  const cur = statusAt(p, now);
  if (!m.from.includes(cur)) return `This request is ${cur}.`;
  p.status = m.to;
  p.updatedAt = new Date(now).toISOString();
  if (m.to === 'accepted') p.acceptedAt = p.updatedAt;
  return null;
}

/** What anyone polling sees: never the device key. */
function publicPickup(p, now = Date.now()) {
  const { deviceKey, ...rest } = p;
  return { ...rest, status: statusAt(p, now) };
}

const isOpen = (p, now = Date.now()) => OPEN.includes(statusAt(p, now));

module.exports = { createPickup, move, publicPickup, statusAt, isOpen, MOVES, EXPIRE_MS, DRIVER_FRESH_MS };
