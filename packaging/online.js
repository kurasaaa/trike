/* ============================================================================
   PANAW — Android packaging: online build
   ----------------------------------------------------------------------------
   The pages call /api/... exactly as they do on the laptop server. In the
   online APK those calls go to the hosted PANAW server instead, so every
   phone shares one database (CONNECTED CENTRALIZED MODE). The address is set
   by scripts/build-www.js --online (see packaging/environments.json).

   Packaging layer only — not part of the web app. Loaded before app scripts.
   ========================================================================== */
(function () {
  'use strict';
  const base = String(window.PANAW_API || '').replace(/\/+$/, '');
  // receipt links and QR codes must name the public server, not the phone's https://localhost
  window.PANAW_PUBLIC_ORIGIN = base;
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    return realFetch(base + url.pathname + url.search, init);
  };
})();
