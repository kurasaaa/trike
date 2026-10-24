'use strict';
/* ============================================================================
   TRIP LIFECYCLE
   ----------------------------------------------------------------------------
        quoted  (never stored — a quote is just arithmetic)
          |
          v  POST /api/trips
        locked        fare frozen, receipt signature already computable
          |
          v  POST /api/trips/:id/accept
       accepted       a driver is bound to it
          |
          v  POST /api/trips/:id/start
      in_progress     safety monitoring is live
          |
          v  POST /api/trips/:id/complete
       completed      immutable; receipt is public

   Notice what is missing: there is no transition, and no endpoint, that
   changes `fare` after `locked`. That absence is the product.
   ========================================================================== */

const crypto = require('crypto');
const { computeFare, distanceFromCorridorKm } = require('./fare');

const SECRET = process.env.TRIKEFAIR_SECRET || 'trikefair-prototype-key';

const TERMINAL_STATES = new Set(['completed', 'cancelled']);

function newId() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `TRK-${stamp}-${rand}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

/** HMAC over the fields a forger would want to change. */
function signature(trip) {
  return crypto.createHmac('sha256', SECRET)
    .update(`${trip.id}|${trip.fare.total}|${trip.lockedAt}`)
    .digest('hex').slice(0, 12).toUpperCase();
}
function verify(trip, sig) {
  const expected = signature(trip);
  const a = Buffer.from(expected), b = Buffer.from(String(sig || '').toUpperCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Create a locked trip. The fare is RECOMPUTED here; any amount the client
 *  sent is ignored entirely.
 *
 *  `resolved` comes from the route engine (src/network.js resolveTrip): the
 *  terminal, the route found on the network, and the fare rules for that
 *  terminal. The route only supplies the distance — the money still comes
 *  from computeFare(). Without `resolved`, the original single-terminal
 *  lookup in rules.json is used. */
function createTrip(body, rules, resolved) {
  let dest, origin, fareRules = rules, ordinance = { lgu: rules.lgu, ordinance: rules.ordinance }, expansion = {};
  if (resolved) {
    const r = resolved;
    dest = { ...r.destination, km: r.route.distanceKm };
    origin = { name: r.terminal.name, lat: r.terminal.lat, lng: r.terminal.lng };
    fareRules = r.fareRules;
    ordinance = { lgu: r.fareRule.lgu, ordinance: r.fareRule.ordinance };
    expansion = {
      municipality: r.terminal.municipality,
      terminal: { id: r.terminal.id, name: r.terminal.name, municipality: r.terminal.municipality,
                  municipalityName: r.terminal.municipalityName, dataStatus: r.terminal.dataStatus },
      route: { nodeIds: r.route.nodeIds, steps: r.route.steps.map(s => ({ name: s.name, municipalityName: s.municipalityName })),
               distanceKm: r.route.distanceKm, estimatedMinutes: r.route.estimatedMinutes,
               municipalityNames: r.route.municipalityNames, dataStatus: r.route.dataStatus },
      transportMode: r.route.transportMode,
      fareRule: { id: r.fareRule.id, label: r.fareRule.label, status: r.fareRule.status, isDemo: r.fareRule.isDemo }
    };
  } else {
    dest = rules.destinations.find(d => d.id === body.destinationId);
    if (!dest) return { error: 'Unknown destination.' };
    origin = { name: rules.terminal, ...rules.terminalCoords };
  }

  const fare = computeFare({
    distanceKm:    dest.km,
    passengers:    body.passengers,
    discountedPax: body.discountedPax,
    discountType:  body.discountType,
    hireType:      body.hireType
  }, fareRules);

  const now = new Date().toISOString();
  return {
    trip: {
      id: newId(),
      status: 'locked',
      createdAt: now,
      lockedAt: now,
      acceptedAt: null,
      startedAt: null,
      completedAt: null,
      passengerDevice: String(body.deviceId || 'unknown').slice(0, 40),
      origin,
      destination: { id: dest.id, name: dest.name, km: dest.km, lat: dest.lat, lng: dest.lng },
      hireType: fare.hireType,
      passengers: fare.passengers,
      discountType: fare.discountType,
      discountedPax: fare.discountedPax,
      fare,
      driver: null,
      preferredDriverId: body.preferredDriverId || null,
      emergencyContacts: sanitizeContacts(body.emergencyContacts),
      events: [{ at: now, type: 'fare_locked', note: `Fare locked at ₱${fare.total.toFixed(2)}` }],
      ordinance,
      ...expansion
    }
  };
}

/** The structured trip record (municipality, terminal, route, fare, mode, time). */
function tripRecord(trip) {
  return {
    tripId: trip.id,
    municipality: trip.terminal ? trip.terminal.municipalityName : null,
    terminal: trip.origin ? trip.origin.name : null,
    destination: trip.destination.name,
    distance: trip.destination.km,
    estimatedTime: trip.route ? trip.route.estimatedMinutes : null,
    fare: trip.fare.total,
    transportMode: trip.transportMode || 'tricycle',
    status: trip.status,
    timestamp: trip.completedAt || trip.lockedAt
  };
}

function sanitizeContacts(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 5).map(c => ({
    name: String(c.name || '').slice(0, 60),
    relation: String(c.relation || '').slice(0, 30),
    phone: String(c.phone || '').slice(0, 25)
  })).filter(c => c.name && c.phone);
}

function accept(trip, driver) {
  if (trip.status !== 'locked') return { error: `Trip is already ${trip.status}.` };
  trip.driver = { id: driver.id, name: driver.name, unit: driver.unit, rating: driver.rating };
  trip.status = 'accepted';
  trip.acceptedAt = new Date().toISOString();
  trip.events.push({ at: trip.acceptedAt, type: 'accepted', note: `${driver.name} (${driver.id}) accepted the trip` });
  return { trip };
}

function start(trip) {
  if (trip.status !== 'accepted') return { error: `Cannot start a trip that is ${trip.status}.` };
  trip.status = 'in_progress';
  trip.startedAt = new Date().toISOString();
  trip.events.push({ at: trip.startedAt, type: 'started', note: 'Departed the terminal' });
  return { trip };
}

/**
 * Record a safety or trip event. Deviation severity is decided HERE, from the
 * corridor distance, not from whatever label the client sent.
 */
function addEvent(trip, body, rules) {
  if (TERMINAL_STATES.has(trip.status)) return { error: 'Trip is already closed.' };

  const at = new Date().toISOString();
  const coords = body.coords && Number.isFinite(body.coords.lat) && Number.isFinite(body.coords.lng)
    ? { lat: Number(body.coords.lat), lng: Number(body.coords.lng) }
    : null;

  const event = { at, type: String(body.type || 'note'), note: String(body.note || '').slice(0, 200) };
  if (coords) {
    event.coords = coords;
    const off = distanceFromCorridorKm(coords, trip.origin, trip.destination);
    event.offCorridorKm = Math.round(off * 1000) / 1000;
    event.severity = off > rules.deviationToleranceKm * 3 ? 'major'
                   : off > rules.deviationToleranceKm ? 'minor'
                   : 'on_route';
  }

  if (event.type === 'alert_sent') {
    event.notified = trip.emergencyContacts.map(c => c.name);
    if (!event.notified.length) return { error: 'No emergency contacts on this trip.' };
  }

  trip.events.push(event);
  return { trip, event };
}

function complete(trip) {
  if (TERMINAL_STATES.has(trip.status)) return { error: 'Trip is already closed.' };
  trip.status = 'completed';
  trip.completedAt = new Date().toISOString();
  trip.events.push({ at: trip.completedAt, type: 'completed', note: 'Trip ended; receipt issued' });
  trip.signature = signature(trip);
  return { trip };
}

function cancel(trip, reason) {
  if (TERMINAL_STATES.has(trip.status)) return { error: 'Trip is already closed.' };
  trip.status = 'cancelled';
  trip.completedAt = new Date().toISOString();
  trip.events.push({ at: trip.completedAt, type: 'cancelled', note: String(reason || 'Cancelled') });
  return { trip };
}

/** Public receipt view — no device ids, no contact phone numbers. */
function receiptView(trip) {
  return {
    id: trip.id,
    status: trip.status,
    signature: trip.signature || signature(trip),
    lockedAt: trip.lockedAt,
    completedAt: trip.completedAt,
    origin: trip.origin.name,
    destination: trip.destination.name,
    distanceKm: trip.destination.km,
    hireType: trip.hireType,
    passengers: trip.passengers,
    driver: trip.driver,
    fare: trip.fare,
    ordinance: trip.ordinance,
    route: trip.route || null,
    fareRule: trip.fareRule || null,
    safetyEvents: trip.events.filter(e =>
      ['deviation', 'safe_confirmed', 'alert_sent'].includes(e.type))
  };
}

module.exports = { createTrip, accept, start, addEvent, complete, cancel, receiptView, signature, verify, tripRecord };
