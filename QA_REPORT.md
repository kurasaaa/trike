# QA Report: PANAW redesign (UI/UX pass + vehicle-hire move)

Date: 2026-10-25 · Environment: Windows 11, Microsoft Edge 156 (headless, through Playwright 1.48), Node 24 · Build: `node design/build-redesign.js` → `design/panaw-redesign.html`

## A. Executive summary

- **Overall: PASS WITH LIMITATIONS.**
- **Build and launch:** the design builds. It loads with 0 console or page errors at 1280×900, 360×640, 390×844 and 430×932, in light and dark colour schemes.
- **Requested change, done:** jeepney and van hire moved from the Ride tab to **Explore → Group trips and tours**, with its own page. Place pages link to it ("Group trip? Hire a jeepney or van") and pass the destination into the operator message. The Ride tab is now tricycle-only.
- **UI/UX:**
  - Explore restructured: list rows instead of empty photo placeholders, tourist places first, barangays in their own section.
  - Tap targets enlarged: controls under 40 px went from 50 to 18. The remaining ones are 38 px chips and Leaflet's own attribution link.
  - Contrast raised to AA, visible keyboard focus added, the unnamed button labelled, copy fixed.
  - Details are in `UI_UX_AUDIT_REPORT.md`.
- **Defects:** 4 found, 4 fixed and verified.
  - BUG-001: the featured order was reversed.
  - BUG-002: the safety-prompt buttons were rebuilt every second, so taps could be lost. This was the most serious, because it's on the safety prompt.
  - BUG-003: the same rebuild problem on the driver's Accept/Decline buttons.
  - BUG-004: the ride options screen didn't update when trike availability changed.
- **Critical workflows:** all pass in the browser. Sign-up (all 3 roles), login and logout, booking a trike end to end with a driver, terminal ticket and boarding, safety alerts, Explore and hire, listing a place, account pages, operator listing management, guest mode, and reset.
- **Readiness:** ready for review of the design and for porting into the real app. It hasn't been tested on a physical phone or inside the APK. This file is the design demo; the shipped APK still contains the earlier app.

## B. Test execution summary

| Metric | Result | What it counts |
|---|---|---|
| Screens/states inventoried | 45 | Distinct rendered screens and states captured by `crawl.js` (laptop and phone width) |
| Interactive controls inventoried | 222 unique instances, 80 distinct kinds | An instance is one rendered control; a kind is one handler or field (e.g. all 61 place rows are one kind) |
| Control kinds tested | 80 of 80 | Each kind clicked or filled in Edge with an assertion on the result (`controls.test.js`, `supplement.test.js`) |
| Control instances not individually clicked | Repeated instances of a tested kind (e.g. 14 of the 16 filter chips, most of the 61 place rows); Leaflet's zoom and attribution controls (third-party) | Same handler, different data. Representative instances tested |
| Automated browser checks passed | 135 of 135 (125 + 10) | Assertions in the two suites |
| Bug regression tests passed | 3 of 3 scripts (BUG-001/002/003; BUG-004 is in the main suite), each run 3+ times | `bug00x.js` |
| Server/engine tests (`npm test`) | 50 passed, 0 failed | Fare golden cases, route engine, data validation, API |
| Automated tests failed | 0 | Final run on the shipped build |
| Defects confirmed | 4 | Reproduced with a failing test before the fix |
| Defects fixed and verified | 4 | Original test passes after the fix, plus full regression |
| Defects unresolved | 0 | none |

## C. Defect summary

### BUG-001: Featured places listed in reverse order
- **Severity:** Low. **Area:** Explore list and Ride search suggestions.
- **Steps:** open Explore, or tap "Where to?" with an empty query.
- **Expected:** Guisi Lighthouse, Trappist Abbey, Raymen Beach first (the `FEATURED` order).
- **Actual:** Tatlong Pulo, Balaan Bukid, Daliran Cave (the reverse).
- **Evidence:** `bug001.js` on the baseline printed `explore: [dest_tatlong_pulo, …] FAIL`.
- **Root cause:** the sort used `(b.rank+1) − (a.rank+1)`, which is descending.
- **Fix:** a shared `exploreRank` sorts ascending: owner listings, then featured in order, then other places, then barangays.
- **Files:** `design/redesign.src.html`.
- **Retest:** `bug001.js` PASS. **Regression:** full suite PASS.
- **Status:** fixed and verified.

### BUG-002: Safety prompt buttons rebuilt every second, so taps could be lost
- **Severity:** High. A passenger's "I'm safe" or "Alert now" tap can be lost on the safety prompt.
- **Steps:** during a trip, trigger a major detour. Keep a reference to the "I'm safe" button, wait 2 s, and compare.
- **Expected:** the same button stays while the countdown runs.
- **Actual:** it's replaced every second (`sameElementAfter2s: false`). The first full-suite run timed out clicking it.
- **Root cause:** `drawSafetyPrompt` rewrote the dialog's whole `innerHTML` on every refresh, and the ride-sheet refresh key included the countdown seconds.
- **Fix:**
  - When the dialog is already open for the same prompt, only the ring and number update.
  - The refresh key now uses the prompt's identity instead of its seconds.
  - The countdown is updated in place on every tick.
  - Added `role="alertdialog"`.
- **Files:** `design/redesign.src.html`.
- **Retest:** `bug002.js` PASS in 3 of 3 runs. **Regression:** the countdown still reaches 0 and auto-alerts (main suite safety checks PASS).
- **Status:** fixed and verified.

### BUG-003: Driver Accept/Decline buttons rebuilt every second
- **Severity:** Medium. A driver's Accept tap can be lost.
- **Steps:** a driver receives a request; compare the Accept button before and after 2 s.
- **Expected:** the same element.
- **Actual:** replaced every second.
- **Root cause:** `updateDrive`'s key included the countdown seconds, so the whole sheet redrew each second.
- **Fix:** removed the seconds from the key. The ring and number update in place.
- **Retest:** `bug003.js` PASS in 3 of 3 runs, and the countdown still moves (60 → 57 in 3 s).
- **Regression:** the full suite's driver checks PASS.
- **Status:** fixed and verified.

### BUG-004: Ride options don't update when trike availability changes
- **Severity:** Low. Booking still fails safely with "No trike available".
- **Steps:** open the options for a destination, then make every trike busy.
- **Expected:** "No trike online nearby" and Book disabled.
- **Actual:** the sheet kept "Nearest trike 10 min away" with Book enabled.
- **Root cause:** `updateRide` refreshed availability only on the home step.
- **Fix:** on the options step, the sheet redraws when availability flips between some and none. No redraw happens while a dialog is open, and an open fare breakdown stays open. The "Nearest trike N min" text updates in place.
- **Retest:** 3 new checks PASS: disables when all are busy, breakdown stays open, re-enables when a trike frees up.
- **Status:** fixed and verified.

### Investigated, not defects
- **No deviation prompt after a manual Emergency alert:** the 60 s quiet period in `sendAlert` is intentional, so contacts aren't messaged repeatedly. The test order was corrected instead.
- **Search for "Jordan town" finds nothing:** place names are shortened, so search matches "Jordan". This is test data, not a defect.
- **Edit-stop button missing for the active stop:** by design, the active stop is the input field.

## D. Files modified

| File | Why |
|---|---|
| `design/redesign.src.html` | Hire moved to Explore (`page_hire`, Explore entry, `data-hire*` actions, vehicle switch and `ride_hire` removed from Ride); Explore list restructure; BUG-001–004 fixes; tap-target, contrast and focus CSS; accessible names; copy fixes (fare-rule label, short names, stop icon, demo logins) |
| `design/panaw-redesign.html` | Rebuilt output |
| `design/qa/*` (new) | The browser tests and crawler used for this report, with a README |
| `UI_UX_AUDIT_REPORT.md` (new) | Audit, backlog and design direction |
| `QA_REPORT.md` (new) | This report |

**Unchanged on purpose:**
- `src/fare.js`, `src/network.js` and all `data/*.json` files in this pass. (The data diffs in `git status` come from the earlier TODA fare-card session.)
- These functions in the design are byte-identical to the baseline (checked by script): `quote`, `dispatch`, `createRide`, `boardRide`, `acceptRide`, `declineRide`, `arrivedRide`, `startRide`, `completeRide`, `cancelRide`, `sendAlert`, `watchRide`, `confirmSafe`, `availableTrikes`, `approach`, `offRouteKm`, `termRuleFor`, `alertText`, `shrink`, `signup`, `login`, `publish`, `book`, `fareModalAct`.
- **One behaviour change:** the operator contact message now names the place the passenger came from. Before, it named the current Ride destination. This follows from the requested move.

## E. Verification evidence (commands executed)

```
git status / git log                                    baseline recorded (uncommitted data work from prior session noted)
npm test (trikefair_final/trikefair)                    baseline 50/0; final 50/0
node design/build-redesign.js                           builds (final 402,914 bytes)
node crawl.js <baseline> baseline/shots                 45 screens, 221 unique controls, 0 errors
node bug001.js <baseline>                               FAIL (reproduced) -> after fix PASS
node bug002.js <build>                                  FAIL (reproduced) -> after fix PASS x3
node bug003.js <build>                                  FAIL (reproduced) -> after fix PASS x3
node controls.test.js <build>                           final: 125 passed, 0 failed, 0 console/page errors
node supplement.test.js <build>                         10 passed, 0 failed, 0 errors
node crawl.js <build> after/shots                       45 screens, 0 errors; targets <40px 50 -> 18, unnamed buttons 1 -> 0
dark-mode render (colorScheme: dark)                    Explore + Account rendered, 0 errors, inactive tab text rgb(131,153,160)
```

Screenshots were inspected for: Explore, the hire page, Ride home, Ride options, accepted ride, place detail, ticket, driver request, operator sign-up, account, and dark mode.

## F. Remaining risks and limitations

1. **Not tested on a phone or in the APK.** All results are from desktop Edge with phone-sized viewports. Real touch, the on-screen keyboard, and Android back-button behaviour weren't exercised.
2. **External effects stubbed:**
   - Call, Text and Messenger: `window.open` was intercepted, and the test checked the exact `tel:` / `sms:` URL. No real call or SMS was made.
   - GPS: Playwright supplied mock coordinates.
   - Copy: on a `file://` page the clipboard is unavailable. The app shows "Copy is not available here", and the test accepts that message.
3. **Map tiles need internet** (Esri). The offline schematic fallback wasn't re-tested in this pass.
4. **Demo-only storage:** accounts, rides and listings live in the browser tab (by design for the demo) and reset on reload. Persistence will only be meaningful once ported to the server.
5. **Remaining small targets:** filter chips are 38 px tall (a 2 px shortfall, accepted), and the Leaflet attribution link is third-party.
6. **Pre-existing, not addressed:** on the options screen the map sometimes frames only part of a long route line. Map-fitting is cosmetic and was left unchanged.
7. **The real app** (`trikefair_final/trikefair/public`) was not redesigned in this pass. Only its test suite was rerun.

## G. Final status

**PASS WITH LIMITATIONS.** Every required check within the defined scope passed: 135/135 browser checks, 3/3 bug regressions, 50/50 engine and API tests, and 0 console errors. No critical or high-severity defect remains open. The limitations are those in section F, chiefly that nothing ran on a physical device or inside the APK.

---

## Addendum: barangays for all five towns (same day)

**Change:** Explore → **Barangays** now lists the five towns with their counts. Tapping a town opens all its barangays, with road distance from that town's terminal. Each barangay opens a place page with a fare and "Ride here".

**Data:**
- **Source:** the official PSA list via PhilAtlas, 98 barangays in total: Buenavista 36, Jordan 14, Nueva Valencia 22, San Lorenzo 12, Sibunag 14.
- **Coordinates:** PhilAtlas ("situated at approximately"). Concordia Sur and Oracon Sur have none on PhilAtlas, so they use OpenStreetMap (Nominatim). Every record names its source.
- **Road distances:** OSRM, from each town's terminal.
- **Island barangays:** Guiwanon, Panobolon and Inampologan have no road within 1.5 km, so no route is configured. They show "No road route (island)", and the place page explains this instead of offering a fare.
- **Nueva Valencia Poblacion** is the town-centre point itself. Giving it its own node produced a 0 km road segment, which the data validator rejected, so it now points to the existing centre node.
- **Buenavista:** the 36 barangays already present (34 from the TODA card, plus Getulio and New Poblacion) were matched to their official names.

**Tests (final build):**

| Suite | Result |
|---|---|
| `brgy.test.js` (new) | 15/15 |
| `controls.test.js` | 125/125 |
| `supplement.test.js` | 10/10 |
| `bug001`–`bug003` | PASS |
| `npm test` | 50/50 |
| Console errors | 0 |

**Test changes:** two checks were corrected.
- The old "barangays in own section" check relied on row text from the previous layout. It now asserts one row per town.
- A `$$` written as `$` was a mistake in my edit script, not the app.

Data files changed: `data/routes.json`, `data/destinations.json`, `data/terminals.json`. Backups are in the session scratchpad.

---

## Addendum: picks 1–5 (online accounts, live tracking link, offline map, language, ratings)

**What changed**
- **Shared engine:** accounts, rides, safety watch, listings and ratings moved from the design page into `trikefair_final/trikefair/src/hub.js`. The browser runs it offline (LOCAL DEMO MODE). `server.js` runs the same file for every phone (CONNECTED), with endpoints `POST /api/hub/<action>` and `GET /api/hub/view`.
- **Server rules:**
  - Fares are recomputed on the server; a fare sent by the phone is ignored.
  - Passwords are stored as scrypt hashes.
  - Sessions use bearer tokens and expire after 30 days.
  - Login is limited to 10 wrong passwords per IP per 10 minutes.
  - The driver's copy of a ride carries no contacts and no alert events (silent alarm).
- **App on the server:** the app is served at `/`, and the old passenger page moved to `/classic`.
  - Offline APK (`PANAW.apk`): the hub runs on the phone and keeps its data in browser storage.
  - Online APK (`PANAW-online.apk`): the app talks to `https://panaw-api.onrender.com`.
- **Live tracking link:** `/t/<code>` with `GET /api/track/<code>`.
  - The code is random; the page shows the first name only and expires 2 hours after the trip.
  - It is labelled SIMULATED unless the driver's phone reports GPS. Online drivers send GPS every 5 s while online.
- **Emergency text:** still tap-to-send through the phone's Messages app. Wording now says "alert ready / prepared", never "sent". The text includes the tracking link when online.
- **Offline map:** `data/basemap.json` holds the Guimaras coastline and roads from OpenStreetMap (ODbL, fetched 2026-10-25), simplified to about 10 m, 282 KB. It is drawn below the online tiles.
- **Language:** English, Filipino and Hiligaynon for the main labels. These translations are a first draft and need a native speaker's check.
- **Ratings:** stars are saved on the trike. "Rated X of 5" shows on the driver card and on the driver's Earnings.
- **New validation:** two driver accounts cannot claim the same unit.

**Tests (all run, all passing)**

| Suite | Result |
|---|---|
| `controls.test.js` | 125/125 |
| `supplement.test.js` | 10/10 |
| `brgy.test.js` | 15/15 |
| `picks.test.js` (new: language, ratings, offline restart) | 13/13 |
| `offline-map.js` (new: map draws with the network cut) | PASS |
| `bug001`–`bug003` | PASS |
| `online.test.js` (new: two phones on a local server copy) | 26/26 |
| `npm test` | 52/52 (2 new hub API tests) |

- `bug002.js` now waits between taps, because actions resolve asynchronously.
- Accounts, earnings and ratings were checked to survive a server restart.

**Not verified**
- Not tested on a real Android phone.
- The online APK has not been run against Render. The deployed server still runs the old code until these changes are pushed.
- Real GPS on a moving tricycle has not been tested.
- The Filipino and Hiligaynon translations have not been reviewed by a native speaker.
- The driver's "Confirm now (demo only)" button is still self-service.

---

## Addendum: REDO.md customer-centred redesign

**Files changed (and why)**

| File | Why |
|---|---|
| `design/redesign.src.html` | All screen changes: Ride landing, pickup source and confirmation, Choose a place for pickup, the "Get a tricycle to this place" action, the Explore filter layout, empty states, welcome/login (Demo access, Show/Hide password, keeping the mobile number), placeholder, new CSS, new translation labels |
| `design/panaw-redesign.html`, `trikefair_final/trikefair/public/app.html` | Rebuilt by `design/build-redesign.js` |
| `design/qa/controls.test.js`, `supplement.test.js`, `brgy.test.js`, `picks.test.js`, `online.test.js`, `bug002.js`, `bug003.js`, `crawl.js` | Steps updated to the new flow (pick a destination, then Review fare; confirm the sample pickup before booking; Municipality is a selector; new headline). Every earlier check is still there; 5 checks were added. |
| `design/qa/redo.test.js` (new), `design/qa/shots.js` (new) | REDO.md acceptance checks at 390×844 and 320 px; screenshots for the audit |
| `UI_UX_AUDIT_REPORT.md` | Round 2 audit |

**Not changed:**
- `src/fare.js`, `src/network.js` and `src/hub.js`.
- `data/*.json` and `server.js`. Checked with `git diff 9e027ae` on these paths, which shows no differences.

**Tests run**

| Suite | Result |
|---|---|
| `redo.test.js` (new) | 28/28 |
| `controls.test.js` | 130/130 |
| `supplement.test.js` | 10/10 |
| `brgy.test.js` | 15/15 |
| `picks.test.js` | 13/13 |
| `offline-map.js` | PASS |
| `bug001`–`bug003` | PASS |
| `online.test.js` (two phones, server copy) | 26/26 |
| `npm test` | 52/52 |
| Console/page errors | 0 |

**`redo.test.js` covers:**
- Welcome actions and hidden demo logins.
- Show/Hide password, and a login error that keeps the mobile number.
- The Ride headings and the sample-pickup label.
- Review fare disabled, with the reason shown.
- No tourism filters on Ride, and DEMO trikes labelled.
- A direct ride without Explore, and choosing the pickup from a place.
- The fare equals the engine quote.
- Places shown before group trips, and the first place visible without scrolling.
- The Municipality selector, filters combining, and filters kept after visiting a place.
- Clear filters.
- Place to Ride keeps the destination and does not book.
- Emergency, Share trip and the safety watch on an active ride.
- No horizontal scroll at 320 px.

**Found and fixed during this pass**
- A wrong password cleared the typed mobile number. It now keeps the number, never the password.
- One straight apostrophe inside a single-quoted string broke the page. Caught by the first test run and fixed.

**Builds:** `PANAW.apk` (local mode) and `PANAW-online.apk` (Render) were rebuilt. Both contain the new Ride screen.

**Not verified**
- Real Android phone: keyboard, system bars and larger text sizes.
- Screen readers.
- The online APK against Render. This round has not been pushed, so Render still serves the previous screens.

---

## Addendum: REDO_RECHECKED.md section 15 and the real app (no demo accounts)

**Files changed**

| File | Why |
|---|---|
| `trikefair_final/trikefair/src/hub.js` | New `demo` option. When it's off, nothing sample is seeded, and restoring a demo database drops its sample accounts, operators, simulated trikes and their rides. `verify` and `detour` are refused. Added `pendingDrivers` and `approveDriver`. Fare and route code is untouched. |
| `trikefair_final/trikefair/server.js` | Real app unless `PANAW_DEMO=1`. Added admin endpoints to list and approve drivers. The start-up log shows the mode. |
| `trikefair_final/trikefair/public/monitor.html` | New "Drivers waiting for TODA approval" card. It asks for the admin key only when tapped. |
| `trikefair_final/trikefair/public/app.html` | Rebuilt from `design/redesign.src.html`. |
| `trikefair_final/trikefair/tests/run-tests.js` | The ride test signs up instead of using the demo login. New test: demo login refused, no simulated trikes or sample operators, no self-approval, admin approval, then the driver can go online. |
| `design/redesign.src.html` | Real app vs. preview mode. Covers the pickup with no default, place-page route and estimate wording (15.4), a source row that matches the badge (15.1), the photo fallback (15.2), barangay counts (15.3), the honest vehicle line (15.5) and pickup-search wording and order (15.6). Demo-only buttons are hidden. Fixed the crash in the nearby line's live update. |
| `design/build-redesign.js` | Only `design/panaw-redesign.html` gets `PANAW_DEMO`. |
| `design/qa/recheck.test.js` | New: 58 checks of section 15.8, run on the real app build. |
| `design/qa/online.test.js`, `redo.test.js`, `brgy.test.js` | Online test: real sign-ups plus TODA approval. The other two: new wording for the vehicle line and the island route. |
| `PANAW.apk`, `PANAW-online.apk` | Rebuilt from the real app. Neither contains `PANAW_DEMO`. |

**Results (run on 2026-10-25)**

| Suite | Build | Result |
|---|---|---|
| `recheck.test.js` (section 15.8 scenarios 1 to 12) | real app, `public/app.html` | 58/58, 0 page errors |
| `online.test.js` (two phones plus a tracking page) | copy of the server in real-app mode | 29/29 |
| Monitor approval (browser, admin key set) | copy of the server | PASS: no prompt on load, one when tapped, driver verified |
| `redo.test.js` | design preview | 29/29 |
| `controls.test.js` | design preview | 130/130 |
| `supplement.test.js` | design preview | 10/10 |
| `brgy.test.js` | design preview | 15/15 |
| `picks.test.js` | design preview | 13/13 |
| `bug001`, `bug002`, `bug003`, `offline-map` | design preview | PASS |
| `npm test` | server | 53/53 |
| Production restore of a demo database | Node script | PASS: only the real account and its rides are kept |

The first run caught 2 test failures that came from deliberate wording changes. The tests were updated, and they still check the same behaviour. It also caught a real crash in the vehicle line's live update, which is now fixed. The rerun is clean.

**Not verified**
- A real Android phone.
- Screen readers.
- The online APK against Render. This round is not pushed yet.
- The first start on Render will drop the saved demo accounts. That was checked only with a local copy, not on Render's database.
