/* ============================================================================
   PANAW — passenger app
   Explore places, plan a terminal trip with its fare, call the nearest trike
   to where you are, and list your own place with photos.

   Data comes from /api/network, /api/rules and /api/places (the Node server,
   or the embedded server inside the APK). Fares are computed here with the
   same src/fare.js the server uses; routes with the same src/network.js.
   The last data received is kept so the fare check still opens offline.
   ========================================================================== */
'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = n => '₱' + Number(n).toFixed(2);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
};
const N = window.TrikeNetwork, F = window.TrikeFare;

/* line icons, drawn with the text colour */
const ICON = {
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  ticket: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M9.5 12h5M9.5 16h5"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.5a3 3 0 0 1 0 5.5M18 14c2 .7 3 2.8 3 6"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });

let NET, RULES;
let PLACES = [], CATS = [];
const byId = (arr, id) => arr.find(x => x.id === id);
const muniName = id => (byId(NET.municipalities, id) || { name: id }).name;
const shortDest = name => String(name).replace(/ \(.*\)$/, '');

/* categories for the original Buenavista places; OpenStreetMap places carry their own */
const CATEGORY = { d5: 'Nature', d7: 'Heritage', d4: 'Ports', d6: 'Barangays', d1: 'Schools', d8: 'Schools', d2: 'Essentials', d3: 'Essentials' };
const TOURIST_FIRST = ['dest_guisi_lighthouse', 'd5', 'd7', 'dest_raymen_beach', 'dest_trappist_abbey', 'dest_san_lorenzo_wind_farm', 'dest_balaan_bukid', 'dest_tatlong_pulo'];
const catOf = d => d.category || CATEGORY[d.id] || (d.dataStatus === 'reference' || d.id === 'dest_buenavista_poblacion' ? 'Towns' : 'Other');

/* where each record comes from, said plainly */
const STATUS = {
  existing: ['existing', 'Project data'], osm: ['info', 'OpenStreetMap'], reference: ['info', 'PhilAtlas'],
  demo: ['demo', 'DEMO'], todo: ['todo', 'Coordinates required'], mixed: ['info', 'Mixed sources']
};
const tag = st => { const [c, t] = STATUS[st] || STATUS.demo; return `<span class="data-tag ${c}">${t}</span>`; };
const segLabel = st => st === 'existing' ? 'project matrix' : st === 'osm' ? 'OSM road distance' : 'DEMO';

/* vehicle modes: van and motorcycle are proposals with no route or fare data */
let MODES = [];

const S = {
  who: store.get('panaw_who', null),
  muni: 'buenavista', terminalId: null, stops: [''], mode: 'tricycle',
  hire: 'regular', pax: 1, disc: 'none', dpax: 0, bestOrder: false, routeIx: 0,
  exploreCat: 'All', exploreMuni: 'all', exploreView: 'list', assocMuni: 'buenavista', photoIx: 0,
  history: store.get('panaw_history', []), stack: [], gpsFor: null
};

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); }

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

/* ---------- navigation ---------- */
const TABS = ['screen-explore', 'screen-trip', 'screen-pickup', 'screen-history', 'screen-more'];
const RENDER = {};
function show(id, push = true) {
  const cur = document.querySelector('.screen.active');
  if (push && cur && cur.id !== id) S.stack.push(cur.id);
  if (TABS.includes(id)) S.stack = [];
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.target === id));
  $('#nav').classList.toggle('hidden', id === 'screen-welcome' || id === 'screen-loading');
  if (RENDER[id]) RENDER[id]();
  const sc = document.querySelector('#' + id + ' .screen-scroll'); if (sc) sc.scrollTop = 0;
  Object.values(MAPS).forEach(m => m.el.isConnected && m.map.invalidateSize());
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-target],[data-go],[data-back],[data-close]');
  if (!t) return;
  if (t.dataset.target) show(t.dataset.target);
  else if (t.dataset.go) show(t.dataset.go);
  else if (t.hasAttribute('data-back')) show(S.stack.pop() || 'screen-explore', false);
  else if (t.hasAttribute('data-close')) t.closest('.modal-overlay').classList.remove('show');
});

/* ============================================================== MAPS
   Online: a Leaflet map with OpenStreetMap tiles (needs internet).
   Offline: the stored-network schematic from netmap.js, which needs none.
   Either way the lines join stored points; they are not road geometry. */
const MAPS = {};
const mapsOnline = () => typeof L !== 'undefined' && navigator.onLine;
const COLOR = { navy: '#0A3543', teal: '#0E7C86', red: '#E5484D', amber: '#C98512', blue: '#2F80ED', grey: '#7C9196' };

/* tap → lat/lng on the schematic: it is a linear projection, so recover it from the drawn places farthest apart */
function schematicLatLng(svg, e) {
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const pts = [...svg.querySelectorAll('.nm-node')].map((el, i) => ({ n: NET.nodes[i],   // drawn in NET.nodes order
    x: el.tagName === 'rect' ? +el.getAttribute('x') + +el.getAttribute('width') / 2 : +el.getAttribute('cx'),
    y: el.tagName === 'rect' ? +el.getAttribute('y') + +el.getAttribute('height') / 2 : +el.getAttribute('cy') }));
  if (!pts.length) return null;
  const ext = k => pts.reduce(([lo, hi], q) => [q[k] < lo[k] ? q : lo, q[k] > hi[k] ? q : hi], [pts[0], pts[0]]);
  const [xl, xh] = ext('x'), [yl, yh] = ext('y');
  if (xh.x === xl.x || yh.y === yl.y) return null;
  return { lng: xl.n.lng + (p.x - xl.x) * (xh.n.lng - xl.n.lng) / (xh.x - xl.x),
           lat: yl.n.lat + (p.y - yl.y) * (yh.n.lat - yl.n.lat) / (yh.y - yl.y) };
}

/**
 * Draw a map into the element with this id.
 * o: { route, originNodeId, destNodeId, pin:{lat,lng}, places:[{lat,lng,name,id,kind}], vehicles:[{latitude,longitude,label,demo}],
 *      onTap(latlng), onPlace(id,kind), refit, note }
 */
function drawMap(id, o = {}) {
  const el = document.getElementById(id); if (!el) return;
  const noteEl = document.getElementById(id + '-note');
  const routeNote = 'Lines join stored points; they are not the exact shape of the road.';
  if (!mapsOnline()) {
    if (MAPS[id]) { MAPS[id].map.remove(); delete MAPS[id]; }
    el.classList.remove('lmap'); el.classList.add('netmap');
    el.innerHTML = TrikeMap.render(NET, { route: o.route, originNodeId: o.originNodeId, destNodeId: o.destNodeId,
      gps: o.pin, vehicles: o.vehicles, labels: 'terminals' }) + TrikeMap.LEGEND;
    const svg = el.querySelector('svg');
    if (svg && o.onTap) svg.onclick = e => { const p = schematicLatLng(svg, e); if (p) o.onTap(p); };
    if (noteEl) noteEl.textContent = (o.note ? o.note + ' ' : '') + 'Offline: showing the stored network instead of the street map.';
    return;
  }
  let m = MAPS[id];
  if (!m || m.el !== el) {
    if (m) m.map.remove();
    el.classList.remove('netmap'); el.classList.add('lmap'); el.innerHTML = '';
    const map = L.map(el, { scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([10.6, 122.62], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    m = MAPS[id] = { el, map, layer: L.layerGroup().addTo(map), fitted: false };
    map.on('click', e => m.onTap && m.onTap({ lat: e.latlng.lat, lng: e.latlng.lng }));
  }
  m.onTap = o.onTap;
  m.layer.clearLayers();
  const at = nid => byId(NET.nodes, nid);
  const bounds = [];
  // the stored network, faint, for context
  for (const e of NET.edges) {
    const a = at(e.from), b = at(e.to); if (!a || !b) continue;
    L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: e.available === false ? COLOR.red : COLOR.grey, weight: 2, opacity: .45,
      dashArray: e.available === false ? '3 5' : e.dataStatus === 'demo' ? '6 5' : null, interactive: false }).addTo(m.layer);
  }
  if (o.route && o.route.steps && o.route.steps.length > 1) {
    const line = o.route.steps.map(s => [s.lat, s.lng]);
    L.polyline(line, { color: COLOR.teal, weight: 5, opacity: .9 }).addTo(m.layer);
    bounds.push(...line);
  }
  const termNodes = new Set(NET.terminals.map(t => t.nodeId));
  for (const n of NET.nodes) {
    const isO = n.id === o.originNodeId, isD = n.id === o.destNodeId;
    const color = isO ? COLOR.teal : isD ? COLOR.red : COLOR.navy;
    const big = isO || isD || termNodes.has(n.id);
    L.circleMarker([n.lat, n.lng], { radius: big ? 6 : 4, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1 })
      .bindTooltip(esc(n.name)).addTo(m.layer);
    if (isO || isD) bounds.push([n.lat, n.lng]);
  }
  for (const p of o.places || []) {
    const mk = L.circleMarker([p.lat, p.lng], { radius: 6, color: '#fff', weight: 1.5, fillColor: p.kind === 'listing' ? COLOR.amber : COLOR.navy, fillOpacity: 1 })
      .bindTooltip(esc(p.name)).addTo(m.layer);
    if (o.onPlace) mk.on('click', ev => { L.DomEvent.stopPropagation(ev); o.onPlace(p.id, p.kind); });
    bounds.push([p.lat, p.lng]);
  }
  for (const v of o.vehicles || []) {
    L.circleMarker([v.latitude, v.longitude], { radius: 6, color: COLOR.amber, weight: 2, dashArray: v.demo ? '2 2' : null,
      fillColor: '#fff', fillOpacity: 1 }).bindTooltip(esc(v.label) + (v.demo ? ' (DEMO VEHICLE)' : '')).addTo(m.layer);
  }
  if (o.pin) {
    L.circleMarker([o.pin.lat, o.pin.lng], { radius: 8, color: '#fff', weight: 2, fillColor: COLOR.blue, fillOpacity: 1 }).bindTooltip('Pin').addTo(m.layer);
    bounds.push([o.pin.lat, o.pin.lng]);
  }
  if (o.refit || !m.fitted) {
    if (bounds.length > 1) m.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
    else if (bounds.length === 1) m.map.setView(bounds[0], 14);
    else m.map.setView([10.6, 122.62], 11);
    m.fitted = true;
  }
  setTimeout(() => m.map.invalidateSize(), 0);
  if (noteEl) noteEl.textContent = (o.note ? o.note + ' ' : '') + routeNote;
}

/* ============================================================== GPS
   Asked only when the user presses a location button. */
const GPS_WHY = {
  near: 'PANAW uses your location once to find the closest terminal. Nothing is uploaded.',
  pickup: 'PANAW uses your location once to set your pick-up point. It is not uploaded in this prototype.',
  listing: 'PANAW uses your location once to pin your place. It is sent only when you publish the listing.'
};
function askGps(purpose) {
  S.gpsFor = purpose;
  $('#gps-why').textContent = GPS_WHY[purpose];
  $('#gps-sim').style.display = purpose === 'listing' ? 'none' : '';
  $('#gps-modal').classList.add('show');
}
function gpsDone(pos, label) {
  $('#gps-modal').classList.remove('show');
  if (S.gpsFor === 'near') showNearest(pos, label);
  else if (S.gpsFor === 'pickup') setPickup(pos, label);
  else if (S.gpsFor === 'listing') setListingPin(pos, 'gps');
}
function gpsFail() {
  $('#gps-modal').classList.remove('show');
  const msg = 'GPS UNAVAILABLE. Your location could not be obtained. Fare calculation and route selection remain available.';
  if (S.gpsFor === 'near') $('#near-out').innerHTML = `<div class="route-card none"><div class="route-head"><span class="t">GPS UNAVAILABLE</span></div>
    <div class="why">Your location could not be obtained. Fare calculation and route selection remain available.</div></div>`;
  else toast(msg);
}
$('#gps-sim').onclick = () => { const n = byId(NET.nodes, 'd5'); gpsDone({ lat: n.lat + 0.004, lng: n.lng - 0.003 }, 'Sample location near Daliran Cave'); };
$('#gps-real').onclick = () => {
  if (!navigator.geolocation) return gpsFail();
  navigator.geolocation.getCurrentPosition(p => gpsDone({ lat: p.coords.latitude, lng: p.coords.longitude }, 'Your device location'),
    gpsFail, { timeout: 15000, enableHighAccuracy: true });
};

/* ============================================================== WELCOME */
document.querySelectorAll('[data-who]').forEach(b => b.onclick = () => {
  S.who = b.dataset.who; store.set('panaw_who', S.who);
  show(S.who === 'tourist' ? 'screen-explore' : 'screen-trip');
});
$('#switch-who').onclick = () => show('screen-welcome');
RENDER['screen-more'] = () => {
  $('#who-now').textContent = 'Current: ' + (S.who === 'local' ? 'Local' : 'Visitor');
  $('#backend-line').textContent = `${NET.backend ? NET.backend.label : ''}${S.dataFrom !== 'live' ? ' · stored data from ' + new Date(S.dataFrom).toLocaleString() : ''}`;
};

/* ============================================================== EXPLORE */
const servingTerminals = d => NET.terminals.filter(t => (t.destinationIds || []).includes(d.id));
const nodeOfDest = d => d.nodeId && byId(NET.nodes, d.nodeId);
function exploreItems() {
  const dests = NET.destinations.map(d => ({ kind: 'dest', id: d.id, name: shortDest(d.name), municipality: d.municipality,
    category: catOf(d), node: nodeOfDest(d), status: d.dataStatus, rank: TOURIST_FIRST.indexOf(d.id) }));
  const listings = PLACES.map(p => ({ kind: 'listing', id: p.id, name: p.name, municipality: p.municipality, category: p.category,
    node: { lat: p.lat, lng: p.lng }, photo: (p.photos || [])[0], rank: -1 }));
  return [...dests, ...listings];
}
function photoBox(src, muni, tall, extra = '') {
  return `<div class="photo ${tall ? 'tall' : ''}">${muni ? `<span class="muni">${esc(muni)}</span>` : ''}
    ${src ? `<img src="${esc(src)}" alt="">` : 'No photo yet'}${extra}</div>`;
}
RENDER['screen-explore'] = () => {
  const items = exploreItems();
  const cats = ['All', ...new Set(items.map(i => i.category))];
  $('#explore-cats').innerHTML = cats.map(c => `<button class="chip ${c === S.exploreCat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  $('#explore-munis').innerHTML = [{ id: 'all', name: 'All Guimaras' }, ...NET.municipalities]
    .map(m => `<button class="chip ${m.id === S.exploreMuni ? 'on' : ''}" data-em="${m.id}">${esc(m.name)}</button>`).join('');
  document.querySelectorAll('#explore-view button').forEach(b => b.classList.toggle('on', b.dataset.view === S.exploreView));
  const q = $('#explore-search').value.trim().toLowerCase();
  const list = items
    .filter(i => S.exploreCat === 'All' || i.category === S.exploreCat)
    .filter(i => S.exploreMuni === 'all' || i.municipality === S.exploreMuni)
    .filter(i => !q || i.name.toLowerCase().includes(q))
    .sort((a, b) => (b.kind === 'listing') - (a.kind === 'listing') || (b.rank + 1 || -99) - (a.rank + 1 || -99));
  const cta = `<div class="card"><div class="card-title">Own a place in Guimaras?</div>
    <div class="stepper-hint" style="margin:0 0 10px">Resorts, eateries, pasalubong shops and viewpoints can list themselves with photos and a map pin.</div>
    <button class="btn btn-secondary btn-sm" data-go="screen-list">List your place</button></div>`;
  if (S.exploreView === 'map') {
    $('#explore-list').innerHTML = `<div id="explore-map" class="lmap" style="height:420px"></div><div class="map-note" id="explore-map-note"></div>${cta}`;
    drawMap('explore-map', { places: list.filter(i => i.node).map(i => ({ lat: i.node.lat, lng: i.node.lng, name: i.name, id: i.id, kind: i.kind })),
      onPlace: (id, kind) => { S.place = { kind, id }; S.photoIx = 0; show('screen-place'); }, refit: true,
      note: 'Navy: places on the route network. Amber: listed by owners.' });
    return;
  }
  $('#explore-list').innerHTML = (list.length ? list.map(i => {
    let how;
    if (i.kind === 'listing') how = '<span class="data-tag demo">Listed by owner · not verified</span>';
    else if (!i.node) how = '<span class="data-tag todo">Coordinates required</span>';
    else { const terms = servingTerminals(byId(NET.destinations, i.id)); how = terms.length ? `From ${esc(terms[0].name)}${terms.length > 1 ? ` +${terms.length - 1}` : ''}` : 'No terminal serves this yet'; }
    return `<div class="card place-card" data-place="${esc(i.id)}" data-kind="${i.kind}">${i.photo ? photoBox(i.photo, muniName(i.municipality)) : ''}
      <h4 style="${i.photo ? '' : 'margin-top:0'}">${esc(i.name)}</h4><div class="meta"><span>${esc(i.category)} · ${esc(muniName(i.municipality))}</span><span>${how}</span></div></div>`;
  }).join('') : '<div class="empty-state"><div class="t">No places found</div><div class="s">Try another filter.</div></div>') + cta;
};
$('#explore-search').oninput = () => RENDER['screen-explore']();
$('#explore-cats').onclick = e => { const c = e.target.closest('[data-cat]'); if (c) { S.exploreCat = c.dataset.cat; RENDER['screen-explore'](); } };
$('#explore-munis').onclick = e => { const c = e.target.closest('[data-em]'); if (c) { S.exploreMuni = c.dataset.em; RENDER['screen-explore'](); } };
$('#explore-view').onclick = e => { const b = e.target.closest('[data-view]'); if (b) { S.exploreView = b.dataset.view; RENDER['screen-explore'](); } };
$('#explore-list').onclick = e => {
  const c = e.target.closest('[data-place]');
  if (c) { S.place = { kind: c.dataset.kind, id: c.dataset.place }; S.photoIx = 0; show('screen-place'); }
};

/* ============================================================== PLACE DETAIL */
function nearestNode(pos) {
  return NET.nodes.reduce((b, n) => { const km = F.haversineKm(pos, n); return km < b.km ? { n, km } : b; }, { n: null, km: Infinity });
}
/* route + fare from the first terminal that serves a destination */
function gettingThere(d) {
  const terms = servingTerminals(d);
  if (d.nodeId == null) return { html: `<div class="route-card none"><div class="route-head"><span class="t">Coordinates required</span></div>
      <div class="why">This place has no verified location yet, so no route or fare can be shown.</div></div>`, terms };
  if (!terms.length) return { html: '<div class="stepper-hint">No terminal is configured to serve this place yet.</div>', terms };
  const r = N.resolveTrip(RULES, NET, { terminalId: terms[0].id, destinationId: d.id });
  if (!r.route) return { html: `<div class="route-card none"><div class="why">${esc(r.reason || r.error)}</div></div>`, terms };
  const f = F.computeFare({ distanceKm: r.route.distanceKm, passengers: 1, hireType: 'regular' }, r.fareRules);
  return { terms, html: `<div class="bd-row"><span class="k">From</span><span class="v plain">${esc(terms[0].name)}</span></div>
      <div class="bd-row"><span class="k">Distance</span><span class="v">${r.route.distanceKm} km</span></div>
      <div class="bd-row"><span class="k">Est. time</span><span class="v">${r.route.estimatedMinutes} min</span></div>
      <div class="bd-row"><span class="k">Fare, 1 passenger</span><span class="v">${peso(f.total)}</span></div>
      <div class="terminal-meta"><span class="data-tag ${r.fareRule.isDemo ? 'demo' : 'existing'}">${esc(r.fareRule.status)}</span>${tag(r.route.dataStatus)}</div>` };
}
RENDER['screen-place'] = () => {
  if (S.place.kind === 'listing') return renderListing();
  const d = byId(NET.destinations, S.place.id); if (!d) return;
  const node = nodeOfDest(d);
  $('#place-title').textContent = shortDest(d.name);
  $('#place-sub').textContent = muniName(d.municipality) + ', Guimaras';
  const g = gettingThere(d);
  $('#place-body').innerHTML = `<div class="card" style="padding:10px">${photoBox(null, muniName(d.municipality), true)}
      <div class="stepper-hint">Photos: ${esc(muniName(d.municipality))} Tourism Office (pending partnership).</div></div>
    <div class="card"><div class="card-title">Visitor information</div>
      <div class="bd-row"><span class="k">Category</span><span class="v plain">${esc(catOf(d))}</span></div>
      <div class="bd-row"><span class="k">Open hours</span><span class="v plain"><span class="data-tag todo">To verify</span></span></div>
      <div class="bd-row"><span class="k">Entrance fee</span><span class="v plain"><span class="data-tag todo">To verify</span></span></div>
      <div class="bd-row"><span class="k">Location source</span><span class="v plain">${tag(d.dataStatus)}</span></div>
      ${node ? `<div id="place-map" class="lmap short"></div><div class="map-note" id="place-map-note"></div>` : ''}
      <div class="stepper-hint">The tourism office fills hours and fees. Until then they say "to verify" instead of guessing.</div></div>
    <div class="card"><div class="card-title">Getting there</div>${g.html}
      ${g.terms.length && d.nodeId != null ? `<button class="btn btn-primary" style="margin-top:12px" id="plan-here">Plan trip to here</button>
      <button class="btn btn-secondary btn-sm" style="margin-top:8px" id="stop-here">Add as a stop to my trip</button>` : ''}</div>`;
  if (node) drawMap('place-map', { destNodeId: node.id, places: [{ lat: node.lat, lng: node.lng, name: d.name, id: d.id, kind: 'dest' }], refit: true });
  const plan = $('#plan-here'), add = $('#stop-here');
  if (plan) plan.onclick = () => { setTerminal(g.terms[0].id); S.stops = [d.id]; show('screen-trip'); };
  if (add) add.onclick = () => {
    if (!g.terms.some(t => t.id === S.terminalId)) { setTerminal(g.terms[0].id); S.stops = []; }
    S.stops = S.stops.filter(Boolean); if (!S.stops.includes(d.id)) S.stops.push(d.id);
    toast('Added to your trip'); show('screen-trip');
  };
};

function renderListing() {
  const p = byId(PLACES, S.place.id);
  if (!p) { $('#place-body').innerHTML = '<div class="empty-state"><div class="t">This listing was removed</div></div>'; return; }
  $('#place-title').textContent = p.name;
  $('#place-sub').textContent = `${p.category} · ${muniName(p.municipality)}, Guimaras`;
  const photos = p.photos || [], ix = Math.min(S.photoIx, Math.max(0, photos.length - 1));
  const near = nearestNode(p);
  const dest = NET.destinations.find(d => d.nodeId === near.n.id && servingTerminals(d).length);
  const g = dest ? gettingThere(dest) : null;
  const mine = (store.get('panaw_my_listings', [])).includes(p.id);
  $('#place-body').innerHTML = `<div class="card" style="padding:10px">${photoBox(photos[ix], muniName(p.municipality), true,
      photos.length > 1 ? `<button class="arrow l" data-ph="-1" aria-label="Previous photo">‹</button><button class="arrow r" data-ph="1" aria-label="Next photo">›</button><span class="count">${ix + 1} / ${photos.length}</span>` : '')}
      <div class="terminal-meta"><span class="data-tag demo">Listed by owner · not verified</span><span class="data-tag info">Posted ${new Date(p.createdAt).toLocaleDateString()}</span></div></div>
    <div class="card"><div class="card-title">About</div>
      <div style="font-size:13px; line-height:1.55; color:var(--ink); white-space:pre-line">${esc(p.description || 'No description yet.')}</div>
      ${p.contact ? `<div class="bd-row" style="margin-top:8px"><span class="k">Contact</span><span class="v plain">${esc(p.contact)}</span></div>` : ''}
      <div id="place-map" class="lmap short"></div><div class="map-note" id="place-map-note"></div>
      <div class="stepper-hint">Location set by the owner (${p.locationSource === 'gps' ? 'phone GPS' : 'map pin'}): <span class="coords">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span></div></div>
    <div class="card"><div class="card-title">Getting there</div>
      <div class="bd-row"><span class="k">Nearest stop on the network</span><span class="v plain">${esc(shortDest(near.n.name))}</span></div>
      <div class="bd-row"><span class="k">From that stop</span><span class="v">${near.km.toFixed(1)} km straight line</span></div>
      ${g ? g.html + `<div class="stepper-hint">Fare to the nearest stop. The last ${near.km.toFixed(1)} km is not included: agree on it with the driver or ask the TODA.</div>
        <button class="btn btn-primary" style="margin-top:12px" id="plan-here">Plan trip to the nearest stop</button>` : '<div class="stepper-hint">No terminal serves the nearest stop yet. Use Pick-up to call a trike.</div>'}
      <button class="btn btn-secondary btn-sm" style="margin-top:8px" id="pick-here">Call a trike to my location</button></div>
    ${mine ? '<button class="btn btn-danger btn-sm" id="del-listing">Remove my listing</button>' : ''}`;
  drawMap('place-map', { places: [{ lat: p.lat, lng: p.lng, name: p.name, id: p.id, kind: 'listing' }], refit: true });
  const ph = $('#place-body .photo');
  ph.onclick = e => { const a = e.target.closest('[data-ph]'); if (a) { S.photoIx = (ix + +a.dataset.ph + photos.length) % photos.length; renderListing(); } };
  const plan = $('#plan-here'); if (plan) plan.onclick = () => { setTerminal(g.terms[0].id); S.stops = [dest.id]; show('screen-trip'); };
  $('#pick-here').onclick = () => { if (dest) S.pu.dest = dest.id; show('screen-pickup'); };
  const del = $('#del-listing'); if (del) del.onclick = () => deleteListing(p.id);
}

/* ============================================================== TRIP */
function setTerminal(id) {
  const t = byId(NET.terminals, id); if (!t) return;
  S.terminalId = id; S.muni = t.municipality;
  S.stops = S.stops.filter(s => (t.destinationIds || []).includes(s)); if (!S.stops.length) S.stops = [''];
}
RENDER['screen-trip'] = () => {
  $('#mode-chips').innerHTML = MODES.map(m => `<button class="chip ${m.id === S.mode ? 'on' : ''}" data-mode="${m.id}">${esc(m.label)}${m.status !== 'active' ? ' (soon)' : ''}</button>`).join('');
  $('#muni').innerHTML = NET.municipalities.map(m => `<option value="${m.id}" ${m.id === S.muni ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  const terms = N.terminalsFor(NET, S.muni);
  $('#term').innerHTML = terms.map(t => `<option value="${t.id}" ${t.id === S.terminalId ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  const t = byId(NET.terminals, S.terminalId);
  const fr = byId(NET.fareRules, t.fareRuleId) || {};
  $('#term-name').textContent = t.name;
  $('#term-meta').innerHTML = `<span class="data-tag ${t.dataStatus === 'existing' ? 'existing' : 'demo'}">${t.dataStatus === 'existing' ? 'Existing data' : 'DEMO terminal'}</span>
    <span class="data-tag ${fr.source === 'rules.json' ? 'info' : 'demo'}">${esc(fr.status || '')}</span>
    ${t.latitude == null ? '<span class="data-tag todo">Coordinates required</span>' : ''}`;
  const dests = N.destinationsFor(NET, S.terminalId);
  $('#stops').innerHTML = S.stops.map((s, i) => `<div class="stop-row"><span class="n">${i + 1}</span>
    <select data-stop="${i}" aria-label="Destination ${i + 1}"><option value="">Select destination</option>${dests.map(d =>
      `<option value="${d.id}" ${d.id === s ? 'selected' : ''}>${esc(shortDest(d.name))}${d.nodeId == null ? ' (coordinates required)' : ''}</option>`).join('')}</select>
    ${S.stops.length > 1 ? `<button class="icon-btn" data-rm="${i}" aria-label="Remove stop">×</button>` : ''}</div>`).join('');
  $('#stop-count').textContent = S.stops.filter(Boolean).length + ' / 4 stops';
  $('#add-stop').disabled = S.stops.length >= 4;
  $('#best-order').checked = S.bestOrder;
  $('#hire').value = S.hire; $('#pax').textContent = S.pax; $('#disc').value = S.disc; $('#dpax').textContent = S.dpax;
  $('#pax-m').disabled = S.pax <= 1; $('#pax-p').disabled = S.pax >= 4;
  $('#dp-m').disabled = S.dpax <= 0 || S.disc === 'none'; $('#dp-p').disabled = S.dpax >= S.pax || S.disc === 'none';
};
$('#mode-chips').onclick = e => {
  const c = e.target.closest('[data-mode]'); if (!c) return;
  const m = MODES.find(x => x.id === c.dataset.mode);
  if (m.status !== 'active') return toast(`${m.label}: ${m.note || 'no route or fare data yet'}`);
  S.mode = m.id; RENDER['screen-trip']();
};
$('#muni').onchange = e => { const t = N.terminalsFor(NET, e.target.value)[0]; if (t) setTerminal(t.id); else S.muni = e.target.value; $('#near-out').innerHTML = ''; RENDER['screen-trip'](); };
$('#term').onchange = e => { setTerminal(e.target.value); $('#near-out').innerHTML = ''; RENDER['screen-trip'](); };
$('#stops').onchange = e => { const s = e.target.closest('[data-stop]'); if (s) { S.stops[+s.dataset.stop] = s.value; RENDER['screen-trip'](); } };
$('#stops').onclick = e => { const r = e.target.closest('[data-rm]'); if (r) { S.stops.splice(+r.dataset.rm, 1); RENDER['screen-trip'](); } };
$('#add-stop').onclick = () => { if (S.stops.length < 4) { S.stops.push(''); RENDER['screen-trip'](); } };
$('#best-order').onchange = e => S.bestOrder = e.target.checked;
$('#hire').onchange = e => S.hire = e.target.value;
$('#disc').onchange = e => { S.disc = e.target.value; if (S.disc === 'none') S.dpax = 0; RENDER['screen-trip'](); };
$('#pax-m').onclick = () => { S.pax--; S.dpax = Math.min(S.dpax, S.pax); RENDER['screen-trip'](); };
$('#pax-p').onclick = () => { S.pax++; RENDER['screen-trip'](); };
$('#dp-m').onclick = () => { S.dpax--; RENDER['screen-trip'](); };
$('#dp-p').onclick = () => { S.dpax++; RENDER['screen-trip'](); };

/* nearest terminal: straight-line distance to terminals with stored coordinates */
$('#near-btn').onclick = () => askGps('near');
function showNearest(pos, label) {
  const rows = NET.terminals.map(t => ({ t, km: t.latitude == null ? null : F.haversineKm(pos, { lat: t.latitude, lng: t.longitude }) }))
    .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
  $('#near-out').innerHTML = `<div class="divider-label">${esc(label)}</div>` + rows.map((r, i) =>
    `<div class="opt ${r.t.id === S.terminalId ? 'on' : ''}" data-pick="${r.km == null ? '' : r.t.id}">
      <div class="top"><b>${esc(r.t.name)}</b>${r.km == null ? '<span class="data-tag todo">Coordinates required</span>'
        : `<span class="badge ${i === 0 ? 'badge-green' : 'badge-navy'}">${i === 0 ? 'Closest · ' : ''}${r.km.toFixed(1)} km</span>`}</div>
      <div class="path">${esc(muniName(r.t.municipality))} · straight-line distance from your position</div></div>`).join('')
    + '<div class="stepper-hint">Want the trike to come to you instead? Use the Pick-up tab.</div>';
}
$('#near-out').onclick = e => { const p = e.target.closest('[data-pick]'); if (p && p.dataset.pick) { setTerminal(p.dataset.pick); RENDER['screen-trip'](); toast('Origin set to ' + byId(NET.terminals, p.dataset.pick).name); $('#near-out').innerHTML = ''; } };

/* ============================================================== ROUTE + FARE */
const nodeOf = id => id === 'origin' ? byId(NET.terminals, S.terminalId).nodeId : byId(NET.destinations, id).nodeId;
function legsFor(order) {
  const pts = ['origin', ...order];
  return pts.slice(1).map((id, i) => {
    const from = nodeOf(pts[i]), to = nodeOf(id);
    if (to == null) return { to: id, error: 'Coordinates required: this place has no verified location yet.' };
    const r = N.findRoute(NET, from, to, { mode: S.mode });
    return r.found ? { to: id, route: r } : { to: id, error: r.reason };
  });
}
function permutations(a) { return a.length <= 1 ? [a] : a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])); }
const legsKm = legs => legs.reduce((s, l) => s + (l.route ? l.route.distanceKm : 1e6), 0);

/* alternates: the best route with one of its segments switched off, re-run through the same Dijkstra */
function alternates(fromNode, toNode, best, net = NET) {
  const seen = new Set([best.nodeIds.join('>')]), out = [];
  for (const seg of best.segments) {
    const r = N.findRoute(net, fromNode, toNode, { mode: S.mode, overrides: { [seg.id]: { available: false } } });
    if (r.found && !seen.has(r.nodeIds.join('>'))) { seen.add(r.nodeIds.join('>')); out.push(r); }
  }
  return out.sort((a, b) => a.cost - b.cost).slice(0, 2);
}

$('#find-btn').onclick = () => {
  const stops = S.stops.filter(Boolean);
  if (!stops.length) return toast('Select at least one destination');
  if (new Set(stops).size !== stops.length) return toast('The same destination is listed twice');
  let order = stops;
  if (S.bestOrder && stops.length > 1) order = permutations(stops).reduce((b, p) => legsKm(legsFor(p)) < legsKm(legsFor(b)) ? p : b, stops);
  S.result = { order, reordered: order.join() !== stops.join() }; S.routeIx = 0;
  show('screen-result');
};

function stepsHtml(route) {
  return `<ul class="route-steps">${route.steps.map((s, i) => {
    const seg = route.segments[i - 1];
    return `<li class="route-step ${i === route.steps.length - 1 ? 'end' : ''}">${esc(shortDest(s.name))}
      <span class="muni">${esc(s.municipalityName)}</span>${seg ? `<span class="leg">+${seg.distanceKm} km · ${seg.estimatedMinutes} min · ${segLabel(seg.dataStatus)}</span>` : ''}</li>`;
  }).join('')}</ul>${route.crossesMunicipalities ? `<div class="muni-chain">${route.municipalityNames.map(n => `<span>${esc(n)}</span>`).join('<i>→</i>')}</div>` : ''}`;
}

RENDER['screen-result'] = () => {
  const t = byId(NET.terminals, S.terminalId);
  const { order } = S.result;
  const legs = legsFor(order);
  let options = null;   // single stop: the user may pick an alternate route
  if (legs.length === 1 && legs[0].route) {
    options = [legs[0].route, ...alternates(t.nodeId, nodeOf(order[0]), legs[0].route)];
    legs[0].route = options[Math.min(S.routeIx, options.length - 1)];
  }
  const fr = N.fareRulesFor(RULES, NET, t);
  const info = N.fareRuleInfo(RULES, NET, t);
  const fares = legs.map(l => l.route ? F.computeFare({ distanceKm: l.route.distanceKm, passengers: S.pax, discountedPax: S.dpax, discountType: S.disc, hireType: S.hire }, fr) : null);
  const ok = legs.every(l => l.route);
  const total = fares.reduce((s, f) => s + (f ? f.total : 0), 0);
  const km = legs.reduce((s, l) => s + (l.route ? l.route.distanceKm : 0), 0);
  const min = legs.reduce((s, l) => s + (l.route ? l.route.estimatedMinutes : 0), 0);
  S.lastTrip = ok ? { tripId: 'T' + Date.now().toString(36).toUpperCase(), municipality: muniName(t.municipality), terminal: t.name,
    destinations: order.map(id => shortDest(byId(NET.destinations, id).name)), distance: Math.round(km * 100) / 100, estimatedTime: min,
    fare: Math.round(total * 100) / 100, fareStatus: info.status, transportMode: S.mode, timestamp: new Date().toISOString() } : null;
  $('#res-sub').textContent = `${t.name} → ${order.length} stop${order.length > 1 ? 's' : ''}`;
  const digits = total.toFixed(2).split('').map(c => c === '.' ? '<div class="digit-cell dot">.</div>' : `<div class="digit-cell">${c}</div>`).join('');
  const f0 = fares[0];
  const lastNode = nodeOf(order[order.length - 1]);
  $('#res-body').innerHTML = `
    ${S.result.reordered ? `<div class="disclaimer" style="margin-bottom:12px"><span>Stops reordered to the shortest total distance: ${order.map(id => esc(shortDest(byId(NET.destinations, id).name))).join(' → ')}</span></div>` : ''}
    <div class="divider-label">Route information</div>
    ${options ? `<div class="card"><div class="card-title">Route options</div>${options.map((r, i) => `
      <div class="opt ${i === Math.min(S.routeIx, options.length - 1) ? 'on' : ''}" data-rix="${i}">
        <div class="top"><b>${i === 0 ? 'Suggested route' : 'Alternate route ' + i}</b>
          <span class="badge ${i === 0 ? 'badge-green' : 'badge-navy'}">${r.distanceKm} km · ${r.estimatedMinutes} min${i ? ` · +${(r.distanceKm - options[0].distanceKm).toFixed(1)} km` : ''}</span></div>
        <div class="path">${r.steps.map(s => esc(shortDest(s.name))).join(' → ')}</div></div>`).join('')}
      ${options.length === 1 ? '<div class="stepper-hint">No alternate route exists in the stored network for this trip.</div>' : ''}
      <div class="stepper-hint">The system selected the available route with the lowest route cost based on the stored transportation network. This is not live traffic.</div></div>` : ''}
    ${legs.map((l, i) => `<div class="card"><div class="leg-head"><b>${legs.length > 1 ? `Leg ${i + 1}: ` : ''}${esc(shortDest(i ? byId(NET.destinations, order[i - 1]).name : t.name))} → ${esc(shortDest(byId(NET.destinations, l.to).name))}</b>
        ${l.route ? `<span class="badge badge-navy">${l.route.distanceKm} km</span>` : ''}</div>
      ${l.route ? stepsHtml(l.route) : `<div class="route-card none"><div class="route-head"><span class="t">NO ROUTE AVAILABLE</span></div><div class="why">${esc(l.error)}</div></div>`}</div>`).join('')}
    <div id="res-map" class="lmap"></div><div class="map-note" id="res-map-note"></div>

    <div class="divider-label">Fare information</div>
    ${ok ? `<div class="fare-meter"><div class="meter-label">Estimated fare · ${S.pax} passenger${S.pax > 1 ? 's' : ''}</div>
        <div class="meter-digits"><span class="peso">₱</span>${digits}</div>
        <div class="meter-sub">${km.toFixed(2)} km · about ${min} min · ${S.hire === 'special' ? 'special trip' : 'regular hire'}</div></div>
      <div class="card" style="margin-top:12px"><div class="card-title">Fare breakdown</div>
        ${legs.length > 1 ? fares.map((f, i) => `<div class="bd-row"><span class="k">Leg ${i + 1} · ${legs[i].route.distanceKm} km</span><span class="v">${peso(f.total)}</span></div>`).join('') : `
        <div class="bd-row"><span class="k">Base fare (first ${f0.baseKm} km)</span><span class="v">${peso(f0.baseFare)}</span></div>
        <div class="bd-row"><span class="k">Extra distance ${f0.extraKm} km × ${peso(f0.perKmRate)}</span><span class="v">${peso(f0.distanceFare)}</span></div>
        <div class="bd-row"><span class="k">Passengers</span><span class="v">${f0.passengers}</span></div>
        ${f0.nightApplies ? `<div class="bd-row"><span class="k">Night adjustment</span><span class="v">${peso(f0.nightSurcharge)}</span></div>` : ''}
        ${f0.discountTotal ? `<div class="bd-row discount"><span class="k">Discount (${f0.discountedPax} × 20%)</span><span class="v">−${peso(f0.discountTotal)}</span></div>` : ''}`}
        <div class="bd-row total"><span class="k">Total</span><span class="v">${peso(total)}</span></div>
        ${legs.length > 1 ? '<div class="stepper-hint">Each leg is priced as its own trip with the current fare engine. Waiting time at stops is not charged until an ordinance sets a rate.</div>' : ''}</div>
      <div class="card"><div class="card-title">Fare basis</div>
        <div class="cite"><b>${esc(info.ordinance || '')}</b><br>${esc(info.lgu || '')}</div>
        <div class="terminal-meta" style="margin-top:8px"><span class="data-tag ${info.isDemo ? 'demo' : 'info'}">${esc(info.status || '')}</span></div>
        <div class="stepper-hint">${esc(info.statusNote || '')}</div></div>
      <button class="btn btn-primary" id="save-trip">Save trip record</button>`
    : `<div class="route-card none"><div class="route-head"><span class="t">NO FARE</span></div><div class="why">A fare needs a route for every stop.</div></div>`}`;
  drawMap('res-map', { route: legs.length === 1 && legs[0].route ? legs[0].route : null, originNodeId: t.nodeId, destNodeId: lastNode, refit: true });
  $('#res-body').onclick = e => { const o = e.target.closest('[data-rix]'); if (o) { S.routeIx = +o.dataset.rix; RENDER['screen-result'](); } };
  const sv = $('#save-trip');
  if (sv) sv.onclick = () => { S.history.unshift(S.lastTrip); store.set('panaw_history', S.history.slice(0, 50)); toast('Trip saved on this phone'); sv.disabled = true; };
};

/* ============================================================== PICK ME UP
   Ranks the trikes that are online by their ETA to the passenger's spot.
   Online trikes: drivers sharing their location from the driver console
   (last known position), plus DEMO vehicles with simulated positions.
   ETA = stored segment minutes + straight-line legs at the network's assumed
   speed. No live traffic.
   A request to a real driver goes to the server and the driver console
   (accept / decline / arrived). A request to a DEMO trike is only simulated. */
S.pu = { pos: null, label: '', placeId: '', vehicleId: null, rix: 0, dest: '', requested: null, refit: true };
let SPEED = 20, FAST = null;
const MAX_SNAP_KM = 3;              // a pin farther than this from every stored point is outside the network
const DRIVER_FRESH_MS = 5 * 60000;  // a driver position older than this is not "online"
let DRIVERS = [], SEEN_DRIVERS = [];   // available now / every fresh position (incl. busy)
const offNet = km => km / SPEED * 60;
const zeroRoute = id => ({ found: true, nodeIds: [id], segments: [], steps: [], distanceKm: 0, estimatedMinutes: 0, cost: 0 });

function routeTo(fromId, snap) { return fromId === snap.n.id ? zeroRoute(fromId) : N.findRoute(FAST, fromId, snap.n.id); }

/* a demo trike shuttles on a stored segment and may turn toward either end of it */
function demoEta(v, snap) {
  const pos = N.simulateDemoVehicle(v, NET, Date.now()); if (!pos) return null;
  const here = { lat: pos.latitude, lng: pos.longitude };
  const ends = [v.path[0], v.path[v.path.length - 1]].map(id => byId(NET.nodes, id));
  // shortcut: treats a 2-point demo path as one stored segment (true for every shipped demo vehicle); longer paths use straight lines
  const seg = v.path.length === 2 && NET.edges.find(e => [e.from, e.to].sort().join() === [...v.path].sort().join());
  const along = F.haversineKm(ends[0], here) / (F.haversineKm(ends[0], ends[1]) || 1);
  let best = null;
  ends.forEach((n, i) => {
    const share = i === 0 ? along : 1 - along;
    const toKm = seg ? share * seg.distance_km : F.haversineKm(here, n);
    const toMin = seg ? share * seg.estimated_minutes : offNet(toKm);
    const r = routeTo(n.id, snap); if (!r.found) return;
    const min = toMin + r.estimatedMinutes + offNet(snap.km);
    if (!best || min < best.min) best = { id: v.vehicleId, demo: true, municipality: v.municipality, terminalId: v.terminalId, pos, via: n.id, route: r, min, km: toKm + r.distanceKm + snap.km };
  });
  return best;
}
/* a real driver: straight line to the nearest stored point, then the fastest stored route */
function driverEta(d, snap) {
  const here = { lat: d.latitude, lng: d.longitude };
  const start = nearestNode(here);
  if (start.km > MAX_SNAP_KM) return null;
  const r = routeTo(start.n.id, snap); if (!r.found) return null;
  return { id: d.vehicleId, demo: false, municipality: d.municipality, terminalId: d.terminalId, label: d.driverName,
    pos: { ...d, label: d.vehicleId }, via: start.n.id, route: r,
    min: offNet(start.km) + r.estimatedMinutes + offNet(snap.km), km: start.km + r.distanceKm + snap.km, at: d.timestamp };
}
async function refreshDrivers() {
  try {
    const r = await api('/api/vehicles');
    SEEN_DRIVERS = r.vehicles.filter(v => v.status !== 'offline' && Date.now() - Date.parse(v.timestamp) < DRIVER_FRESH_MS);
    DRIVERS = SEEN_DRIVERS.filter(v => v.status === 'available');
  } catch { DRIVERS = []; SEEN_DRIVERS = []; }
}

function setPickup(pos, label, placeId = '') {
  if (S.pu.requested) return toast('Cancel your current request first');
  Object.assign(S.pu, { pos, label, placeId, vehicleId: null, rix: 0, requested: null, refit: true });
  RENDER['screen-pickup']();
}

/* the server's answer to a real request, in the passenger's words */
const PICKUP_STATUS = {
  requested: ['Waiting for the driver to accept', 'badge-amber'],
  accepted: ['On the way to you', 'badge-green'],
  arrived: ['Your trike has arrived', 'badge-green'],
  declined: ['The driver declined', 'badge-red'],
  expired: ['The driver did not answer', 'badge-red'],
  cancelled: ['Request cancelled', 'badge-navy']
};
async function sendPickup(offer) {
  const P = S.pu;
  try {
    const pickup = await api('/api/pickups', { vehicleId: offer.id, lat: P.pos.lat, lng: P.pos.lng, label: P.label,
      destinationId: P.dest || undefined, passengers: S.pax, discountedPax: S.dpax, discountType: S.disc, hireType: S.hire,
      etaMinutes: Math.ceil(offer.min), deviceKey: ownerKey() });
    P.requested = { ...offer, at: Date.now(), pickup };
    store.set('panaw_open_pickup', pickup.id);
    toast('Request sent to ' + offer.id);
  } catch (err) {
    toast(err.status ? err.message : 'Could not reach the server. Your request was not sent.');
    await refreshDrivers();
  }
  RENDER['screen-pickup']();
}
async function pollPickup() {
  const R = S.pu.requested;
  if (!R || !R.pickup || ['arrived', 'declined', 'expired', 'cancelled'].includes(R.pickup.status)) return;
  try { R.pickup = await api('/api/pickups/' + encodeURIComponent(R.pickup.id)); } catch { /* keep the last known status */ }
  if (R.pickup.status === 'accepted' && !R.acceptedAt) { R.acceptedAt = Date.now(); toast(R.id + ' accepted your request'); }
}

RENDER['screen-pickup'] = () => {
  const P = S.pu;
  const snap = P.pos ? nearestNode(P.pos) : null;
  const inNet = snap && snap.km <= MAX_SNAP_KM;
  const fleet = [...NET.demoVehicles.map(v => N.simulateDemoVehicle(v, NET, Date.now())).filter(Boolean).map(p => ({ ...p, label: p.vehicleId })),
                 ...SEEN_DRIVERS.map(d => ({ ...d, label: d.vehicleId }))];
  const ranked = inNet && !P.requested
    ? [...NET.demoVehicles.map(v => demoEta(v, snap)), ...DRIVERS.map(d => driverEta(d, snap))].filter(Boolean).sort((a, b) => a.min - b.min) : [];
  const chosen = P.requested || ranked.find(x => x.id === P.vehicleId) || ranked[0];
  const routes = !chosen ? [] : P.requested ? [P.requested.route]
    : [chosen.route, ...(chosen.route.segments.length ? alternates(chosen.via, snap.n.id, chosen.route, FAST) : [])];
  const route = routes[Math.min(P.rix, routes.length - 1)];
  const etaOf = r => chosen.min - chosen.route.estimatedMinutes + r.estimatedMinutes;

  let fareHtml = '';
  if (chosen && P.dest && !P.requested) {
    const d = byId(NET.destinations, P.dest);
    const r = d.nodeId === snap.n.id ? null : N.findRoute(NET, snap.n.id, d.nodeId);
    const term = byId(NET.terminals, chosen.terminalId) || byId(NET.terminals, NET.defaultTerminalId);
    const fr = term && N.fareRulesFor(RULES, NET, term), info = term && N.fareRuleInfo(RULES, NET, term);
    if (!r || !r.found || !fr) fareHtml = `<div class="route-card none"><div class="route-head"><span class="t">NO ROUTE AVAILABLE</span></div>
      <div class="why">${esc(!r ? 'You are already at this destination.' : !fr ? 'Missing fare rule for this trike\'s terminal.' : r.reason)}</div></div>`;
    else {
      const f = F.computeFare({ distanceKm: r.distanceKm, passengers: S.pax, discountedPax: S.dpax, discountType: S.disc, hireType: S.hire }, fr);
      fareHtml = `<div class="bd-row" style="margin-top:10px"><span class="k">Ride ${esc(shortDest(snap.n.name))} → ${esc(shortDest(d.name))}</span><span class="v">${r.distanceKm} km · ${r.estimatedMinutes} min</span></div>
        <div class="bd-row total"><span class="k">Estimated fare · ${S.pax} pax · ${S.hire === 'special' ? 'special' : 'regular'}</span><span class="v">${peso(f.total)}</span></div>
        <div class="terminal-meta"><span class="data-tag ${info.isDemo ? 'demo' : 'info'}">${esc(info.status || '')}</span><span class="data-tag info">${esc(term.name)} rule</span></div>
        <div class="stepper-hint">Same fare engine as the Trip tab, using the rule of the trike's home terminal. The pick-up distance is not charged: no ordinance sets a pick-up fee. Passengers and discount come from the Trip tab.</div>`;
    }
  }

  const R = P.requested;
  let left = R ? Math.max(0, R.min - (Date.now() - R.at) / 60000) : 0;
  if (R && R.pickup && R.pickup.status === 'accepted') {
    // live: the driver's latest reported position, routed to the passenger again
    const d = SEEN_DRIVERS.find(v => v.vehicleId === R.id), e = d && driverEta(d, snap);
    if (e) left = e.min;
  }
  const st = R && R.pickup ? PICKUP_STATUS[R.pickup.status] || [R.pickup.status, 'badge-navy'] : null;
  const ended = R && R.pickup && ['arrived', 'declined', 'expired', 'cancelled'].includes(R.pickup.status);
  $('#pu-top').innerHTML = R
    ? `<div class="card"><div class="card-title">${esc(R.id)} <span class="badge ${st ? st[1] : 'badge-amber'}" style="margin-left:auto">${st ? esc(st[0]) : 'DEMO · simulated'}</span></div>
        ${!ended ? `<div class="bd-row"><span class="k">${R.pickup && R.pickup.status === 'requested' ? 'Can reach you in about' : 'Arrives in about'}</span><span class="v">${left < 0.5 ? 'arriving now' : Math.ceil(left) + ' min'}</span></div>` : ''}
        ${R.pickup && R.pickup.fare ? `<div class="bd-row"><span class="k">Fare to ${esc(shortDest(R.pickup.destination.name))}</span><span class="v">${peso(R.pickup.fare.total)}</span></div>` : ''}
        <div class="bd-row"><span class="k">Pick-up</span><span class="v plain">${esc(P.label)}</span></div>
        <div class="stepper-hint">${R.pickup
          ? (R.pickup.status === 'requested' ? 'Sent to the driver\'s console. A request nobody answers expires after 2 minutes.'
            : R.pickup.status === 'accepted' ? 'ETA from the driver\'s last reported position over the stored roads. Not live traffic.' : '')
          : 'DEMO trike: no driver receives this. The countdown uses the ETA at the time of request.'}</div>
        ${ended ? '<button class="btn btn-primary btn-sm" id="pu-done">Choose another trike</button>' : '<button class="btn btn-danger btn-sm" id="pu-cancel">Cancel request</button>'}</div>`
    : `<div class="card"><div class="card-title">Where should the trike pick you up?</div>
        <button class="btn btn-secondary btn-sm" id="pu-gps">Use my location</button>
        <label class="field-label" style="margin-top:10px" for="pu-place">Or choose a known place</label>
        <select id="pu-place"><option value="">Select a place</option>${NET.nodes.map(n => `<option value="${n.id}" ${n.id === P.placeId ? 'selected' : ''}>${esc(shortDest(n.name))} · ${esc(muniName(n.municipality))}</option>`).join('')}</select>
        <div class="stepper-hint">Or tap the map below to drop a pin.</div>
        ${P.pos ? `<div class="terminal-meta"><span class="data-tag info">${esc(P.label)}</span>${inNet ? `<span class="data-tag existing">Nearest stored point: ${esc(shortDest(snap.n.name))} · ${snap.km.toFixed(2)} km</span>` : ''}</div>` : ''}
        ${P.pos && !inNet ? `<div class="route-card none"><div class="route-head"><span class="t">OUTSIDE THE ROUTE NETWORK</span></div>
          <div class="why">Your pin is ${snap.km.toFixed(1)} km from the nearest stored point. Pick-up is offered within ${MAX_SNAP_KM} km of the stored network.</div></div>` : ''}</div>`;

  drawMap('pu-map', { route, originNodeId: chosen && chosen.via, destNodeId: snap && snap.n.id, pin: P.pos, vehicles: fleet,
    onTap: P.requested ? null : p => setPickup(p, `Pin on the map (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`), refit: P.refit,
    note: P.requested ? '' : 'Tap the map to set your pick-up pin. Dashed circles are DEMO VEHICLES.' });
  P.refit = false;

  $('#pu-body').innerHTML = `
    ${ranked.length ? `<div class="divider-label">Online trikes near you</div>
      <div class="card"><div class="card-title">Fastest pick-up first</div>
        ${ranked.slice(0, 5).map((x, i) => `<div class="opt ${x === chosen ? 'on' : ''}" data-veh="${esc(x.id)}">
          <div class="top"><b>${esc(x.id)}</b><span class="badge ${i === 0 ? 'badge-green' : 'badge-navy'}">${i === 0 ? 'Fastest · ' : ''}${Math.ceil(x.min)} min</span></div>
          <div class="path">${esc(muniName(x.municipality))} · ${x.km.toFixed(1)} km away · ${x.demo ? '<span class="data-tag demo">DEMO VEHICLE · simulated request</span>'
            : `<span class="data-tag info">Driver app · last known ${new Date(x.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`}</div></div>`).join('')}
        <div class="stepper-hint">ETA = the trike's way onto the stored network + the fastest stored route to your nearest stored point + the last stretch to your pin, at the network's assumed ${SPEED} km/h. Refreshes every 5 seconds. Not live traffic.</div></div>`
    : inNet && !P.requested ? `<div class="route-card none"><div class="route-head"><span class="t">NO TRIKE AVAILABLE</span></div><div class="why">No online trike can reach this spot on the stored network.</div></div>` : ''}

    ${chosen ? `<div class="card"><div class="card-title">${esc(chosen.id)}'s way to you</div>
        ${routes.length > 1 ? routes.map((r, i) => `<div class="opt ${r === route ? 'on' : ''}" data-prix="${i}">
          <div class="top"><b>${i === 0 ? 'Fastest route' : 'Alternate route ' + i}</b>
            <span class="badge ${i === 0 ? 'badge-green' : 'badge-navy'}">${Math.ceil(etaOf(r))} min · ${r.distanceKm} km${i ? ` · +${Math.ceil(etaOf(r) - etaOf(routes[0]))} min` : ''}</span></div>
          <div class="path">${r.steps.map(s => esc(shortDest(s.name))).join(' → ')}</div></div>`).join('')
          : !P.requested && route.steps.length ? '<div class="stepper-hint">No alternate pick-up route exists in the stored network for this trike.</div>' : ''}
        ${route.steps.length ? stepsHtml(route) : '<div class="stepper-hint">The trike is already at your nearest stored point, so no road route is needed.</div>'}</div>` : ''}

    ${chosen && !P.requested ? `<div class="card"><div class="card-title">Where to? (optional)</div>
        <select id="pu-dest" aria-label="Destination"><option value="">Just pick me up</option>${NET.destinations.filter(d => d.nodeId != null).map(d => `<option value="${d.id}" ${d.id === P.dest ? 'selected' : ''}>${esc(shortDest(d.name))}</option>`).join('')}</select>
        ${fareHtml}</div>
      <button class="btn btn-primary" id="pu-req">Request ${esc(chosen.id)} · ${Math.ceil(etaOf(route))} min</button>` : ''}`;
  S.pu.offer = chosen && !P.requested ? { ...chosen, route, min: etaOf(route) } : null;
};
document.getElementById('screen-pickup').addEventListener('click', e => {
  const t = e.target;
  if (t.closest('#pu-gps')) return askGps('pickup');
  const v = t.closest('[data-veh]'); if (v) { S.pu.vehicleId = v.dataset.veh; S.pu.rix = 0; S.pu.refit = true; return RENDER['screen-pickup'](); }
  const r = t.closest('[data-prix]'); if (r) { S.pu.rix = +r.dataset.prix; return RENDER['screen-pickup'](); }
  if (t.closest('#pu-req') && S.pu.offer) {
    if (!S.pu.offer.demo) return sendPickup(S.pu.offer);
    S.pu.requested = { ...S.pu.offer, at: Date.now() }; toast('DEMO request: simulated on this phone'); return RENDER['screen-pickup']();
  }
  if (t.closest('#pu-cancel')) return cancelPickup();
  if (t.closest('#pu-done')) { S.pu.requested = null; store.set('panaw_open_pickup', null); refreshDrivers().then(() => RENDER['screen-pickup']()); }
});
document.getElementById('screen-pickup').addEventListener('change', e => {
  if (e.target.id === 'pu-place') { const n = byId(NET.nodes, e.target.value); if (n) setPickup({ lat: n.lat, lng: n.lng }, shortDest(n.name), n.id); }
  if (e.target.id === 'pu-dest') { S.pu.dest = e.target.value; RENDER['screen-pickup'](); }
});
async function cancelPickup() {
  const R = S.pu.requested;
  if (R && R.pickup) {
    try { R.pickup = await api(`/api/pickups/${encodeURIComponent(R.pickup.id)}/cancel`, { deviceKey: ownerKey() }); }
    catch (err) { toast(err.message); }
  }
  S.pu.requested = null; store.set('panaw_open_pickup', null);
  RENDER['screen-pickup']();
}
let puTick = 0;
setInterval(async () => {   // trikes move: refresh ETAs like a ride app, but never under an open dropdown
  if (!$('#screen-pickup').classList.contains('active') || document.activeElement.tagName === 'SELECT') return;
  const live = S.pu.requested && S.pu.requested.pickup;
  if (live) await pollPickup();
  if (live || ++puTick % 2 === 0) await refreshDrivers();
  if (S.pu.pos) RENDER['screen-pickup']();
}, 5000);

/* ============================================================== LIST YOUR PLACE */
const MAX_PHOTOS = 3, MAX_PHOTO_CHARS = 240000;   // server accepts up to 250 000
const LP = { pin: null, source: 'map', photos: [], muniTouched: false };
function ownerKey() {
  let k = store.get('panaw_owner_key', null);
  if (!k) { const a = new Uint8Array(16); crypto.getRandomValues(a); k = [...a].map(b => b.toString(16).padStart(2, '0')).join(''); store.set('panaw_owner_key', k); }
  return k;
}
function shrinkPhoto(file) {
  return new Promise((ok, fail) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      for (const [max, q] of [[1280, .8], [1024, .72], [800, .65], [640, .55], [480, .5]]) {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const d = c.toDataURL('image/jpeg', q);
        if (d.length <= MAX_PHOTO_CHARS) return ok(d);
      }
      fail(new Error('This photo is too large even after resizing.'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('That file is not an image this phone can read.')); };
    img.src = url;
  });
}
function nearestMuni(pos) {
  return NET.municipalities.reduce((b, m) => !b || F.haversineKm(pos, m.center) < F.haversineKm(pos, b.center) ? m : b, null);
}
function setListingPin(pos, source) {
  LP.pin = pos; LP.source = source;
  if (!LP.muniTouched) { const m = nearestMuni(pos); if (m) $('#lp-muni').value = m.id; }
  drawListingMap(true);
}
function drawListingMap(refit) {
  drawMap('lp-map', { pin: LP.pin, onTap: p => setListingPin(p, 'map'), refit });
  $('#lp-where').innerHTML = LP.pin
    ? `Pinned at <span class="coords">${LP.pin.lat.toFixed(5)}, ${LP.pin.lng.toFixed(5)}</span> (${LP.source === 'gps' ? 'phone GPS' : 'map'})`
    : 'No location set yet.';
}
function renderThumbs() {
  $('#lp-thumbs').innerHTML = LP.photos.map((p, i) => `<div class="th"><img src="${esc(p)}" alt="Photo ${i + 1}"><button data-rmph="${i}" aria-label="Remove photo">×</button></div>`).join('');
}
RENDER['screen-list'] = () => {
  $('#lp-cat').innerHTML = CATS.map(c => `<option>${esc(c)}</option>`).join('');
  if (!$('#lp-muni').options.length) $('#lp-muni').innerHTML = NET.municipalities.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  drawListingMap(!LP.pin);
  renderThumbs();
};
$('#lp-gps').onclick = () => askGps('listing');
$('#lp-muni').onchange = () => { LP.muniTouched = true; };
$('#lp-thumbs').onclick = e => { const b = e.target.closest('[data-rmph]'); if (b) { LP.photos.splice(+b.dataset.rmph, 1); renderThumbs(); } };
$('#lp-photos').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) {
    if (LP.photos.length >= MAX_PHOTOS) { toast(`Up to ${MAX_PHOTOS} photos`); break; }
    try { LP.photos.push(await shrinkPhoto(f)); } catch (err) { toast(err.message); }
  }
  renderThumbs();
};
$('#lp-submit').onclick = async () => {
  const body = { name: $('#lp-name').value, category: $('#lp-cat').value, municipality: $('#lp-muni').value,
    description: $('#lp-desc').value, contact: $('#lp-contact').value, photos: LP.photos,
    lat: LP.pin && LP.pin.lat, lng: LP.pin && LP.pin.lng, locationSource: LP.source, ownerKey: ownerKey() };
  if (body.name.trim().length < 3) return toast('Enter the name of the place');
  if (!LP.pin) return toast('Set the location: use your location or tap the map');
  if (!$('#lp-ok').checked) return toast('Please confirm you may post this place and its photos');
  const btn = $('#lp-submit'); btn.disabled = true; btn.textContent = 'Publishing…';
  try {
    const p = await api('/api/places', body);
    const mine = store.get('panaw_my_listings', []); mine.unshift(p.id); store.set('panaw_my_listings', mine);
    PLACES.unshift(p);
    ['#lp-name', '#lp-desc', '#lp-contact'].forEach(s => { $(s).value = ''; });
    $('#lp-ok').checked = false; Object.assign(LP, { pin: null, photos: [], muniTouched: false });
    toast('Listing published');
    S.stack = ['screen-explore']; S.place = { kind: 'listing', id: p.id }; S.photoIx = 0; show('screen-place', false);
  } catch (err) {
    toast(err.status ? err.message : 'Could not reach the server. Your listing was not sent; try again when online.');
  } finally { btn.disabled = false; btn.textContent = 'Publish listing'; }
};
async function deleteListing(id) {
  if (!confirm('Remove this listing for everyone?')) return;
  try {
    await api(`/api/places/${encodeURIComponent(id)}/delete`, { ownerKey: ownerKey() });
    PLACES = PLACES.filter(p => p.id !== id);
    store.set('panaw_my_listings', store.get('panaw_my_listings', []).filter(x => x !== id));
    toast('Listing removed'); show('screen-explore');
  } catch (err) { toast(err.message); }
}
RENDER['screen-mine'] = () => {
  const ids = store.get('panaw_my_listings', []);
  const mine = PLACES.filter(p => ids.includes(p.id));
  $('#mine-body').innerHTML = (mine.length ? `<div class="card">${mine.map(p => `<div class="history-item" style="padding:8px 0" data-mine="${esc(p.id)}">
      <div class="ic-box" style="overflow:hidden">${p.photos && p.photos[0] ? `<img src="${esc(p.photos[0])}" alt="" style="width:100%;height:100%;object-fit:cover">` : icon('pin')}</div>
      <div class="mid"><div class="rt">${esc(p.name)}</div><div class="dt">${esc(p.category)} · ${esc(muniName(p.municipality))} · ${new Date(p.createdAt).toLocaleDateString()}</div></div>
      <span class="go">›</span></div>`).join('')}</div>`
    : '<div class="empty-state"><div class="t">No listings from this phone</div><div class="s">Places you publish appear here.</div></div>')
    + '<button class="btn btn-primary" data-go="screen-list">List a place</button>';
};
$('#mine-body').onclick = e => { const r = e.target.closest('[data-mine]'); if (r) { S.place = { kind: 'listing', id: r.dataset.mine }; S.photoIx = 0; show('screen-place'); } };

/* ============================================================== HISTORY */
RENDER['screen-history'] = () => {
  $('#hist-body').innerHTML = (S.history.length ? `<div class="card">${S.history.map(h => `<div class="history-item" style="padding:8px 0">
      <div class="ic-box">${icon('route')}</div><div class="mid"><div class="rt">${esc(h.terminal)} → ${esc(h.destinations.join(' → '))}</div>
      <div class="dt">${new Date(h.timestamp).toLocaleString()} · ${h.distance} km · ${esc(h.fareStatus || '')}</div></div>
      <div class="fare">${peso(h.fare)}</div></div>`).join('')}</div>
      <button class="btn btn-danger btn-sm" id="clear-hist">Clear history</button>`
    : '<div class="empty-state"><div class="t">No trips yet</div><div class="s">Saved trips appear here and stay on this phone.</div></div>')
    + '<div class="footer-links"><a href="/booking.html">Signed receipts from terminal bookings</a></div>';
  const c = $('#clear-hist'); if (c) c.onclick = () => { S.history = []; store.set('panaw_history', []); RENDER['screen-history'](); };
};

/* ============================================================== POLICY */
RENDER['screen-policy'] = () => {
  const cell = (m, mode) => {
    if (mode !== 'tricycle') return 'None';
    const ts = N.terminalsFor(NET, m.id);
    return ts.some(t => (byId(NET.fareRules, t.fareRuleId) || {}).source === 'rules.json') ? 'Matrix' : ts.length ? 'Demo' : 'None';
  };
  $('#policy-body').innerHTML = `
    <div class="card"><div class="card-title">Ordinances on file</div>
      ${NET.municipalities.map(m => { const t = N.terminalsFor(NET, m.id)[0]; const i = t && N.fareRuleInfo(RULES, NET, t);
        return `<div class="seg-row"><div><div class="t">${esc(m.name)}</div><div class="s">${esc(i ? i.ordinance : 'No terminal configured')}</div></div>
          <span class="data-tag ${i && !i.isDemo ? 'info' : 'demo'}">${esc(i ? i.status : 'None')}</span></div>`; }).join('')}</div>
    <div class="card"><div class="card-title">Vehicle policy per municipality</div>
      <table class="policy"><tr><th>Municipality</th><th>Tricycle</th><th>Van</th><th>Motorcycle</th></tr>
      ${NET.municipalities.map(m => `<tr><td>${esc(m.name)}</td><td>${cell(m, 'tricycle')}</td><td>${cell(m, 'van')}</td><td>${cell(m, 'motorcycle')}</td></tr>`).join('')}</table>
      <div class="stepper-hint">Matrix: project fare matrix. Demo: DEMO / SAMPLE RATE. None: no policy on file. Each municipality sets its own rules for tricycles, vans and motorcycles. A vehicle type opens for a municipality only after its ordinance is added to the data.</div></div>
    <div class="card"><div class="card-title">Current tricycle rates (rules.json)</div>
      <table class="rule-table"><tr><th>Item</th><th>Value</th></tr>
        <tr><td>Base fare, first ${RULES.baseKm} km</td><td>${peso(RULES.baseFare)}</td></tr>
        <tr><td>Per succeeding km</td><td>${peso(RULES.perKmRate)}</td></tr>
        <tr><td>Special trip base</td><td>${peso(RULES.specialBaseFare)}</td></tr>
        <tr><td>Special trip per km</td><td>${peso(RULES.specialPerKmRate)}</td></tr>
        <tr><td>Student / senior / PWD</td><td>${RULES.discountRate * 100}%</td></tr>
        <tr><td>Night surcharge</td><td>${RULES.nightSurchargeEnabled ? RULES.nightSurchargeRate * 100 + '%' : 'Off (not in ordinance)'}</td></tr></table>
      <div class="stepper-hint">${esc(RULES._rateNote || '')}</div></div>`;
};

/* ============================================================== ASSOCIATIONS */
RENDER['screen-assoc'] = () => {
  $('#assoc-munis').innerHTML = NET.municipalities.map(m => `<button class="chip ${m.id === S.assocMuni ? 'on' : ''}" data-am="${m.id}">${esc(m.name)}</button>`).join('');
  const ts = N.terminalsFor(NET, S.assocMuni);
  $('#assoc-body').innerHTML = `<div class="card">${ts.length ? ts.map(t => `<div class="contact-chip"><div class="who">
      <div class="avatar" style="background:${t.operator ? 'var(--navy)' : 'var(--sky-2)'};color:${t.operator ? '#fff' : 'var(--ink-soft)'}">${t.operator ? esc(t.operator.split(' ').map(w => w[0]).join('').slice(0, 2)) : '?'}</div>
      <div><div class="name">${esc(t.operator || 'Association: to verify')}</div><div class="meta">${esc(t.name)}</div>
      <div class="meta">Officers / contact: to verify · Members: to verify</div></div></div>
      <span class="data-tag ${t.operator ? 'existing' : 'todo'}">${t.operator ? 'On file' : 'To verify'}</span></div>`).join('')
    : '<div class="empty-state"><div class="t">No terminals configured</div></div>'}</div>
    <div class="card"><div class="card-title">What PANAW gives associations</div>
      <div class="check">Their official fare matrix shown to passengers</div>
      <div class="check">Their terminals on the map and in Explore</div>
      <div class="check">A contact for complaints and lost items</div>
      <div class="check">Trip counts per terminal on the monitor</div></div>
    <div class="disclaimer"><span>Names, officers and members come from the LGU and association inventory. No name is filled in until it has been verified.</span></div>`;
};
$('#assoc-munis').onclick = e => { const c = e.target.closest('[data-am]'); if (c) { S.assocMuni = c.dataset.am; RENDER['screen-assoc'](); } };

/* ============================================================== TOURISM OFFICES */
RENDER['screen-tourism'] = () => {
  $('#tourism-body').innerHTML = `<div class="card">
      <div class="contact-chip"><div class="who"><div class="avatar" style="background:var(--navy);color:#fff">PT</div><div><div class="name">Guimaras Provincial Tourism Office</div><div class="meta">Contact: to verify</div></div></div><span class="data-tag todo">To verify</span></div>
      ${NET.municipalities.map(m => `<div class="contact-chip"><div class="who"><div class="avatar" style="background:var(--sky-2);color:var(--navy)">${esc(m.name.split(' ').map(w => w[0]).join(''))}</div>
        <div><div class="name">${esc(m.name)} Tourism Office</div><div class="meta">Contact: to verify</div></div></div><span class="data-tag todo">To verify</span></div>`).join('')}</div>
    <div class="card"><div class="card-title">What the offices supply</div>
      <div class="check">Destination photos, with credit</div><div class="check">Open hours and entrance fees</div>
      <div class="check">Verification of owner listings</div><div class="check">Emergency and help-desk numbers</div></div>`;
};

/* ============================================================== OFFLINE */
RENDER['screen-offline'] = () => {
  const online = navigator.onLine;
  $('#off-sub').textContent = online ? 'Connected now. The items marked stored also work without signal.' : 'OFFLINE · running on stored data';
  $('#offline-body').innerHTML = `
    <div class="card"><div class="card-title">Stored on this phone</div>
      <div class="seg-row"><div><div class="t">Fares, routes and terminals</div><div class="s">${NET.terminals.length} terminals · ${NET.destinations.length} places · ${NET.edges.length} road segments</div></div><span class="badge badge-green">Stored</span></div>
      <div class="seg-row"><div><div class="t">Network map</div><div class="s">Drawn from stored points. Shown when the street map cannot load.</div></div><span class="badge badge-green">Stored</span></div>
      <div class="seg-row"><div><div class="t">Saved trips</div><div class="s">${S.history.length} trip record${S.history.length === 1 ? '' : 's'}</div></div><span class="badge badge-green">Stored</span></div></div>
    <div class="card"><div class="card-title">Works without signal</div>
      <div class="check">Fare calculation and breakdown</div><div class="check">Route suggestion and alternate routes</div>
      <div class="check">Multi-stop trips</div><div class="check">Pick-up ETA for DEMO vehicles</div>
      <div class="check">GPS position (GPS does not need mobile data)</div></div>
    <div class="card"><div class="card-title">Needs internet</div>
      <div class="check">Street map tiles from OpenStreetMap</div>
      <div class="check">Publishing a listing and seeing new ones${NET.backend && NET.backend.mode === 'local' ? ' (this APK stores listings on the phone only)' : ''}</div>
      <div class="check">Driver positions from other phones</div></div>`;
};

/* ============================================================== START */
async function start() {
  let data;
  try {
    const [net, rules] = await Promise.all([api('/api/network'), api('/api/rules')]);
    data = { net, rules, at: new Date().toISOString() };
    store.set('panaw_data_cache', data);
    S.dataFrom = 'live';
  } catch (err) {
    data = store.get('panaw_data_cache', null);
    if (!data) {
      $('#loading-body').innerHTML = `<div class="route-card none"><div class="route-head"><span class="t">Cannot load route data</span></div>
        <div class="why">${esc(err.message)}. Connect once to the PANAW server so the data can be stored on this phone.</div></div>`;
      return;
    }
    S.dataFrom = data.at;
  }
  NET = data.net; RULES = data.rules;
  SPEED = (NET.settings && NET.settings.assumedSpeedKph) || 20;
  FAST = { ...NET, settings: { ...NET.settings, costWeights: { distance: 0, time: 1 } } };   // pick-up ranks by minutes, not km
  S.terminalId = NET.defaultTerminalId; S.muni = byId(NET.terminals, S.terminalId).municipality;
  MODES = [...NET.transportModes.map(m => ({ ...m })),
    { id: 'van', label: 'Van (V-hire)', status: 'future', note: 'Proposed. No policy or fare data yet' },
    { id: 'motorcycle', label: 'Motorcycle', status: 'future', note: 'Proposed. Rules differ per municipality' }];
  try {
    const r = await api('/api/places');
    PLACES = r.places; CATS = r.categories;
    store.set('panaw_places_cache', { categories: CATS, places: PLACES.map(p => ({ ...p, photos: [] })) });   // photos stay online
  } catch {
    const c = store.get('panaw_places_cache', { categories: [], places: [] });
    PLACES = c.places; CATS = c.categories;
  }
  await refreshDrivers();
  const offline = S.dataFrom !== 'live' || !navigator.onLine;
  $('#net-pill').textContent = offline ? 'Offline · stored route data' : `${NET.backend ? NET.backend.label : 'Online'} · stored route data`;
  $('#conn-chip').classList.toggle('show', offline);
  show(S.who ? (S.who === 'tourist' ? 'screen-explore' : 'screen-trip') : 'screen-welcome', false);
}
window.addEventListener('online', () => $('#conn-chip').classList.remove('show'));
window.addEventListener('offline', () => $('#conn-chip').classList.add('show'));
start();
