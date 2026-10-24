/* ============================================================================
   PANAW — passenger app
   ----------------------------------------------------------------------------
   This file renders. It does NOT decide money. Every peso shown here came from
   POST /api/quote or from the stored trip record. The one exception is the
   offline fallback at the bottom, which exists so a dead network during a
   defense does not stop the demo — and which labels itself on screen when used.
   ========================================================================== */
'use strict';

/* ------------------------------------------------------------------ state */
const S = {
  rules: null,
  destination: null,
  passengers: 1,
  discountedPax: 0,
  discountType: 'none',
  hireType: 'regular',
  quote: null,
  trip: null,
  bookingDriverId: null,
  bookingQuote: null,
  contacts: loadContacts(),
  deviceId: deviceId(),
  offline: false,
  // Guimaras expansion
  network: null,          // municipalities, terminals, destinations, route graph
  municipalityId: null,
  terminalId: null,
  resolved: null,         // local route preview for the selected terminal → destination
  quoteRoute: null,       // the route the server used for the last quote
  gps: { status: 'off', watchId: null }
};

let pollTimer = null, animTimer = null, countdownTimer = null;
let tripProgress = 0, countdownLeft = 0, deviationOpen = false;

/* ------------------------------------------------------------- tiny utils */
const $  = id => document.getElementById(id);
const peso = n => '₱' + Number(n).toFixed(2);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = n => String(n).split(' ').map(w => w[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const row = (k, v, cls) => `<div class="bd-row ${cls||''}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
const rowPlain = (k, v) => `<div class="bd-row"><span class="k">${k}</span><span class="v plain">${v}</span></div>`;

function deviceId() {
  let id = localStorage.getItem('tf_device');
  if (!id) { id = 'dev-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('tf_device', id); }
  return id;
}
function loadContacts() {
  try { return JSON.parse(localStorage.getItem('tf_contacts')) || defaultContacts(); }
  catch { return defaultContacts(); }
}
function defaultContacts() {
  return [{ id: 1, name: 'Elena Cruz', relation: 'Parent', phone: '+63 917 123 4567' }];
}
function saveContacts() { localStorage.setItem('tf_contacts', JSON.stringify(S.contacts)); }

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._tt);
  window._tt = setTimeout(() => t.classList.remove('show'), 2800);
}
function setOffline(on) {
  S.offline = on;
  $('conn-chip').classList.toggle('show', on);
}

/* --------------------------------------------------------------- API layer */
async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The server answered, so this is not an offline failure.
    const err = new Error(data.reason ? `${data.error}: ${data.reason}` : (data.error || `Request failed (${res.status})`));
    err.status = res.status;
    throw err;
  }
  setOffline(false);
  return data;
}

/* ------------------------------------------------------------- navigation */
const NAV_FOR = {
  'screen-home': 'screen-home', 'screen-fare-result': 'screen-home',
  'screen-booking': 'screen-booking', 'screen-history': 'screen-history',
  'screen-receipt': 'screen-history', 'screen-rules': 'screen-rules',
  'screen-active-trip': null
};
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('.screen-scroll').forEach(s => s.scrollTop = 0);
  const target = NAV_FOR[id];
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.target === target));
  $('bottomnav').classList.toggle('hidden', id === 'screen-active-trip');
}
function go(id) {
  show(id);
  if (id === 'screen-booking') renderBooking();
  if (id === 'screen-history') renderHistory();
  if (id === 'screen-rules')   renderRules();
  if (id === 'screen-home')    renderNight();
}
const openModal  = id => $(id).classList.add('show');
const closeModal = id => $(id).classList.remove('show');

/* ============================================================================
   BOOT
   ========================================================================== */
(async function boot() {
  try {
    S.rules = await api('/api/rules');
  } catch {
    setOffline(true);
    S.rules = FALLBACK_RULES;
    toast('Server unreachable — running in offline demo mode.');
  }
  S.network = await loadNetwork();

  // Origin: municipality → terminal → destination, all from the data files.
  const startTerminal = S.network.terminals.find(t => t.id === S.network.defaultTerminalId) || S.network.terminals[0];
  fillSelect($('municipality-select'), S.network.municipalities.map(m => ({
    v: m.id, t: m.name + (S.network.terminals.some(t => t.municipality === m.id) ? '' : ' — no terminal configured')
  })));
  $('municipality-select').value = startTerminal.municipality;
  onMunicipality(startTerminal.id);
  fillSelect($('discount-type'), S.rules.discountTypes.map(d => ({ v: d.id, t: d.basis === '—' ? d.label : `${d.label} — 20%, ${d.basis}` })));

  $('rules-night-enabled').checked  = S.rules.nightSurchargeEnabled;
  $('rules-simulate-night').checked = S.rules.simulateNight;

  wire();
  onHireType();
  refreshSteppers();
  renderNight();
  renderContacts();
  renderGps();
  resumeOpenTrip();
})();

function fillSelect(sel, items, placeholder) {
  sel.innerHTML = (placeholder ? `<option value="">${placeholder}</option>` : '') +
    items.map(i => `<option value="${i.v}">${esc(i.t)}</option>`).join('');
}

/** If this device already has a trip in progress, walk straight back into it. */
async function resumeOpenTrip() {
  if (S.offline) return;
  try {
    const open = await api(`/api/trips?device=${S.deviceId}&open=1`);
    if (open.length) {
      S.trip = open[0];
      S.destination = S.trip.destination;
      enterActiveTrip();
      toast('Rejoined your trip in progress.');
    }
  } catch { /* nothing in progress */ }
}

/* ============================================================================
   EVENT WIRING
   ========================================================================== */
function wire() {
  document.querySelectorAll('[data-go]').forEach(el => el.onclick = () => go(el.dataset.go));
  document.querySelectorAll('[data-close]').forEach(el => el.onclick = () => closeModal(el.dataset.close));
  document.querySelectorAll('.nav-item').forEach(el => el.onclick = () => go(el.dataset.target));

  $('municipality-select').onchange = () => onMunicipality();
  $('terminal-select').onchange = onTerminal;
  $('destination-select').onchange = onDestination;
  $('gps-btn').onclick = () => S.gps.status === 'off' || S.gps.status === 'unavailable' ? openModal('modal-gps') : stopGps();
  $('gps-confirm-btn').onclick = () => { closeModal('modal-gps'); startGps(); };
  $('hire-type').onchange = onHireType;
  $('discount-type').onchange = onDiscountType;
  $('pax-minus').onclick  = () => changePax(-1);
  $('pax-plus').onclick   = () => changePax(1);
  $('disc-minus').onclick = () => changeDisc(-1);
  $('disc-plus').onclick  = () => changeDisc(1);
  $('calc-btn').onclick   = calculateFare;
  $('booking-toggle').onchange = onBookingToggle;

  $('open-contacts-btn').onclick = openContacts;
  $('safety-inline').onclick     = openContacts;
  $('add-contact-btn').onclick   = addContact;

  $('lock-fare-btn').onclick = lockFare;
  $('booking-destination').onchange = renderBooking;
  $('request-btn').onclick = requestTricycle;

  $('share-btn').onclick  = openShare;
  $('copy-link-btn').onclick = copyLink;
  $('report-btn').onclick = () => { $('report-details').value = ''; openModal('modal-report'); };
  $('submit-report-btn').onclick = submitReport;
  $('alert-btn').onclick  = () => sendAlert('manual');
  $('dev-minor').onclick  = () => reportPosition('minor');
  $('dev-major').onclick  = () => reportPosition('major');
  $('confirm-safe-btn').onclick = confirmSafe;
  $('send-now-btn').onclick     = () => { stopCountdown(); closeModal('modal-deviation'); sendAlert('manual-from-deviation'); };
  $('end-trip-btn').onclick = endTrip;

  $('rules-night-enabled').onchange  = patchRules;
  $('rules-simulate-night').onchange = patchRules;

  window.addEventListener('resize', layoutMap);
}

/* ============================================================================
   ORIGIN — municipality → terminal → destination (Guimaras expansion)
   ========================================================================== */
const NET_CACHE_KEY = 'tf_network_cache';

/** Network data from the server; the last copy is kept so routes still work offline. */
async function loadNetwork() {
  try {
    const net = await api('/api/network');
    try { localStorage.setItem(NET_CACHE_KEY, JSON.stringify(net)); } catch { /* storage full or blocked */ }
    return net;
  } catch {
    setOffline(true);
    try {
      const cached = JSON.parse(localStorage.getItem(NET_CACHE_KEY));
      if (cached && Array.isArray(cached.terminals) && cached.terminals.length) return cached;
    } catch { /* no usable cache */ }
    return fallbackNetwork(S.rules);
  }
}
const currentTerminal = () => S.network.terminals.find(t => t.id === S.terminalId);
const muniName = id => (S.network.municipalities.find(m => m.id === id) || { name: id }).name;
/** The rules object the fare engine uses for the selected terminal. */
const termRules = () => TrikeNetwork.fareRulesFor(S.rules, S.network, currentTerminal()) || S.rules;
const termRuleInfo = () => TrikeNetwork.fareRuleInfo(S.rules, S.network, currentTerminal());

function onMunicipality(preferTerminalId) {
  S.municipalityId = $('municipality-select').value;
  const terminals = TrikeNetwork.terminalsFor(S.network, S.municipalityId);
  fillSelect($('terminal-select'), terminals.map(t => ({ v: t.id, t: t.name + (t.dataStatus === 'demo' ? ' (DEMO)' : '') })),
             terminals.length ? null : 'No terminal configured');
  $('terminal-select').disabled = !terminals.length;
  if (preferTerminalId && terminals.some(t => t.id === preferTerminalId)) $('terminal-select').value = preferTerminalId;
  onTerminal();
}
function onTerminal() {
  S.terminalId = $('terminal-select').value || null;
  const t = currentTerminal();
  S.destination = null; S.resolved = null;
  if (!t) {
    $('terminal-name').textContent = 'No terminal configured in ' + muniName(S.municipalityId);
    $('terminal-meta').innerHTML = '';
    fillSelect($('destination-select'), [], 'No destinations');
    fillSelect($('booking-destination'), [], 'No destinations');
    renderRoutePreview();
    return;
  }
  $('terminal-name').textContent = `${t.name}, ${muniName(t.municipality)}`;
  const info = termRuleInfo();
  $('terminal-meta').innerHTML =
    (t.dataStatus === 'demo' ? '<span class="data-tag demo">Demo terminal</span>' : '<span class="data-tag existing">Project data</span>') +
    (t.latitude == null ? '<span class="data-tag todo">Coordinates required</span>' : '') +
    `<span class="data-tag ${info.isDemo ? 'demo' : 'info'}">${esc(info.isDemo ? 'DEMO / SAMPLE RATE' : info.label)}</span>`;

  const dests = TrikeNetwork.destinationsFor(S.network, t.id);
  const label = d => {
    const res = TrikeNetwork.resolveTrip(S.rules, S.network, { terminalId: t.id, destinationId: d.id });
    return res.error ? `${d.name} — no route available` : `${d.name} (~${res.route.distanceKm} km)`;
  };
  const items = dests.map(d => ({ v: d.id, t: label(d) }));
  fillSelect($('destination-select'), items, 'Select destination…');
  fillSelect($('booking-destination'), items, 'Select destination…');
  fillSelect($('booking-pickup'), (t.pickupPoints && t.pickupPoints.length ? t.pickupPoints : [t.name]).map(p => ({ v: p, t: p })));
  renderRoutePreview();
  onHireType();
}

/* ============================================================================
   HOME
   ========================================================================== */
function onDestination() {
  const id = $('destination-select').value;
  S.destination = S.network.destinations.find(d => d.id === id) || null;
  S.resolved = S.destination
    ? TrikeNetwork.resolveTrip(S.rules, S.network, { terminalId: S.terminalId, destinationId: id })
    : null;
  renderRoutePreview();
}
function renderRoutePreview() {
  $('route-preview').innerHTML = S.resolved ? routeHTML(S.resolved, true) : '';
}
/** ROUTE information — kept separate from the FARE information on purpose. */
function routeHTML(res, withMap) {
  if (res.error) {
    return `<div class="route-card none">
      <div class="route-head"><div class="t">${res.noRoute ? 'NO ROUTE AVAILABLE' : esc(res.error)}</div></div>
      <div class="why">${esc(res.reason || 'There is currently no configured route between this terminal and destination.')}</div>
    </div>`;
  }
  const r = res.route;
  const tag = r.dataStatus === 'existing' ? '<span class="data-tag existing">Stored route data</span>'
            : r.dataStatus === 'demo' ? '<span class="data-tag demo">Demo route data</span>'
            : '<span class="data-tag demo">Partly demo data</span>';
  const steps = r.steps.map((s, i) => {
    const seg = r.segments[i - 1];
    return `<li class="route-step ${i === r.steps.length - 1 ? 'end' : ''}">${esc(s.name)}
      <span class="muni">${esc(s.municipalityName)}</span>
      ${seg ? `<span class="leg">+${seg.distanceKm} km · ~${seg.estimatedMinutes} min${seg.dataStatus === 'demo' ? ' · demo segment' : ''}</span>` : ''}</li>`;
  }).join('');
  const speed = (S.network.settings && S.network.settings.assumedSpeedKph) || 20;
  return `<div class="route-card">
    <div class="route-head"><div class="t">Suggested route</div>${tag}</div>
    ${rowPlain('Origin', esc(res.terminal.name))}
    ${rowPlain('Destination', esc(res.destination.name))}
    ${row('Distance', r.distanceKm + ' km')}
    ${row('Estimated travel time', '~' + r.estimatedMinutes + ' min')}
    <ol class="route-steps">${steps}</ol>
    ${r.crossesMunicipalities ? `<div class="muni-chain">${r.municipalityNames.map(n => `<span>${esc(n)}</span>`).join('<i>→</i>')}</div>` : ''}
    <div class="why">The system selected the available route with the lowest route cost based on the stored transportation network. It does not use live traffic data.
      Travel time assumes ${speed} km/h.${r.dataStatus !== 'existing' ? ' Demo segments are estimates (straight-line distance × road factor). TODO: verify local route data.' : ''}</div>
    ${withMap ? `<div class="netmap">${TrikeMap.render(S.network, {
        route: r, originNodeId: r.nodeIds[0], destNodeId: r.nodeIds[r.nodeIds.length - 1],
        gps: S.gps.status === 'active' ? S.gps : null, height: 230 })}</div>${TrikeMap.LEGEND}` : ''}
  </div>`;
}
function onHireType() {
  S.hireType = $('hire-type').value;
  const r = termRules();
  const demo = termRuleInfo().isDemo ? ' (DEMO / SAMPLE RATE)' : '';
  $('hire-hint').textContent = S.hireType === 'special'
    ? `Special trip: the whole unit is hired at ${peso(r.specialBaseFare)} for the first ${r.baseKm} km plus ${peso(r.specialPerKmRate)}/km, however many of you ride.${demo}`
    : `Regular hire: the standard queue rate — ${peso(r.baseFare)} for the first ${r.baseKm} km plus ${peso(r.perKmRate)}/km, charged to each passenger.${demo}`;
  refreshSteppers();
}
function onDiscountType() {
  S.discountType = $('discount-type').value;
  if (S.discountType === 'none') S.discountedPax = 0;
  refreshSteppers();
}
function changePax(d) {
  S.passengers = Math.max(1, Math.min(4, S.passengers + d));
  if (S.discountedPax > S.passengers) S.discountedPax = S.passengers;
  refreshSteppers();
}
function changeDisc(d) {
  S.discountedPax = Math.max(0, Math.min(S.passengers, S.discountedPax + d));
  refreshSteppers();
}
function refreshSteppers() {
  $('pax-count').textContent  = S.passengers;
  $('disc-count').textContent = S.discountedPax;
  $('pax-minus').disabled  = S.passengers <= 1;
  $('pax-plus').disabled   = S.passengers >= 4;
  $('disc-minus').disabled = S.discountedPax <= 0;
  $('disc-plus').disabled  = S.discountedPax >= S.passengers || S.discountType === 'none';
  $('pax-hint').textContent = S.hireType === 'special'
    ? 'Riders sharing this special trip (max 4). One whole-unit fare is split among the group.'
    : 'Riders in this shared ride (max 4). Each passenger is charged their own fare.';
}
function renderNight() {
  const r = S.rules;
  const night = r.isNightNow !== undefined ? r.isNightNow : localIsNight(r);
  const badge = $('night-badge'), hint = $('night-hint');
  if (!night) {
    badge.className = 'badge badge-navy';
    badge.textContent = 'Daytime rate';
    hint.textContent = `Night rates apply automatically between ${String(r.nightStart).padStart(2,'0')}:00 and ${String(r.nightEnd).padStart(2,'0')}:00, read from the server clock. Neither passenger nor driver can switch this on.`;
  } else if (!r.nightSurchargeEnabled) {
    badge.className = 'badge badge-amber';
    badge.textContent = 'Night — ₱0 added';
    hint.textContent = 'Inside the night window, but the ordinance currently authorizes no surcharge, so nothing is added.';
  } else {
    badge.className = 'badge badge-amber';
    badge.textContent = `Night +${(r.nightSurchargeRate * 100).toFixed(0)}%`;
    hint.textContent = "Inside the ordinance's night window — the authorized surcharge is added automatically.";
  }
}
function onBookingToggle() {
  const on = $('booking-toggle').checked;
  $('home-mode-text').textContent = on ? 'Booking Mode — request to a pickup point' : 'Terminal Ride Mode — regular queue';
  if (on) { toast('Switched to Booking Mode.'); setTimeout(() => go('screen-booking'), 400); }
  else { toast('Back to the terminal queue.'); go('screen-home'); }
}

/* ============================================================================
   QUOTE + LOCK
   ========================================================================== */
function tripInputs() {
  return {
    terminalId: S.terminalId,
    destinationId: S.destination ? S.destination.id : null,
    passengers: S.passengers,
    discountedPax: S.discountedPax,
    discountType: S.discountType,
    hireType: S.hireType
  };
}
async function calculateFare() {
  if (!S.destination) return toast('Select a destination first.');
  if (S.resolved && S.resolved.error) return toast(S.resolved.noRoute ? 'No route available to this destination.' : S.resolved.error);
  try {
    const res = await api('/api/quote', { body: tripInputs() });
    S.quote = res.fare;
    S.quoteRoute = { ...S.resolved, route: res.route, terminal: res.terminal, destination: res.destination, fareRule: res.fareRule };
  } catch (e) {
    if (e.status) return toast(e.message);      // the server answered with a reason
    setOffline(true);
    S.quote = localCompute({ ...tripInputs(), distanceKm: S.resolved.route.distanceKm });
    S.quoteRoute = S.resolved;
    toast('Server unreachable — showing a locally computed estimate.');
  }
  renderFareResult(S.quote);
  show('screen-fare-result');
}
function renderMeter(total) {
  const c = $('meter-digits');
  c.innerHTML = '<span class="peso">₱</span>';
  for (const ch of Number(total).toFixed(2)) {
    const cell = document.createElement('div');
    cell.className = ch === '.' ? 'digit-cell dot' : 'digit-cell digit-roll';
    cell.textContent = ch === '.' ? '•' : ch;
    c.appendChild(cell);
  }
}
function breakdownHTML(f) {
  let h = '';
  const special = f.hireType === 'special';
  h += row(`${special ? 'Special-trip base' : 'Base fare'} (first ${f.baseKm} km)`, peso(f.baseFare));
  h += row(`Distance fare (${f.extraKm.toFixed(1)} km × ${peso(f.perKmRate)})`, peso(f.distanceFare));
  h += row(special ? 'Whole-unit fare' : 'Fare for one passenger', peso(f.singleBase));
  h += special
    ? row(`Split among ${f.passengers} rider${f.passengers > 1 ? 's' : ''}`, peso(f.singleBase / f.passengers) + ' each')
    : row(`Charged per passenger (× ${f.passengers})`, peso(f.singleBase * f.passengers));
  if (f.nightApplies) h += row(`Night surcharge (${(f.nightSurchargeRate*100).toFixed(0)}%, server clock)`, peso(f.nightSurcharge));
  h += row('Subtotal before discounts', peso(f.subtotal));
  if (f.discountTotal > 0) h += row(`${cap(f.discountType)} discount × ${f.discountedPax}`, '− ' + peso(f.discountTotal), 'discount');
  h += `<div class="bd-row total"><span class="k">Total payable</span><span class="v">${peso(f.total)}</span></div>`;
  return h;
}
function paxHTML(f) {
  return f.paxBreakdown.map(p =>
    `<div class="pax-chip"><div class="who">Passenger ${p.index}${p.discounted ? `<span class="tagd">${cap(f.discountType)}</span>` : ''}</div><div class="amt">${peso(p.amount)}</div></div>`
  ).join('');
}
function renderFareResult(f) {
  renderMeter(f.total);
  const qr = S.quoteRoute;
  $('meter-sub').textContent = `${qr.terminal.name} → ${S.destination.name} · ${f.distanceKm} km · ${f.hireType === 'special' ? 'Special trip' : 'Regular hire'}`;
  $('result-route').innerHTML = routeHTML(qr, false);
  const demoRate = qr.fareRule && qr.fareRule.isDemo
    ? `<div class="disclaimer" style="margin-top:10px;"><span><strong>DEMO / SAMPLE RATE.</strong> ${esc(qr.fareRule.statusNote || 'No ordinance on file for this terminal.')}</span></div>` : '';
  $('fare-breakdown').innerHTML = breakdownHTML(f) +
    `<div class="stepper-hint" style="margin-top:8px;">Each share rounds to the nearest ${peso(f.fareStep)} and the total is the exact sum of the shares — no centavo gap when paying cash.</div>` + demoRate;
  $('pax-breakdown').innerHTML = paxHTML(f);
  $('lock-status-area').innerHTML = '';
  $('lock-fare-btn').textContent = 'Lock fare';
  $('lock-fare-btn').disabled = false;
}
async function lockFare() {
  if (S.offline) return toast('Locking needs the server. The fare above is an offline estimate only.');
  $('lock-fare-btn').disabled = true;
  try {
    S.trip = await api('/api/trips', {
      body: { ...tripInputs(), deviceId: S.deviceId, emergencyContacts: S.contacts, preferredDriverId: null }
    });
    $('lock-status-area').innerHTML =
      `<div class="badge badge-locked" style="margin-bottom:14px; padding:8px 14px; font-size:12.5px;">Locked on the server · ${S.trip.id}</div>`;
    toast('Fare locked. Any driver who accepts sees this exact amount.');
    enterActiveTrip();
  } catch (e) {
    $('lock-fare-btn').disabled = false;
    toast(e.message);
  }
}

/* ============================================================================
   ACTIVE TRIP
   ========================================================================== */
function enterActiveTrip() {
  S.destination = S.trip.destination;
  $('map-dest-label').textContent = S.destination.name;
  renderTrip();
  show('screen-active-trip');
  startAnimation();
  startPolling();
}
function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const fresh = await api(`/api/trips/${S.trip.id}`);
      const changed = fresh.status !== S.trip.status || fresh.events.length !== S.trip.events.length;
      S.trip = fresh;
      if (changed) renderTrip();
      if (fresh.status === 'completed') { stopPolling(); showReceipt(fresh); }
    } catch { setOffline(true); }
  }, 2000);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

function renderTrip() {
  const t = S.trip, f = t.fare;
  const statusText = {
    locked: 'Locked — waiting for a driver to accept',
    accepted: `${t.driver ? t.driver.name : 'Driver'} is on the way`,
    in_progress: 'En route to destination',
    completed: 'Trip completed',
    cancelled: 'Trip cancelled'
  }[t.status] || t.status;
  $('trip-status-text').textContent = statusText;
  $('trip-lock-pill').textContent = `Fare locked at ${peso(f.total)} · ${t.id}`;

  if (t.driver) {
    $('driver-avatar').textContent = initials(t.driver.name);
    $('driver-name').textContent = t.driver.name;
    $('driver-unit').textContent = `Unit #${t.driver.id} · ${t.driver.unit}`;
    $('driver-rating').textContent = `Rating ${t.driver.rating}`;
  }

  $('trip-details').innerHTML =
    row('Locked fare', peso(f.total)) +
    rowPlain('Hire type', f.hireType === 'special' ? 'Special trip' : 'Regular hire') +
    row('Passengers', f.passengers) +
    row('Distance', f.distanceKm + ' km') +
    rowPlain('Route', `${esc(t.origin.name)} → ${esc(t.destination.name)}`) +
    (t.route && t.route.municipalityNames.length > 1 ? rowPlain('Municipalities', esc(t.route.municipalityNames.join(' → '))) : '') +
    (t.route ? row('Est. travel time', '~' + t.route.estimatedMinutes + ' min') : '') +
    rowPlain('Locked at', new Date(t.lockedAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }));

  renderSafetyInline();
  renderSafetyLog(t.events);

  // A major deviation recorded by the server opens the confirmation prompt.
  const last = [...t.events].reverse().find(e => e.severity);
  if (last && last.severity === 'major' && !deviationOpen && !safetyResolvedAfter(last)) openDeviationPrompt(last);
  paintBanner(last);
}
function safetyResolvedAfter(event) {
  const idx = S.trip.events.indexOf(event);
  return S.trip.events.slice(idx + 1).some(e => ['safe_confirmed', 'alert_sent'].includes(e.type));
}
function paintBanner(last) {
  const b = $('deviation-banner');
  b.classList.remove('show', 'minor');
  if (!last || safetyResolvedAfter(last) || last.severity === 'on_route') return;
  b.classList.add('show');
  if (last.severity === 'minor') {
    b.classList.add('minor');
    $('deviation-banner-text').textContent = `Minor deviation — ${last.offCorridorKm.toFixed(2)} km off the corridor, within tolerance. Monitoring only.`;
  } else {
    $('deviation-banner-text').textContent = `Major deviation — ${last.offCorridorKm.toFixed(2)} km off the expected route.`;
  }
}
function renderSafetyInline() {
  const n = S.contacts.length;
  $('safety-inline-text').textContent = n
    ? `${n} emergency contact${n > 1 ? 's' : ''} — ${S.contacts.map(c => c.name).join(', ')}`
    : 'No emergency contacts set';
}
function renderSafetyLog(events) {
  const shown = events.filter(e => ['deviation', 'safe_confirmed', 'alert_sent'].includes(e.type)).slice().reverse();
  $('safety-log').innerHTML = shown.map(e => {
    const cls = e.type === 'alert_sent' ? '' : e.type === 'safe_confirmed' ? 'ok' : 'warn';
    const title = e.type === 'alert_sent' ? 'Emergency alert sent'
                : e.type === 'safe_confirmed' ? 'Safety confirmed by passenger'
                : `Deviation logged (${e.severity})`;
    return `<div class="safety-log-item ${cls}">
      <div class="head"><span>${title}</span><span>${new Date(e.at).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit',second:'2-digit'})}</span></div>
      <div>${esc(e.note || '')}</div>
      ${e.notified ? `<div>Notified: ${esc(e.notified.join(', '))}</div>` : ''}
      ${e.coords ? `<div class="coords">${e.coords.lat.toFixed(5)}, ${e.coords.lng.toFixed(5)} — ${e.offCorridorKm.toFixed(2)} km off corridor</div>` : ''}
    </div>`;
  }).join('');
}

/* ---- map ---- */
function toBoxPx(pt) {
  const box = $('map-box');
  return { x: pt.x / 300 * box.clientWidth, y: pt.y / 190 * box.clientHeight };
}
function layoutMap() {
  const box = $('map-box');
  if (!box || !box.clientWidth) return;
  const o = toBoxPx({ x: 40, y: 150 }), d = toBoxPx({ x: 260, y: 45 });
  const po = document.querySelector('.map-pin.origin'), pd = document.querySelector('.map-pin.dest');
  po.style.left = o.x + 'px'; po.style.top = o.y + 'px';
  pd.style.left = d.x + 'px'; pd.style.top = d.y + 'px';
  const path = $('route-path');
  const p = toBoxPx(path.getPointAtLength(path.getTotalLength() * tripProgress));
  $('trike-marker').style.left = p.x + 'px';
  $('trike-marker').style.top  = p.y + 'px';
}
function startAnimation() {
  tripProgress = 0;
  clearInterval(animTimer);
  layoutMap();
  animTimer = setInterval(() => {
    if (S.trip.status === 'locked') return;               // not moving until a driver accepts
    tripProgress = Math.min(1, tripProgress + 0.045);
    layoutMap();
    if (tripProgress >= 1) clearInterval(animTimer);
  }, 900);
}

/* ---- position reports: the SERVER classifies severity ---- */
function simulatedCoords(offsetKm) {
  const o = S.trip.origin, d = S.trip.destination, t = tripProgress || 0.35;
  const lat = o.lat + (d.lat - o.lat) * t;
  const lng = o.lng + (d.lng - o.lng) * t;
  const deg = offsetKm / 111;                              // rough km → degrees
  return { lat: lat + deg, lng: lng - deg * 0.8 };
}
async function reportPosition(kind) {
  if (!S.trip) return;
  const coords = simulatedCoords(kind === 'major' ? 1.2 : 0.5);
  try {
    const res = await api(`/api/trips/${S.trip.id}/events`, {
      body: { type: 'deviation', coords, note: 'GPS ping from passenger device (simulated)' }
    });
    S.trip = res.trip;
    renderTrip();
    toast(`Server classified this ping as: ${res.event.severity}`);
  } catch (e) { toast(e.message); }
}
function openDeviationPrompt(event) {
  deviationOpen = true;
  $('deviation-modal-text').textContent =
    `The tricycle is ${event.offCorridorKm.toFixed(2)} km off the expected route to ${S.trip.destination.name}.`;
  openModal('modal-deviation');
  countdownLeft = S.rules.confirmWindowSeconds || 8;
  paintCountdown();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdownLeft--;
    paintCountdown();
    if (countdownLeft <= 0) { stopCountdown(); closeModal('modal-deviation'); sendAlert('auto'); }
  }, 1000);
}
function paintCountdown() {
  $('countdown-num').textContent = countdownLeft;
  $('countdown-ring').style.setProperty('--pct', (countdownLeft / (S.rules.confirmWindowSeconds || 8)) * 100);
}
function stopCountdown() { clearInterval(countdownTimer); countdownTimer = null; deviationOpen = false; }

async function confirmSafe() {
  stopCountdown();
  closeModal('modal-deviation');
  try {
    // Logged deliberately: false positives are a result the study needs to count.
    const res = await api(`/api/trips/${S.trip.id}/events`, {
      body: { type: 'safe_confirmed', coords: simulatedCoords(1.2), note: 'Passenger confirmed safe — no alert sent' }
    });
    S.trip = res.trip; renderTrip();
    toast('Confirmed. No alert was sent.');
  } catch (e) { toast(e.message); }
}
async function sendAlert(trigger) {
  if (!S.contacts.length) { toast('Add an emergency contact first.'); return openContacts(); }
  const reason = { auto: 'Automatic — deviation not confirmed in time',
                   manual: 'Manual — sent by passenger',
                   'manual-from-deviation': 'Manual — sent during the deviation warning' }[trigger] || trigger;
  try {
    const res = await api(`/api/trips/${S.trip.id}/events`, {
      body: { type: 'alert_sent', coords: simulatedCoords(deviationOpen ? 1.2 : 0), note: reason }
    });
    S.trip = res.trip; renderTrip();
    toast(`Alert sent to ${S.contacts.map(c => c.name).join(', ')}.`);
  } catch (e) { toast(e.message); }
}

async function endTrip() {
  stopPolling(); stopCountdown(); clearInterval(animTimer);
  try {
    const trip = await api(`/api/trips/${S.trip.id}/complete`, { body: {} });
    showReceipt(trip);
  } catch (e) { toast(e.message); }
}

/* ============================================================================
   RECEIPT
   ========================================================================== */
function showReceipt(trip) {
  stopPolling();
  const f = trip.fare;
  const url = `${window.PANAW_PUBLIC_ORIGIN || location.origin}/r/${trip.id}?s=${trip.signature || ''}`;
  let h = '';

  h += `<div class="card" style="text-align:center; background:linear-gradient(160deg,var(--navy-deep),#0d3f4a); border:none;">
    <div style="color:#8FD9CE; font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; font-weight:700;">Trip ID</div>
    <div style="font-family:var(--font-mono); color:#fff; font-size:18px; font-weight:700; margin-top:4px;">${esc(trip.id)}</div>
    <div class="badge badge-locked" style="margin-top:10px;">Locked ${new Date(trip.lockedAt).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'})} · paid ${peso(f.total)}</div>
  </div>`;

  h += `<div class="card"><div class="card-title">Route</div>
    ${rowPlain('Route', `${esc(trip.origin ? trip.origin.name : 'Terminal')} → ${esc(trip.destination.name)}`)}
    ${trip.route && trip.route.steps.length > 2 ? rowPlain('Via', esc(trip.route.steps.slice(1, -1).map(s => s.name).join(', '))) : ''}
    ${trip.route && trip.route.municipalityNames.length > 1 ? rowPlain('Municipalities', esc(trip.route.municipalityNames.join(' → '))) : ''}
    ${rowPlain('Hire type', f.hireType === 'special' ? 'Special trip' : 'Regular hire')}
    ${row('Distance', trip.destination.km + ' km')}
    ${trip.fareRule && trip.fareRule.isDemo ? rowPlain('Fare rule', 'DEMO / SAMPLE RATE') : ''}
    ${row('Passengers', f.passengers)}
    ${rowPlain('Completed', new Date(trip.completedAt).toLocaleString('en-PH'))}
  </div>`;

  if (trip.driver) {
    h += `<div class="card"><div class="card-title">Driver and unit</div>
      ${rowPlain('Driver', esc(trip.driver.name))}
      ${rowPlain('Unit', `#${esc(trip.driver.id)} · ${esc(trip.driver.unit)}`)}
    </div>`;
  }

  h += `<div class="card"><div class="card-title">Fare breakdown</div>${breakdownHTML(f)}</div>`;
  h += `<div class="card"><div class="card-title">What each passenger paid</div><div class="pax-list">${paxHTML(f)}</div></div>`;

  const safety = trip.events.filter(e => ['deviation','safe_confirmed','alert_sent'].includes(e.type));
  if (safety.length) {
    h += `<div class="card"><div class="card-title" style="color:var(--red);">Safety log</div><div class="safety-log" id="receipt-safety"></div></div>`;
  }

  h += `<div class="card" style="text-align:center;">
    <div class="card-title" style="justify-content:center;">Verification</div>
    <div class="qr-box"><canvas id="qr-canvas"></canvas></div>
    <div style="font-family:var(--font-mono); font-size:11px; color:var(--ink-soft); margin-top:8px;">${esc(trip.signature || '')}</div>
    <div style="font-size:11px; color:var(--ink-soft); margin-top:6px;">Scan to open the signed receipt on any phone. The signature is checked by the server.</div>
    <div style="font-size:10.5px; color:var(--ink-soft); margin-top:6px; word-break:break-all;">${esc(url)}</div>
  </div>`;

  h += `<button class="btn btn-secondary" data-go="screen-home">Back to home</button>`;

  $('receipt-scroll').innerHTML = h;
  $('receipt-scroll').querySelector('[data-go]').onclick = () => go('screen-home');
  if (safety.length) {
    const saved = S.trip; S.trip = trip;
    document.getElementById('receipt-safety').innerHTML = '';
    renderSafetyLogInto('receipt-safety', trip.events);
    S.trip = saved;
  }
  drawQR($('qr-canvas'), url);
  show('screen-receipt');
  S.trip = null;
}
function renderSafetyLogInto(elId, events) {
  const el = document.getElementById(elId);
  el.innerHTML = events.filter(e => ['deviation','safe_confirmed','alert_sent'].includes(e.type)).reverse().map(e => {
    const cls = e.type === 'alert_sent' ? '' : e.type === 'safe_confirmed' ? 'ok' : 'warn';
    const title = e.type === 'alert_sent' ? 'Emergency alert sent'
                : e.type === 'safe_confirmed' ? 'Safety confirmed' : `Deviation (${e.severity})`;
    return `<div class="safety-log-item ${cls}"><div class="head"><span>${title}</span><span>${new Date(e.at).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'})}</span></div><div>${esc(e.note||'')}</div></div>`;
  }).join('');
}

/* ============================================================================
   HISTORY / RULES / BOOKING
   ========================================================================== */
async function renderHistory() {
  const list = $('history-list');
  list.innerHTML = '<div class="empty-state"><div class="s">Loading…</div></div>';
  try {
    const trips = (await api(`/api/trips?device=${S.deviceId}`)).filter(t => t.status === 'completed');
    if (!trips.length) {
      list.innerHTML = '<div class="empty-state"><div class="t">No completed trips yet</div><div class="s">Lock a fare and end a trip to issue your first receipt.</div></div>';
      return;
    }
    list.innerHTML = trips.map(t => `
      <div class="card history-item" data-trip="${t.id}">
        <div class="ic-box"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg></div>
        <div class="mid">
          <div class="rt">${esc(t.destination.name)}</div>
          <div class="dt">${t.origin ? 'From ' + esc(t.origin.name) + ' · ' : ''}${new Date(t.completedAt).toLocaleString('en-PH')} · ${t.destination.km} km · ${t.passengers} pax</div>
        </div>
        <div class="fare">${peso(t.fare.total)}</div>
      </div>`).join('');
    list.querySelectorAll('[data-trip]').forEach(el => el.onclick = async () => {
      showReceipt(await api(`/api/trips/${el.dataset.trip}`));
    });
  } catch {
    list.innerHTML = '<div class="empty-state"><div class="t">Server unreachable</div><div class="s">History lives on the server.</div></div>';
  }
}
function renderRules() {
  const t = currentTerminal();
  if (!t) {
    $('rules-ordinance').innerHTML = '<div class="stepper-hint">No terminal is configured in this municipality, so no fare rule applies.</div>';
    $('rules-matrix').innerHTML = '';
    renderModes();
    return;
  }
  const r = termRules(), info = termRuleInfo();
  $('rules-ordinance').innerHTML =
    rowPlain('LGU', esc(info.lgu)) + rowPlain('Ordinance', esc(info.ordinance)) + rowPlain('Terminal', esc(`${t.name}, ${muniName(t.municipality)}`)) +
    rowPlain('Rate status', `<span class="data-tag ${info.isDemo ? 'demo' : 'info'}">${esc(info.status)}</span>`) +
    `<div class="stepper-hint">${esc(info.statusNote || '')}</div>`;
  renderModes();
  $('rules-matrix').innerHTML = `
    <tr><th>Component</th><th>Rate</th></tr>
    <tr><td>Regular hire — first ${r.baseKm} km</td><td>${peso(r.baseFare)} <em>per passenger</em></td></tr>
    <tr><td>Regular hire — succeeding km</td><td>${peso(r.perKmRate)} / km per passenger</td></tr>
    <tr><td>Special trip — first ${r.baseKm} km</td><td>${peso(r.specialBaseFare)} <em>whole unit</em></td></tr>
    <tr><td>Special trip — succeeding km</td><td>${peso(r.specialPerKmRate)} / km</td></tr>
    <tr><td>Student / Senior (RA 9994) / PWD (RA 10754)</td><td>${(r.discountRate*100).toFixed(0)}% of that passenger's fare</td></tr>
    <tr><td>Night window</td><td>${String(r.nightStart).padStart(2,'0')}:00 – ${String(r.nightEnd).padStart(2,'0')}:00 (server clock)</td></tr>
    <tr><td>Night surcharge</td><td>+${(r.nightSurchargeRate*100).toFixed(0)}%</td></tr>
    <tr><td>Rounding</td><td>Each share to the nearest ${peso(r.fareStep)}</td></tr>
    <tr><td>Deviation tolerance</td><td>${r.deviationToleranceKm} km from the corridor</td></tr>`;
}
function renderModes() {
  $('rules-modes').innerHTML = (S.network.transportModes || []).map(m =>
    rowPlain(esc(m.label), m.status === 'active'
      ? '<span class="data-tag existing">Active</span>'
      : `<span class="data-tag info">Future — ${esc(m.note || 'no data')}</span>`)).join('');
}
async function patchRules() {
  try {
    S.rules = { ...S.rules, ...await api('/api/admin/rules', {
      body: { nightSurchargeEnabled: $('rules-night-enabled').checked, simulateNight: $('rules-simulate-night').checked }
    }) };
    renderNight();
    toast('Ordinance updated for every connected device.');
  } catch (e) { toast(e.message); }
}
async function renderBooking() {
  const night = S.rules.isNightNow && S.rules.nightSurchargeEnabled;
  $('booking-settings-summary').innerHTML =
    rowPlain('Hire type', S.hireType === 'special' ? 'Special trip' : 'Regular hire') +
    row('Passengers', S.passengers) +
    rowPlain('Discounted', S.discountType === 'none' ? 'None' : `${S.discountedPax} × ${cap(S.discountType)}`) +
    rowPlain('Night rate', night ? `Yes (+${(S.rules.nightSurchargeRate*100).toFixed(0)}%)` : 'No');

  const destId = $('booking-destination').value;
  const listEl = $('booking-tricycle-list');
  $('booking-estimate-card').style.display = 'none';
  S.bookingDriverId = null;
  if (!destId) { listEl.innerHTML = '<div class="empty-state"><div class="s">Pick a destination to see nearby units.</div></div>'; return; }

  // Only units registered to the selected terminal. Demo terminals have no
  // driver roster, and none is invented for them.
  const t = currentTerminal();
  const units = S.rules.drivers.filter(d => t && (t.driverIds || []).includes(d.id));
  if (!units.length) {
    listEl.innerHTML = '<div class="empty-state"><div class="t">No registered units</div><div class="s">No driver roster is on file for this terminal yet. Use the terminal queue on Home instead.</div></div>';
    return;
  }
  listEl.innerHTML = units.map(d => `
    <div class="tricycle-option" data-driver="${d.id}">
      <div class="top">
        <div style="font-weight:700; color:var(--navy); font-size:13.5px;">${esc(d.name)}</div>
        <div class="plate">${esc(d.id)}</div>
      </div>
      <div style="font-size:11.5px; color:var(--ink-soft); margin-top:4px;">${esc(d.unit)} · rating ${d.rating} · ${d.seats} seats</div>
      <div style="font-size:12px; color:var(--teal); font-weight:700; margin-top:6px;">ETA ${d.eta} min to pickup</div>
    </div>`).join('');
  listEl.querySelectorAll('[data-driver]').forEach(el => el.onclick = () => selectDriver(el, destId));
}
async function selectDriver(el, destId) {
  document.querySelectorAll('.tricycle-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  S.bookingDriverId = el.dataset.driver;
  try {
    // Identical inputs, identical endpoint: booking can never be cheaper,
    // dearer, or quietly discount-free compared with the terminal queue.
    const res = await api('/api/quote', { body: { ...tripInputs(), destinationId: destId } });
    S.bookingQuote = res.fare;
    $('booking-estimate').innerHTML =
      breakdownHTML(res.fare) +
      rowPlain('ETA to pickup', S.rules.drivers.find(d => d.id === S.bookingDriverId).eta + ' minutes');
    $('booking-estimate-card').style.display = 'block';
  } catch (e) { toast(e.message); }
}
async function requestTricycle() {
  const destId = $('booking-destination').value;
  if (!destId) return toast('Select a destination first.');
  if (!S.bookingDriverId) return toast('Select a unit first.');
  try {
    S.trip = await api('/api/trips', {
      body: { ...tripInputs(), destinationId: destId, deviceId: S.deviceId,
              emergencyContacts: S.contacts, preferredDriverId: S.bookingDriverId }
    });
    toast('Requested. The fare is locked before the driver moves.');
    enterActiveTrip();
  } catch (e) { toast(e.message); }
}

/* ============================================================================
   GPS — device location (Guimaras expansion)
   Off until the passenger turns it on, explained before the phone asks for
   permission, and kept on this device: the passenger app shows the position,
   it does not send it anywhere.
   ========================================================================== */
function startGps() {
  if (!('geolocation' in navigator)) return gpsFailed('This device or browser has no location service.');
  if (!window.isSecureContext) return gpsFailed('Browsers only allow location on secure pages (the Android app, or localhost).');
  S.gps.status = 'requesting';
  renderGps();
  S.gps.watchId = navigator.geolocation.watchPosition(pos => {
    S.gps = { ...S.gps, status: 'active', lat: pos.coords.latitude, lng: pos.coords.longitude,
              accuracy: Math.round(pos.coords.accuracy), at: new Date(pos.timestamp || Date.now()) };
    renderGps();
    if (S.resolved && !S.resolved.error) renderRoutePreview();
  }, err => {
    gpsFailed(err.code === 1 ? 'Location permission was denied.' : err.code === 3 ? 'Timed out waiting for a GPS fix.' : 'The device could not determine a position.');
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
}
function stopGps() {
  if (S.gps.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(S.gps.watchId);
  S.gps = { status: 'off', watchId: null };
  renderGps();
  if (S.resolved && !S.resolved.error) renderRoutePreview();
  toast('GPS turned off.');
}
function gpsFailed(reason) {
  if (S.gps.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(S.gps.watchId);
  S.gps = { status: 'unavailable', watchId: null, reason };
  renderGps();
}
function renderGps() {
  const g = S.gps, badge = $('gps-badge'), hint = $('gps-hint'), out = $('gps-readout'), btn = $('gps-btn');
  const states = {
    off:         ['badge badge-navy',  'OFF',         'Off. Your location is only read after you turn this on.', 'Enable GPS'],
    requesting:  ['badge badge-amber', 'REQUESTING',  'Waiting for permission and a first GPS fix…', 'Turn GPS off'],
    active:      ['badge badge-green', 'ACTIVE',      'Device GPS. Shown on your route map; not sent to the server.', 'Turn GPS off'],
    unavailable: ['badge badge-red',   'UNAVAILABLE', 'GPS unavailable.', 'Try again']
  }[g.status];
  badge.className = states[0]; badge.textContent = states[1]; hint.textContent = states[2]; btn.textContent = states[3];
  if (g.status === 'active') {
    out.innerHTML = `<div class="gps-grid">
      <div class="gps-cell"><div class="lab">Latitude</div><div class="val">${g.lat.toFixed(5)}</div></div>
      <div class="gps-cell"><div class="lab">Longitude</div><div class="val">${g.lng.toFixed(5)}</div></div>
      <div class="gps-cell"><div class="lab">Accuracy</div><div class="val">±${g.accuracy} m</div></div>
      <div class="gps-cell"><div class="lab">Last update</div><div class="val">${g.at.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div></div>
    </div>`;
  } else if (g.status === 'unavailable') {
    out.innerHTML = `<div class="route-card none"><div class="route-head"><div class="t">GPS UNAVAILABLE</div></div>
      <div class="why">Your location could not be obtained. ${esc(g.reason || '')}<br>Fare calculation and route selection remain available.</div></div>`;
  } else out.innerHTML = '';
}

/* ============================================================================
   CONTACTS / SHARE / REPORT
   ========================================================================== */
function contactHTML(c, del) {
  return `<div class="contact-chip">
    <div class="who"><div class="avatar">${esc(initials(c.name))}</div>
      <div><div class="name">${esc(c.name)}</div><div class="meta">${esc(c.relation)} · ${esc(c.phone)}</div></div></div>
    ${del ? `<button class="del-btn" data-del="${c.id}" aria-label="Remove">×</button>` : ''}
  </div>`;
}
function renderContacts() {
  $('home-contacts-list').innerHTML = S.contacts.length
    ? S.contacts.map(c => contactHTML(c, false)).join('')
    : '<div class="stepper-hint" style="margin-bottom:8px;">No contacts yet. Add one so safety alerts have somewhere to go.</div>';
  const modal = $('contacts-list');
  modal.innerHTML = S.contacts.length
    ? S.contacts.map(c => contactHTML(c, true)).join('')
    : '<div class="stepper-hint" style="margin-bottom:10px;">No contacts yet — add one below.</div>';
  modal.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    S.contacts = S.contacts.filter(c => String(c.id) !== b.dataset.del);
    saveContacts(); renderContacts(); renderSafetyInline(); toast('Contact removed.');
  });
  renderSafetyInline();
}
function openContacts() { renderContacts(); openModal('modal-contacts'); }
function addContact() {
  const name = $('contact-name').value.trim(), phone = $('contact-phone').value.trim();
  if (!name || !phone) return toast('Enter a name and a mobile number.');
  S.contacts.push({ id: Date.now(), name, relation: $('contact-relation').value, phone });
  saveContacts();
  $('contact-name').value = ''; $('contact-phone').value = '';
  renderContacts();
  toast(`${name} added.`);
}
function openShare() {
  if (!S.trip) return;
  $('share-link').textContent = `${window.PANAW_PUBLIC_ORIGIN || location.origin}/r/${S.trip.id}`;
  openModal('modal-share');
}
function copyLink() {
  const link = $('share-link').textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
  toast('Link copied.');
}
async function submitReport() {
  try {
    const r = await api('/api/reports', {
      body: { tripId: S.trip ? S.trip.id : null, type: $('report-type').value, details: $('report-details').value }
    });
    closeModal('modal-report');
    toast(`Report filed. Reference ${r.ref}`);
  } catch (e) { toast(e.message); }
}

/* ============================================================================
   QR — rendered with the vendored qrcode-generator library (MIT, K. Arase).
   Deliberately not hand-rolled: the code on the receipt has to survive being
   scanned by a stranger's phone, so it uses an implementation with a decade
   of field use rather than one written for this project.
   ========================================================================== */
function drawQR(canvas, text) {
  const q = qrcode(0, 'L');            // 0 = pick the smallest version that fits
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), scale = 5, quiet = 3;
  const px = (n + quiet * 2) * scale;
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#0B1F2A';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
    if (q.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
}

/* ============================================================================
   OFFLINE FALLBACK
   Only used when the server cannot be reached. It cannot lock a fare or issue
   a receipt — it only keeps the screens alive so a dead network does not end
   a defense. Everything it produces is labelled on screen.
   ========================================================================== */
const FALLBACK_RULES = {
  lgu: 'Buenavista, Guimaras',
  ordinance: 'Municipal Ordinance No. ____ (placeholder)',
  terminal: 'New Poblacion TODA Terminal, Buenavista, Guimaras',
  terminalCoords: { lat: 10.6974, lng: 122.6472 },
  baseFare: 15, baseKm: 2, perKmRate: 1,
  specialBaseFare: 25, specialPerKmRate: 2,
  fareStep: 0.25, discountRate: 0.2,
  nightSurchargeEnabled: false, nightSurchargeRate: 0.15,
  nightStart: 22, nightEnd: 4, simulateNight: false,
  deviationToleranceKm: 0.35, confirmWindowSeconds: 8,
  destinations: [
    { id:'d1', name:'Guimaras State University — Salvador Campus', km:0.6, lat:10.698781,  lng:122.6511688 },
    { id:'d2', name:'Buenavista New Terminal Market',              km:1.9, lat:10.6993323, lng:122.6605618 },
    { id:'d4', name:'MacArthur Wharf, Sto. Rosario',               km:4.6, lat:10.687903,  lng:122.6163195 },
    { id:'d7', name:'Roca Encantada',                              km:8.0, lat:10.7427229, lng:122.6793036 }
  ],
  pickupPoints: ['New Poblacion TODA Terminal'],
  drivers: [{ id:'BTODA-0142', name:'Rogelio "Bobong" Gaje', unit:'Honda TMX 155', rating:4.9, seats:4, eta:4 }],
  discountTypes: [
    { id:'none', label:'No discount', basis:'—' },
    { id:'student', label:'Student (school ID)', basis:'LGU ordinance' },
    { id:'senior', label:'Senior Citizen', basis:'RA 9994' },
    { id:'pwd', label:'Person with Disability', basis:'RA 10754' }
  ]
};
function localIsNight(r) {
  if (r.simulateNight) return true;
  const h = new Date().getHours();
  return h >= r.nightStart || h < r.nightEnd;
}
/**
 * Network for the offline fallback when nothing was cached: just the original
 * Buenavista terminal and its destinations, so the core fare flow still runs.
 */
function fallbackNetwork(rules) {
  const termNode = 'terminal_buenavista_poblacion';
  return {
    municipalities: [{ id: 'buenavista', name: 'Buenavista' }],
    defaultTerminalId: termNode,
    terminals: [{ id: termNode, name: rules.terminal.split(',')[0], municipality: 'buenavista', nodeId: termNode,
                  latitude: rules.terminalCoords.lat, longitude: rules.terminalCoords.lng, type: 'tricycle',
                  fareRuleId: 'trikefair_buenavista', dataStatus: 'existing',
                  destinationIds: rules.destinations.map(d => d.id), pickupPoints: rules.pickupPoints,
                  driverIds: rules.drivers.map(d => d.id) }],
    destinations: rules.destinations.map(d => ({ id: d.id, name: d.name, municipality: 'buenavista', nodeId: d.id })),
    nodes: [{ id: termNode, name: rules.terminal.split(',')[0], type: 'terminal', municipality: 'buenavista', ...rules.terminalCoords }]
      .concat(rules.destinations.map(d => ({ id: d.id, name: d.name, type: 'destination', municipality: 'buenavista', lat: d.lat, lng: d.lng }))),
    edges: rules.destinations.map(d => ({ id: 'e_' + d.id, from: termNode, to: d.id, distance_km: d.km,
                                         estimated_minutes: Math.round(d.km / 20 * 60), transport_modes: ['tricycle'], dataStatus: 'existing' })),
    fareRules: [{ id: 'trikefair_buenavista', label: 'PANAW provisional matrix', status: 'PROVISIONAL', source: 'rules.json' }],
    transportModes: [{ id: 'tricycle', label: 'Tricycle', status: 'active' }],
    demoVehicles: [],
    settings: { assumedSpeedKph: 20, costWeights: { distance: 1, time: 0 } }
  };
}
/** Mirrors src/fare.js. Kept in sync by hand; the server copy is authoritative. */
function localCompute(input) {
  const r = termRules();
  const step = r.fareStep, roundStep = v => Math.round(v / step) * step;
  const special = input.hireType === 'special';
  const base = special ? r.specialBaseFare : r.baseFare;
  const perKm = special ? r.specialPerKmRate : r.perKmRate;
  const extraKm = Math.max(0, input.distanceKm - r.baseKm);
  const distanceFare = extraKm * perKm;
  const singleBase = base + distanceFare;
  const nightApplies = localIsNight(r) && r.nightSurchargeEnabled;
  let grossPerPax, vehicleFare, nightSurcharge;
  if (special) {
    nightSurcharge = nightApplies ? singleBase * r.nightSurchargeRate : 0;
    vehicleFare = singleBase + nightSurcharge;
    grossPerPax = vehicleFare / input.passengers;
  } else {
    const nightEach = nightApplies ? singleBase * r.nightSurchargeRate : 0;
    grossPerPax = singleBase + nightEach;
    nightSurcharge = nightEach * input.passengers;
    vehicleFare = grossPerPax * input.passengers;
  }
  const undisc = roundStep(grossPerPax);
  const rate = input.discountType === 'none' ? 0 : r.discountRate;
  const paxBreakdown = []; let total = 0, discountTotal = 0;
  for (let i = 1; i <= input.passengers; i++) {
    const disc = i <= input.discountedPax && rate > 0;
    const amt = roundStep(disc ? grossPerPax * (1 - rate) : grossPerPax);
    if (disc) discountTotal += undisc - amt;
    total += amt;
    paxBreakdown.push({ index: i, amount: amt, discounted: disc });
  }
  return { ...input, baseFare: base, baseKm: r.baseKm, perKmRate: perKm,
    extraKm, distanceFare, singleBase, nightApplies, nightSurchargeRate: r.nightSurchargeRate, nightSurcharge,
    subtotal: vehicleFare, discountTotal, fareStep: step, perPax: undisc,
    paxBreakdown, total: Math.round(total * 100) / 100 };
}
