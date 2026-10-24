/* ============================================================================
   ROUTE NETWORK — Guimaras expansion
   ----------------------------------------------------------------------------
   Municipalities → terminals → destinations, joined by a graph of road
   segments. This module:

     validate()      checks the data files and reports what is wrong
     findRoute()     shortest path on the stored graph (Dijkstra)
     resolveTrip()   terminal + destination → route + the fare rules to use

   It does NOT compute money. The distance it finds is handed to the existing
   fare engine (src/fare.js), which stays the only place a fare is computed:

       Route engine → distance → computeFare() → fare

   "Optimization" here means choosing the lowest-cost path through the route
   data we have. There is no live traffic data, and nothing here claims there is.

   Runs unchanged in Node (server.js), in the Android build's embedded runtime,
   and in the browser (window.TrikeNetwork) for offline route previews.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrikeNetwork = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RATE_KEYS = ['baseFare', 'baseKm', 'perKmRate', 'specialBaseFare', 'specialPerKmRate',
                     'fareStep', 'discountRate', 'nightSurchargeRate'];

  const round2 = n => Math.round(n * 100) / 100;
  const isCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  /* ------------------------------------------------------------ validation */
  /**
   * Check the network data. Errors mean a record is unusable and is left out;
   * warnings are things a person should look at but that do not break routing.
   * Returns the cleaned network plus the report — the app keeps working on
   * whatever is valid instead of failing outright.
   */
  function validate(net, rules) {
    const errors = [], warnings = [];
    const err = (msg) => errors.push(msg), warn = (msg) => warnings.push(msg);

    const list = (x) => Array.isArray(x) ? x : [];
    const municipalities = list(net.municipalities);
    const terminals = list(net.terminals);
    const destinations = list(net.destinations);
    const nodes = list(net.nodes);
    const edges = list(net.edges);
    const fareRules = list(net.fareRules);

    function dupes(items, label) {
      const seen = new Set(), bad = new Set();
      for (const it of items) {
        if (!it || !it.id) { err(`${label}: a record has no id`); continue; }
        if (seen.has(it.id)) { err(`${label}: duplicate id "${it.id}"`); bad.add(it.id); }
        seen.add(it.id);
      }
      return bad;
    }
    const badMuni = dupes(municipalities, 'Municipality');
    const badNode = dupes(nodes, 'Route node');
    const badEdge = dupes(edges, 'Route segment');
    const badTerm = dupes(terminals, 'Terminal');
    const badDest = dupes(destinations, 'Destination');
    const badRule = dupes(fareRules, 'Fare rule');

    const muniIds = new Set(municipalities.filter(m => m && m.id && !badMuni.has(m.id)).map(m => m.id));

    // nodes
    const goodNodes = nodes.filter(n => {
      if (!n || !n.id || badNode.has(n.id)) return false;
      if (!muniIds.has(n.municipality)) { err(`Route node "${n.id}": unknown municipality "${n.municipality}"`); return false; }
      if (!isCoord(n.lat, n.lng)) { err(`Route node "${n.id}": invalid coordinates`); return false; }
      return true;
    });
    const nodeIds = new Set(goodNodes.map(n => n.id));

    // edges
    const pairSeen = new Set();
    const goodEdges = edges.filter(e => {
      if (!e || !e.id || badEdge.has(e.id)) return false;
      if (!nodeIds.has(e.from)) { err(`Route segment "${e.id}": "from" points to a missing node "${e.from}"`); return false; }
      if (!nodeIds.has(e.to))   { err(`Route segment "${e.id}": "to" points to a missing node "${e.to}"`); return false; }
      if (e.from === e.to)      { err(`Route segment "${e.id}": starts and ends at the same node`); return false; }
      if (!Number.isFinite(e.distance_km) || e.distance_km <= 0) { err(`Route segment "${e.id}": distance must be a positive number`); return false; }
      if (e.estimated_minutes != null && (!Number.isFinite(e.estimated_minutes) || e.estimated_minutes < 0)) {
        err(`Route segment "${e.id}": estimated_minutes must be zero or more`); return false;
      }
      const key = e.bidirectional === false ? `${e.from}>${e.to}` : [e.from, e.to].sort().join('<>');
      if (pairSeen.has(key)) { err(`Route segment "${e.id}": duplicates another segment between the same two places`); return false; }
      pairSeen.add(key);
      return true;
    });

    // fare rules
    const goodRules = fareRules.filter(r => {
      if (!r || !r.id || badRule.has(r.id)) return false;
      if (r.source === 'rules.json') return true;
      const rates = r.rates || {};
      const missing = RATE_KEYS.filter(k => !Number.isFinite(rates[k]) || rates[k] < 0);
      if (missing.length) { err(`Fare rule "${r.id}": missing or invalid ${missing.join(', ')}`); return false; }
      return true;
    });
    const ruleIds = new Set(goodRules.map(r => r.id));

    // destinations
    const goodDests = destinations.filter(d => {
      if (!d || !d.id || badDest.has(d.id)) return false;
      if (!muniIds.has(d.municipality)) { err(`Destination "${d.id}": unknown municipality "${d.municipality}"`); return false; }
      if (d.nodeId == null) { warn(`Destination "${d.name}": coordinates required — no route can be computed yet`); return true; }
      if (!nodeIds.has(d.nodeId)) { err(`Destination "${d.id}": points to a missing route node "${d.nodeId}"`); return false; }
      return true;
    });
    const destIds = new Set(goodDests.map(d => d.id));

    // terminals
    const goodTerms = terminals.filter(t => {
      if (!t || !t.id || badTerm.has(t.id)) return false;
      if (!muniIds.has(t.municipality)) { err(`Terminal "${t.id}": unknown municipality "${t.municipality}"`); return false; }
      if (!nodeIds.has(t.nodeId)) { err(`Terminal "${t.id}": points to a missing route node "${t.nodeId}"`); return false; }
      if (!ruleIds.has(t.fareRuleId)) { err(`Terminal "${t.id}": missing fare rule "${t.fareRuleId}"`); return false; }
      if (t.latitude != null && !isCoord(t.latitude, t.longitude)) { err(`Terminal "${t.id}": invalid coordinates`); return false; }
      if (t.latitude == null) warn(`Terminal "${t.name}": coordinates required — routed from its municipal center`);
      const missing = list(t.destinationIds).filter(id => !destIds.has(id));
      if (missing.length) warn(`Terminal "${t.name}": unknown destination id(s) ${missing.join(', ')} ignored`);
      return true;
    });

    // The original Buenavista data lives in rules.json too. If someone edits one
    // copy and not the other, say so rather than let the fares silently diverge.
    if (rules && Array.isArray(rules.destinations)) {
      const termId = net.defaultTerminalId;
      const term = goodTerms.find(t => t.id === termId);
      for (const d of rules.destinations) {
        const edge = term && goodEdges.find(e =>
          (e.from === term.nodeId && e.to === d.id) || (e.to === term.nodeId && e.from === d.id && e.bidirectional !== false));
        const node = goodNodes.find(n => n.id === d.id);
        if (!edge) warn(`rules.json destination "${d.name}" has no direct segment from the default terminal in routes.json`);
        else if (edge.distance_km !== d.km) err(`Distance mismatch for "${d.name}": rules.json says ${d.km} km, routes.json says ${edge.distance_km} km`);
        if (node && (node.lat !== d.lat || node.lng !== d.lng)) warn(`Coordinates for "${d.name}" differ between rules.json and routes.json`);
      }
    }

    if (!goodTerms.some(t => t.id === net.defaultTerminalId)) {
      err(`Default terminal "${net.defaultTerminalId}" is missing or invalid`);
    }

    return {
      network: { ...net, municipalities: municipalities.filter(m => muniIds.has(m.id)),
        nodes: goodNodes, edges: goodEdges, fareRules: goodRules, destinations: goodDests, terminals: goodTerms },
      report: { ok: errors.length === 0, errors, warnings }
    };
  }

  /* ---------------------------------------------------------------- lookup */
  const byId = (items, id) => (items || []).find(x => x.id === id) || null;
  const municipalityName = (net, id) => (byId(net.municipalities, id) || { name: id }).name;

  function terminalsFor(net, municipalityId) {
    return net.terminals.filter(t => t.municipality === municipalityId);
  }
  function destinationsFor(net, terminalId) {
    const t = byId(net.terminals, terminalId);
    if (!t) return [];
    return (t.destinationIds || []).map(id => byId(net.destinations, id)).filter(Boolean);
  }

  /** Availability after admin overrides, e.g. { e_jordan_nv: { available: false } }. */
  function edgeAvailable(edge, overrides) {
    const o = overrides && overrides[edge.id];
    if (o && typeof o.available === 'boolean') return o.available;
    return edge.available !== false;
  }

  /* --------------------------------------------------------- route engine */
  /**
   * Dijkstra over the stored graph.
   * Cost per segment = distance × distanceWeight + minutes × timeWeight,
   * with the weights read from routes.json settings.
   */
  function findRoute(net, fromNodeId, toNodeId, opts = {}) {
    const mode = opts.mode || 'tricycle';
    const overrides = opts.overrides || {};
    const settings = net.settings || {};
    const w = settings.costWeights || { distance: 1, time: 0 };
    const wd = Number.isFinite(w.distance) ? w.distance : 1;
    const wt = Number.isFinite(w.time) ? w.time : 0;

    if (!byId(net.nodes, fromNodeId)) return { found: false, reason: 'The origin is not on the route network.' };
    if (!byId(net.nodes, toNodeId))   return { found: false, reason: 'The destination is not on the route network.' };
    if (fromNodeId === toNodeId)      return { found: false, reason: 'The destination is the same place as the origin.' };

    // adjacency list of usable segments
    const adj = new Map();
    const link = (a, b, e) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push({ to: b, edge: e }); };
    for (const e of net.edges) {
      if (!edgeAvailable(e, overrides)) continue;
      if (Array.isArray(e.transport_modes) && !e.transport_modes.includes(mode)) continue;
      link(e.from, e.to, e);
      if (e.bidirectional !== false) link(e.to, e.from, e);
    }

    const cost = new Map([[fromNodeId, 0]]);
    const prev = new Map();
    const done = new Set();
    // Small graphs: a linear scan for the cheapest open node is plenty.
    while (true) {
      let cur = null, best = Infinity;
      for (const [id, c] of cost) if (!done.has(id) && c < best) { best = c; cur = id; }
      if (cur === null || cur === toNodeId) break;
      done.add(cur);
      for (const { to, edge } of adj.get(cur) || []) {
        if (done.has(to)) continue;
        const step = edge.distance_km * wd + (edge.estimated_minutes || 0) * wt;
        const next = best + step;
        if (next < (cost.has(to) ? cost.get(to) : Infinity)) { cost.set(to, next); prev.set(to, { from: cur, edge }); }
      }
    }
    if (!cost.has(toNodeId)) {
      return { found: false, reason: 'There is currently no configured route between this terminal and destination.' };
    }

    const nodeIds = [toNodeId], segs = [];
    for (let at = toNodeId; prev.has(at); at = prev.get(at).from) {
      segs.unshift(prev.get(at).edge);
      nodeIds.unshift(prev.get(at).from);
    }
    const nodes = nodeIds.map(id => byId(net.nodes, id));
    const distanceKm = round2(segs.reduce((s, e) => s + e.distance_km, 0));
    const estimatedMinutes = Math.round(segs.reduce((s, e) => s + (e.estimated_minutes || 0), 0));

    // municipality transitions along the way, consecutive repeats collapsed
    const municipalities = [];
    for (const n of nodes) if (municipalities[municipalities.length - 1] !== n.municipality) municipalities.push(n.municipality);

    const statuses = new Set(segs.map(e => e.dataStatus || 'demo'));
    return {
      found: true,
      nodeIds,
      steps: nodes.map(n => ({ id: n.id, name: n.name, type: n.type, municipality: n.municipality,
                               municipalityName: municipalityName(net, n.municipality), lat: n.lat, lng: n.lng })),
      segments: segs.map(e => ({ id: e.id, from: e.from, to: e.to, distanceKm: e.distance_km,
                                 estimatedMinutes: e.estimated_minutes || 0, routeType: e.route_type, dataStatus: e.dataStatus })),
      distanceKm,
      estimatedMinutes,
      cost: round2(cost.get(toNodeId)),
      municipalities,
      municipalityNames: municipalities.map(id => municipalityName(net, id)),
      crossesMunicipalities: municipalities.length > 1,
      dataStatus: statuses.size === 1 ? [...statuses][0] : 'mixed',
      transportMode: mode
    };
  }

  /* ------------------------------------------------------------ fare rules */
  /**
   * The rules object to hand to computeFare() for a terminal. The original
   * Buenavista set IS rules.json, untouched. A demo set overrides only the
   * rates; the night window and the Rules-screen toggles stay global.
   */
  function fareRulesFor(rules, net, terminal) {
    const set = byId(net.fareRules, terminal.fareRuleId);
    if (!set) return null;
    if (set.source === 'rules.json') return rules;
    const rates = {};
    for (const k of RATE_KEYS) rates[k] = set.rates[k];
    return { ...rules, ...rates };
  }
  function fareRuleInfo(rules, net, terminal) {
    const set = byId(net.fareRules, terminal.fareRuleId) || {};
    const fromRulesJson = set.source === 'rules.json';
    return {
      id: set.id, label: set.label, status: set.status, statusNote: set.statusNote,
      isDemo: !fromRulesJson,
      lgu: fromRulesJson ? rules.lgu : `${municipalityName(net, terminal.municipality)}, Guimaras`,
      ordinance: fromRulesJson ? rules.ordinance : set.ordinance
    };
  }

  /* ---------------------------------------------------------- trip resolve */
  /**
   * Terminal + destination → everything a quote or a trip needs.
   * Returns { error, noRoute? } when the request cannot be served.
   */
  function resolveTrip(rules, net, input, overrides) {
    const terminalId = input.terminalId || net.defaultTerminalId;
    const terminal = byId(net.terminals, terminalId);
    if (!terminal) return { error: 'Unknown terminal.' };
    const destination = byId(net.destinations, input.destinationId);
    if (!destination) return { error: 'Unknown destination.' };
    if (!(terminal.destinationIds || []).includes(destination.id)) {
      return { error: 'This terminal does not serve that destination.' };
    }
    if (destination.nodeId == null) {
      return { error: 'NO ROUTE AVAILABLE', noRoute: true,
               reason: 'Coordinates required: this destination has no verified location, so no route can be configured yet.' };
    }
    const route = findRoute(net, terminal.nodeId, destination.nodeId, { mode: terminal.type || 'tricycle', overrides });
    if (!route.found) return { error: 'NO ROUTE AVAILABLE', noRoute: true, reason: route.reason };

    const fareRules = fareRulesFor(rules, net, terminal);
    if (!fareRules) return { error: 'Missing fare rule for this terminal.' };
    const node = byId(net.nodes, terminal.nodeId);
    const destNode = byId(net.nodes, destination.nodeId);
    return {
      terminal: {
        id: terminal.id, name: terminal.name, municipality: terminal.municipality,
        municipalityName: municipalityName(net, terminal.municipality),
        dataStatus: terminal.dataStatus,
        coordinatesVerified: terminal.latitude != null,
        lat: node.lat, lng: node.lng
      },
      destination: {
        id: destination.id, name: destination.name, municipality: destination.municipality,
        municipalityName: municipalityName(net, destination.municipality),
        lat: destNode.lat, lng: destNode.lng
      },
      route,
      fareRules,
      fareRule: fareRuleInfo(rules, net, terminal)
    };
  }

  /* --------------------------------------------------------- demo vehicles */
  /**
   * Position of a DEMO vehicle at time `now`: it shuttles back and forth along
   * its path. Purely simulated — straight lines between stored points.
   */
  function simulateDemoVehicle(vehicle, net, now) {
    const pts = (vehicle.path || []).map(id => byId(net.nodes, id)).filter(Boolean);
    if (pts.length < 2) return null;
    const period = (vehicle.periodSeconds || 300) * 1000;
    const phase = (now % period) / period;               // 0..1
    const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;   // there and back
    const legs = pts.length - 1;
    const pos = t * legs, i = Math.min(legs - 1, Math.floor(pos)), f = pos - i;
    const a = pts[i], b = pts[i + 1];
    return {
      vehicleId: vehicle.vehicleId,
      municipality: vehicle.municipality,
      terminalId: vehicle.terminalId,
      latitude: a.lat + (b.lat - a.lat) * f,
      longitude: a.lng + (b.lng - a.lng) * f,
      status: phase < 0.5 ? 'outbound' : 'returning',
      demo: true
    };
  }

  /** Validate a reported device position. */
  function cleanPosition(body) {
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!isCoord(lat, lng)) return null;
    const acc = Number(body.accuracy);
    return { lat, lng, accuracy: Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null };
  }

  return {
    validate, findRoute, resolveTrip, fareRulesFor, fareRuleInfo,
    terminalsFor, destinationsFor, edgeAvailable, simulateDemoVehicle, cleanPosition,
    municipalityName, RATE_KEYS
  };
});
