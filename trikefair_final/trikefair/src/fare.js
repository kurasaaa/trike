'use strict';
/* ============================================================================
   FARE ENGINE
   ----------------------------------------------------------------------------
   This is the ONLY place in the system where a fare is computed.

   Two rules make the whole project defensible:
     1. No client ever sends a peso amount. Clients send trip INPUTS
        (destination, passenger count, discount claims). The server returns
        the money. A tampered request cannot produce a tampered fare.
     2. The night rate comes from the SERVER clock, never from a toggle either
        the passenger or the driver can reach. A phone with a wrong clock
        cannot buy itself a daytime rate.

   Hire types:
     regular  — the shared queue ride. Every passenger pays a full fare, which
                is how tricycle ordinances actually work: a full sidecar earns
                the driver more than an empty one.
     special  — the passenger hires the whole unit. ONE vehicle fare, split
                among whoever rides.
   ========================================================================== */

/** Round a payable share to the smallest coin the fare step allows. */
function roundToStep(amount, step) {
  return Math.round(amount / step) * step;
}

/** Is the given moment inside the ordinance's night window? */
function isNight(date, rules) {
  if (rules.simulateNight) return true;          // demo override, Rules screen only
  const h = date.getHours();
  return h >= rules.nightStart || h < rules.nightEnd;
}

/**
 * Compute a fare.
 * @param {object} input  { distanceKm, passengers, discountedPax, discountType, hireType }
 * @param {object} rules  the loaded ordinance
 * @param {Date}   at     the moment of computation (server clock)
 */
function computeFare(input, rules, at = new Date()) {
  const distanceKm    = Number(input.distanceKm);
  const passengers    = clampInt(input.passengers, 1, 4);
  const discountType  = ['student', 'senior', 'pwd'].includes(input.discountType) ? input.discountType : 'none';
  const discountedPax = discountType === 'none' ? 0 : clampInt(input.discountedPax, 0, passengers);
  const hireType      = input.hireType === 'special' ? 'special' : 'regular';

  const special      = hireType === 'special';
  // Each hire type has its own base and per-km rate, exactly as an ordinance
  // states them — not one rate multiplied by a fudge factor.
  const base         = special ? rules.specialBaseFare  : rules.baseFare;
  const perKm        = special ? rules.specialPerKmRate : rules.perKmRate;

  const extraKm      = Math.max(0, distanceKm - rules.baseKm);
  const distanceFare = extraKm * perKm;
  const singleBase   = base + distanceFare;   // one passenger, or the whole unit

  const night        = isNight(at, rules);
  const nightApplies = night && rules.nightSurchargeEnabled;

  let grossPerPax, vehicleFare, nightSurcharge;
  if (special) {
    // ONE whole-unit fare, split by whoever rides.
    const nightAdd = nightApplies ? singleBase * rules.nightSurchargeRate : 0;
    nightSurcharge = nightAdd;
    vehicleFare    = singleBase + nightAdd;
    grossPerPax    = vehicleFare / passengers;
  } else {
    // EACH passenger pays a full fare.
    const nightEach = nightApplies ? singleBase * rules.nightSurchargeRate : 0;
    grossPerPax     = singleBase + nightEach;
    nightSurcharge  = nightEach * passengers;
    vehicleFare     = grossPerPax * passengers;
  }

  // Round every share, then make the total the exact sum of the rounded shares.
  // Without this the receipt total and the coins actually handed over disagree.
  const step         = rules.fareStep;
  const undiscounted = roundToStep(grossPerPax, step);
  const rate         = discountType === 'none' ? 0 : rules.discountRate;

  const paxBreakdown = [];
  let total = 0, discountTotal = 0;
  for (let i = 1; i <= passengers; i++) {
    const isDiscounted = i <= discountedPax;
    const amount = roundToStep(isDiscounted ? grossPerPax * (1 - rate) : grossPerPax, step);
    if (isDiscounted) discountTotal += undiscounted - amount;
    total += amount;
    paxBreakdown.push({ index: i, amount: round2(amount), discounted: isDiscounted });
  }

  return {
    // inputs, echoed back so the receipt is self-describing
    distanceKm, passengers, discountedPax, discountType, hireType,
    // components
    baseFare: base,
    baseKm: rules.baseKm,
    perKmRate: perKm,
    extraKm: round2(extraKm),
    distanceFare: round2(distanceFare),
    singleBase: round2(singleBase),
    isNight: night,
    nightApplies,
    nightSurchargeRate: rules.nightSurchargeRate,
    nightSurcharge: round2(nightSurcharge),
    subtotal: round2(vehicleFare),
    discountRate: rate,
    discountTotal: round2(discountTotal),
    fareStep: step,
    // results
    perPax: round2(undiscounted),
    paxBreakdown,
    total: round2(total),
    computedAt: at.toISOString()
  };
}

function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v));
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function round2(n) { return Math.round(n * 100) / 100; }

/** Straight-line distance in km. Used only for deviation checks. */
function haversineKm(a, b) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Perpendicular-ish distance from a point to the terminal→destination corridor.
 * Good enough for a fixed short route; a deployment would use the road geometry.
 */
function distanceFromCorridorKm(point, origin, destination) {
  const t = clamp01(projectionRatio(point, origin, destination));
  const nearest = {
    lat: origin.lat + (destination.lat - origin.lat) * t,
    lng: origin.lng + (destination.lng - origin.lng) * t
  };
  return haversineKm(point, nearest);
}
function projectionRatio(p, a, b) {
  const abx = b.lng - a.lng, aby = b.lat - a.lat;
  const apx = p.lng - a.lng, apy = p.lat - a.lat;
  const denom = abx * abx + aby * aby;
  return denom === 0 ? 0 : (apx * abx + apy * aby) / denom;
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

module.exports = { computeFare, isNight, roundToStep, haversineKm, distanceFromCorridorKm };
