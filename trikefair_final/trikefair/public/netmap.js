/* ============================================================================
   PANAW — schematic network map
   ----------------------------------------------------------------------------
   Draws the route network from the stored coordinates as an inline SVG.
   Deliberately not a tile map: it needs no internet, so it keeps working
   offline and inside the APK. It is a schematic — straight lines between the
   stored points, not road geometry — and says so under the map.
   Municipal boundaries are not drawn: there is no verified boundary data.
   ========================================================================== */
(function () {
  'use strict';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /**
   * @param {object} net   network from /api/network
   * @param {object} opt   { route, originNodeId, destNodeId, gps:{lat,lng}, vehicles:[{latitude,longitude,label,demo}],
   *                         labels:'all'|'terminals', height }
   * @returns {string} SVG markup
   */
  function render(net, opt = {}) {
    const nodes = net.nodes || [];
    if (!nodes.length) return '';
    const W = 300, pad = 16;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    const extend = (lat, lng) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    };
    nodes.forEach(n => extend(n.lat, n.lng));
    // A GPS fix far from Guimaras would squash the island to a dot; only
    // widen the frame for it when it is nearby.
    if (opt.gps && Math.abs(opt.gps.lat - 10.6) < 0.5 && Math.abs(opt.gps.lng - 122.6) < 0.5) extend(opt.gps.lat, opt.gps.lng);

    const kx = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);   // keep the shape true
    const spanX = Math.max(1e-6, (maxLng - minLng) * kx), spanY = Math.max(1e-6, maxLat - minLat);
    const scale = (W - pad * 2) / spanX;
    const H = Math.round(Math.min(opt.height || 340, spanY * scale + pad * 2));
    const sc = Math.min(scale, (H - pad * 2) / spanY);
    const offX = (W - spanX * sc) / 2, offY = (H - spanY * sc) / 2;
    const px = (lat, lng) => ({ x: offX + (lng - minLng) * kx * sc, y: offY + (maxLat - lat) * sc });
    const at = id => nodes.find(n => n.id === id);

    const routeIds = new Set((opt.route && opt.route.segments || []).map(s => s.id));
    let s = `<svg class="netmap-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Schematic route network map">`;

    // segments
    for (const e of net.edges || []) {
      const a = at(e.from), b = at(e.to);
      if (!a || !b) continue;
      const p = px(a.lat, a.lng), q = px(b.lat, b.lng);
      const cls = e.available === false ? 'nm-edge off' : routeIds.has(e.id) ? 'nm-edge on' : e.dataStatus === 'demo' ? 'nm-edge demo' : 'nm-edge';
      s += `<line class="${cls}" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}"><title>${esc(e.id)} · ${e.distance_km} km${e.available === false ? ' · unavailable' : ''}</title></line>`;
    }
    // places
    const termNodes = new Set((net.terminals || []).map(t => t.nodeId));
    for (const n of nodes) {
      const p = px(n.lat, n.lng);
      const isOrigin = n.id === opt.originNodeId, isDest = n.id === opt.destNodeId;
      const kind = isOrigin ? 'origin' : isDest ? 'dest' : termNodes.has(n.id) ? 'terminal' : n.type === 'municipality_center' ? 'center' : 'place';
      const r = kind === 'place' ? 2.6 : 4;
      s += kind === 'terminal' || kind === 'origin'
        ? `<rect class="nm-node ${kind}" x="${(p.x - r).toFixed(1)}" y="${(p.y - r).toFixed(1)}" width="${r * 2}" height="${r * 2}" rx="1.5"><title>${esc(n.name)}</title></rect>`
        : `<circle class="nm-node ${kind}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}"><title>${esc(n.name)}</title></circle>`;
      const showLabel = isOrigin || isDest || (opt.labels === 'all' ? kind !== 'place' : kind === 'center' || kind === 'terminal');
      if (showLabel) {
        const right = p.x < W * 0.62;
        s += `<text class="nm-label ${isOrigin || isDest ? 'strong' : ''}" x="${(p.x + (right ? 6 : -6)).toFixed(1)}" y="${(p.y + 3).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${esc(shortName(n.name))}</text>`;
      }
    }
    // vehicles
    for (const v of opt.vehicles || []) {
      if (!Number.isFinite(v.latitude) || !Number.isFinite(v.longitude)) continue;
      const p = px(v.latitude, v.longitude);
      s += `<circle class="nm-vehicle ${v.demo ? 'demo' : ''}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.6"><title>${esc(v.label || v.vehicleId)}${v.demo ? ' (DEMO VEHICLE)' : ''}</title></circle>`;
    }
    // device position
    if (opt.gps && Number.isFinite(opt.gps.lat)) {
      const p = px(opt.gps.lat, opt.gps.lng);
      if (p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H) {
        s += `<circle class="nm-gps-halo" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="8"/><circle class="nm-gps" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.8"><title>Your device location</title></circle>`;
      }
    }
    return s + '</svg>';
  }

  function shortName(name) {
    return String(name).replace(' town proper', '').replace(' TODA Terminal', ' Terminal').replace(/ —.*$/, '').replace(/, .*$/, '');
  }

  const LEGEND = `<div class="netmap-legend">
      <span><i class="lg-line"></i>Stored segment</span>
      <span><i class="lg-line demo"></i>Demo segment</span>
      <span><i class="lg-line on"></i>Suggested route</span>
      <span><i class="lg-line off"></i>Unavailable</span>
    </div>
    <div class="netmap-note">Schematic: straight lines between stored points, not road geometry. Municipal boundaries are not shown (no verified boundary data).</div>`;

  window.TrikeMap = { render, LEGEND };
})();
