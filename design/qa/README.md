# PANAW redesign: QA tests

Browser tests for `design/panaw-redesign.html`. They drive the installed Microsoft Edge through Playwright.

```bash
cd design/qa
npm install --no-save playwright-core@1.48.2      # once; uses your installed Edge, downloads no browser
node ../build-redesign.js
node controls.test.js ../panaw-redesign.html      # 125 end-to-end control checks
node supplement.test.js ../panaw-redesign.html    # 10 more (quick picks, edit stop, Alert now, saved fields)
node bug001.js ../panaw-redesign.html             # featured order
node bug002.js ../panaw-redesign.html             # safety prompt buttons stay put
node bug003.js ../panaw-redesign.html             # driver Accept button stays put
node brgy.test.js ../panaw-redesign.html          # barangays of all five towns (15 checks)
node crawl.js ../panaw-redesign.html shots        # screenshots + control inventory of 45 screens
```

The tests write `qa-photo.png` and `qa-not-image.txt` next to themselves for the upload checks.
See `QA_REPORT.md` at the project root for the last results.

New in the picks pass:
- `picks.test.js <html>`: language switch, ratings, and offline data kept after a restart.
- `offline-map.js <html> [shot.png]`: the map draws Guimaras with the network cut.
- `online.test.js http://localhost:3456`: two phones on one server. Start a **copy** of the server first, because it writes `data/db.json`.
- `recheck.test.js ../../trikefair_final/trikefair/public/app.html`: REDO_RECHECKED.md section 15.8 on the **real app** build (no demo accounts): filter results, barangay counts, image fallbacks, route wording, pickup sources, place to Ride, TODA approval.
- `panaw-redesign.html` is the demo preview (sample accounts, simulated trikes); `public/app.html` and the APKs are the real app.
- `redo.test.js <html>`: REDO.md acceptance checks at phone size (Ride and Explore separation, pickup confirmation, filters, place to Ride).
- `shots.js <html> <outdir>`: screenshots of the main passenger screens.
