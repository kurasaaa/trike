# UI/UX Audit Report: PANAW

This file holds three audit rounds:
- **Round 3** (REDO_RECHECKED.md section 15, and turning the app into the real product with no demo accounts) comes first.
- **Round 2** (REDO.md, customer-centred redesign) follows.
- **Round 1** (the earlier QA and UI pass) is at the end, unchanged.

---

# Round 3: Recheck findings and the real app (REDO_RECHECKED.md section 15)

The owner asked for the real app, not a demo build: no demo accounts.

## Two builds now

| Build | Where it runs | Sample accounts, operators, simulated trikes | Demo-only buttons |
|---|---|---|---|
| **Real app** | Render (`/`), `PANAW.apk`, `PANAW-online.apk` | None. Only people who sign up exist. | Hidden |
| **Design preview** | `design/panaw-redesign.html` on a laptop | Yes, labelled DEMO | Shown |

**How it works:**
- `src/hub.js` takes a `demo` option.
  - When it's off, nothing sample is seeded.
  - A database saved by the demo comes back with its sample accounts, sample operators and simulated trikes removed, along with the rides that belonged to them. Real sign-ups and their history stay.
- **Server:** `server.js` runs the real app unless `PANAW_DEMO=1` is set.
- **Preview:** `design/build-redesign.js` sets `PANAW_DEMO` in the preview only.

**Drivers:**
- In the real app a driver can't approve themselves (the old "Confirm now (demo only)" button). The hub refuses the request too.
- The TODA approves the driver on the monitor page (`/monitor`, "Drivers waiting for TODA approval").
- This needs the server's admin key (`ADMIN_KEY`, already set on Render). The endpoints are `GET /api/admin/app-drivers` and `POST /api/admin/app-drivers/:id/approve`.

**Pickup:**
- The real app starts with no pickup ("Not chosen yet"). No pin is drawn and no vehicle count is shown until the passenger uses GPS, chooses a place, or taps the map.
- The preview keeps its labelled sample point and the "Use the sample point" button.

## Section 15 findings: what was found and what changed

| # | Finding (checked against the source and in the running app) | Change |
|---|---|---|
| 15.1 | Place page said "Info from [town] Tourism Office", which no data supports. The badges said OpenStreetMap, PhilAtlas or project data. | The row now reads **Place information**, with the same source as the badge: OpenStreetMap (location), PhilAtlas (location), PANAW project data, or "The owner (not verified)". The Tourism offices list in Account still says "To verify". |
| 15.2 | A photo link that failed to load showed a broken image, in the grid and on the place page. | One document-level `error` listener swaps a failed photo for the category icon and "Photo could not load". It removes the `<img>`, so it can't fail again and can't loop. The place-page arrows still work, so a second photo still loads after the first fails. |
| 15.3 | With all towns, barangays show as one row per town, but the count said "N places". | The summary describes what is on screen, e.g. "25 places · 98 barangays by municipality (5 towns)" (owner listings add to the 25). When rows are listed one by one (a town or a search is chosen), it gives that count, e.g. "12 barangays" for San Lorenzo. |
| 15.4 | The place page judged the route from the sample pickup and could say "No tricycle route here". | Before a pickup is chosen, it shows "Choose your pickup point on the Ride screen to check the route and fare". After one is chosen, it shows "No tricycle route from your pickup point (X)", or an estimate that names its basis: the stop PANAW knows nearest to the pickup, not door to door. The 3 island barangays with no road from their own town always show "No road route to this place in PANAW", because that is true from every pickup. The route and fare code is unchanged. |
| 15.5 | "N trikes online (DEMO)": the qualifier was easy to miss. | The real app has no simulated trikes, so it shows only real drivers who are online. If none are online it says so and offers a fare ticket. In the preview, the count reads "DEMO · N simulated trikes for testing, not real vehicles". There is no count before a pickup is chosen. |
| 15.6 | The pickup search said "Search a landmark near you" but searched every place. | It now reads "Search a place or landmark", with "Searches every place in PANAW, not only those near you. Check the town under each name." While you are choosing a pickup, results are listed by name with their town and no distances (a distance from a pickup you haven't chosen means nothing). No distance limit was added. |
| 15.7 | Hiding the demo panel is not security. | The real app has no demo accounts at all. The server refuses `09171234567` / `demo1234` (tested), and Render's saved demo accounts are removed on the next start. The panel exists only in the preview. |

**Also fixed (found while testing):**
- The live update of the "trikes near this pickup" line crashed: its pattern no longer matched the new markup. It also used to paste the common stops a second time.
- The line is now drawn by one function, `nearbyLine`, and the live update replaces only that line.

**Smaller copy changes:**
- When location fails: "Location unavailable. Tap the map or choose a place for your pickup."
- A driver waiting for approval reads that the screen updates by itself once approved.

## Logic preservation

These are unchanged:
- `src/fare.js`, `src/network.js`, `data/*.json` and `rules.json`.
- The fare and route calls and the booking rules.

A test checks that the terminal fare shown equals the fare engine's total.

`src/hub.js` changed only in what it **seeds and restores**, plus driver approval:
- the `demo` option;
- `verify` and `detour` are refused when demo is off;
- `pendingDrivers` and `approveDriver` were added.

The owner asked for this change directly ("make this as a final product app").

## Not implemented / still open

- **Offline APK (`PANAW.apk`):** it has no server, so there are no drivers and nobody to approve them. Fares, routes, Explore, fare tickets and the offline map work. Booking a trike honestly shows that none is online. Real rides need `PANAW-online.apk`.
- **Old pages:** the classic page (`/classic`) and the monitor's simulated "DEMO VEHICLE" list are older admin and reference screens, and still show demo data. Both are labelled DEMO.
- **Route data:** routes and non-Buenavista fares are still the project's demonstration data, labelled as such. That doesn't change by removing demo accounts.
- **Phone checks:** large text and screen-reader checks on a real phone are not done.

---

# Round 2: Customer-centred redesign (REDO.md)

## Where the app really lives (Phase A)

**Source:** `design/redesign.src.html` holds the screens. `trikefair_final/trikefair/src/hub.js` holds accounts, rides and safety. `src/fare.js` and `src/network.js` hold fares and routes, and `data/*.json` holds the data.

**Build:** `node design/build-redesign.js` writes two files from that source:
- `design/panaw-redesign.html`, the laptop demo.
- `trikefair_final/trikefair/public/app.html`, which the server serves at `/`.

**APK:** `scripts/build-www.js` copies `public/` into `www/` and makes `app.html` the APK's `index.html`.
- The offline build sets `PANAW_LOCAL`.
- The online build sets `PANAW_API`.

**Legacy, not edited:** `public/index.html`, `passenger.js`, `app.js`, `booking.html`, `driver.html` and `monitor.html` are the older pages. The APK keeps the old passenger page as `classic.html`; it is not the start page. `www/` and the APK contents are build output and were never edited by hand.

**Presentation vs. logic:**
- Presentation lives in the `Pp.*` render functions and the CSS in `redesign.src.html`.
- Business logic (fares, routes, ride steps, safety watch, validation) lives in `hub.js`, `fare.js` and `network.js`. None of these were changed in this round.

**Baseline:** screenshots at 390×844 (welcome, login, Ride, Explore, place, place to Ride). Every existing suite passed before any edit.

## Findings (before)

| # | Screen | Customer problem | Priority |
|---|---|---|---|
| F1 | Ride | Opens on a demo coordinate labelled "Near Buenavista New Terminal Market". A customer reads it as "the app thinks I am here". Nothing says it is a sample. | P1 |
| F2 | Ride | The landing offers "Where to?" plus "Popular in Guimaras", a row of tourist attractions. Ride reads as a tourism browser, not a transport tool. | P1 |
| F3 | Place detail | "Ride here · ₱990.00" is priced from the demo pickup, so it implies a pickup the customer never chose. One tap jumped straight into fare options. | P1 |
| F4 | Explore | Group-trip hire cards sit above the places. Two stacked chip rows (categories, towns) fill most of the first screen. | P1 |
| F5 | Explore | The town filter says "All towns" in a second chip row. There is no summary of active filters and no "clear" action; the empty state is a dead end. | P2 |
| F6 | Welcome / Login | Demo phone numbers and the shared password are printed in body text on both screens. | P2 |
| F7 | Login | A wrong password clears the typed mobile number. There is no show/hide password control. | P2 |
| F8 | Ride | "N trikes online near you" does not say the trikes are DEMO vehicles. | P2 |
| F9 | Ride | No way to choose the pickup from a known landmark. Only GPS or a map tap. | P3 |
| F10 | Place detail | A place with no photo shows a large grey block with a small icon, which looks unfinished. | P3 |

## Implemented (Phase B)

| Step | Change | Fixes |
|---|---|---|
| 1. Explore and Ride separated | Place pages say **"Get a tricycle to this place"**. It opens the Ride screen with the destination filled in and a toast asking for the pickup. It never jumps to fare options, never books, and is refused while a ride is in progress. Ride's suggestions are now **Recent and common stops** (market, hospital, port, town centres), not tourist attractions. | F2, F3 |
| 2. Explore | Order: header, then search, then filters, then results, then **"Going as a group?"** (jeepney/van hire), then "List your place". One scrollable **category** row with a check mark on the selected chip, and one **Municipality** selector (All Guimaras plus the five towns). A results line ("12 places · Heritage · Jordan") has **Clear filters**. The empty state explains and offers Clear filters. Filters change in place, so scroll position and search focus survive, and they persist when you open a place and come back. Barangays stay grouped by town. | F4, F5 |
| 3. Place detail | When no pickup is confirmed, the fare preview is replaced by "You choose your pickup point and see the fare on the Ride screen before booking". With a confirmed pickup it shows the estimate and names that pickup. A place without a photo gets a compact teal placeholder instead of a large grey block. | F3, F10 |
| 4. Ride | New landing: "Where do you need a ride?", then a **Pickup point** box, then **Where are you going?**, then **Review fare**. Details below. | F1, F8, F9 |
| 5. Welcome / login / signup | Benefit headline; Create account (primary), Log in, Explore as guest. Demo logins moved into a closed **"Demo access (for testing)"** section; a build can hide it with `window.PANAW_HIDE_DEMO`. Show/Hide password on login and signup (`aria-pressed`). Errors appear in a red box next to the form (`role="alert"`). A wrong password keeps the mobile number but never the password. | F6, F7 |
| 6. Visual tokens | Same navy/teal system. New pieces use the existing tokens: `.pickup-box`, `.dest-box`, `.filters`, `.muni-pick`, `.filter-line`, `.form-error`, `.demo-access`, and the `.banner.info` teal-50 variant. No gradients or shadows were added. | — |
| 7. States | "Why disabled" text under Review fare. Demo-pickup banners on Ride and on fare options. Empty Explore state with a way out. DEMO count on nearby trikes. New labels added to the Filipino and Hiligaynon lists. | F5, F8 |

**Ride landing (step 4) in detail:**
- **Pickup point box:** shows the label and a source tag:
  - "Sample point for the demo, not your location" (amber)
  - "From your phone's GPS"
  - "Pinned by you on the map"
  - "Place you chose"
  - "Sample point, confirmed by you"
- **Pickup controls:** Use GPS, **Choose a place** (new: pick a known landmark as the pickup), or tap the map.
- **Sample-point notice:** while the sample point is in use, a notice says PANAW has not used your location, with **Use the sample point** as an explicit confirmation.
- **Review fare:** disabled until a destination is chosen and the pickup is confirmed or changed. The reason is shown under the button.
- **Fare options:** show the pickup, with Change.
- **Booking:** "Book trike" and "Get fare ticket" stay disabled while the pickup is an unconfirmed sample.
- **Nearby trikes:** "6 trikes online near this pickup … (all DEMO)".

## Logic preservation

These are unchanged, byte for byte:
- `src/fare.js`, `src/network.js`, `src/hub.js` and `data/*.json`.
- The fare, quote and booking functions.
- Server endpoints and validation.

The "pickup must be confirmed" rule is presentation only. It disables the existing Book button until the customer acts; the request and its data are unchanged.

GPS is still requested only when the customer taps Use GPS.

Safety features are unchanged and re-tested:
- Emergency button, Share trip and the live tracking link.
- The 8-second safety check.
- Tap-to-send alert text, issue reports and emergency contacts.
- The silent alarm on the driver's side.

## Recommendations not implemented

| # | Recommendation | Why not now |
|---|---|---|
| R1 | Real photos for featured places | No licensed photos; the tourism offices are the planned source. |
| R2 | A TODA/admin screen to approve drivers, replacing "Confirm now (demo only)" | Changes account behaviour; needs your approval. |
| R3 | Native-speaker review of the Filipino and Hiligaynon labels | Needs a person. |
| R4 | Real-phone test: keyboard over forms, system bars, larger text settings | Only a headless browser was available here. |
| R5 | Hide demo access in a "release" build by default | Kept visible (collapsed) because the panel evaluates with demo accounts; `PANAW_HIDE_DEMO` is ready when wanted. |

Test evidence is in `QA_REPORT.md` (Addendum: REDO.md redesign).

---

# Round 1 (earlier pass)


**Scope:** the PANAW passenger / driver / operator app as designed in `design/redesign.src.html`, which builds into `design/panaw-redesign.html`. The design runs the real fare engine (`src/fare.js`), route engine (`src/network.js`) and data files (`data/*.json`) in the browser.
**Not in scope:** the older pages in `trikefair_final/trikefair/public/`. Their behaviour is covered only by the regression suite (`npm test`).
**Method:**
- Rendered in Microsoft Edge 156 through Playwright, at 1280×900 (passenger and driver phones side by side) and 390×844 (single phone).
- 45 screens and states captured.
- 221 unique interactive controls inventoried automatically: size, label, and data attributes.
- Baseline screenshots are in the session scratchpad (`qa/baseline/shots`).
- The baseline had **0 console errors**.

---

## A. Overall assessment

The redesign already does several things well:
- **Navigation is right:** three tabs with a fixed bottom bar that's always visible.
- **The core flow is Grab-like:** a map, a "Where to?" box, a fare-first options sheet, and a tracked ride.
- **The design is restrained:** a flat navy/teal palette with no decoration.
- **The safety features are integrated**, and fare transparency (breakdown, source tag, TODA card price) is visible where decisions are made.

Its main weaknesses:
1. **Information architecture:** jeepney/van hire sits on the Ride tab as a three-way switch. Ride is a tricycle trip-booking flow, while chartering a whole vehicle for a group is a planning activity. The switch also adds a control to every ride the passenger starts. The product owner asked for it to move to Explore.
2. **Explore scanning:** 61 places render as two-column cards with large empty grey placeholders. Hardly any place has a photo, so about 60% of the screen is empty. The 34 barangay entries in "All" bury the tourist spots, which are the screen's purpose.
3. **Touch targets:** 50 of 221 controls are under 40 px in one dimension. The worst are text-only actions 16 px tall: "Use GPS", "Change", "Edit", "Just explore as a guest". The guidance for phones is about 44 px.
4. **Contrast:** `--faint` (#8A9BA0) on white is about 2.9:1, below WCAG AA (4.5:1). It's used for inactive tab labels, progress-step labels and some icons.
5. **Keyboard focus:** only form fields show a focus style. Buttons, chips, cards and list rows give no visible focus.
6. **Copy and labels:**
   - The driver screen says "Fare computed by PANAW from the **toda fare card** rule": the status was lower-cased.
   - Quick picks truncate names ("Guisi Lighthouse, Br…").
   - "Ride from a terminal" uses a computer-monitor icon.
   - The disabled call button has no accessible name.

There are no blocking (P0) usability defects. Every primary task can be completed.

---

## B. Screen-by-screen review

| Screen | Strengths | Problems | Recommended change | Benefit |
|---|---|---|---|---|
| Welcome / role / sign-up / login | Clear headline, one primary action, role cards explain each role | Guest link is a 16 px tall target; demo-account hint doesn't mention the operator login on the welcome page | Make the guest link a full-height tertiary button; list all three demo logins | Easier tap; complete demo info |
| Ride: home | Map plus a single "Where to?" box; pickup and nearby-trike status | Vehicle switch (Tricycle/Jeepney/Van) adds noise to every trip; "Use GPS" target 16 px; quick-pick names truncated | Remove the switch (hire moves to Explore); larger GPS target; short names in quick picks | Focused trip flow; fewer mis-taps |
| Ride: search | Clear route fields, distances, suggestions | Back button 36 px | 40 px icon buttons | Easier tap |
| Ride: options | Two clear choices with prices, fare breakdown on demand | "Change" link 16 px; terminal option uses a monitor icon | Larger "Change" target; flag/stop icon for terminals | Easier tap; clearer meaning |
| Ride: requested / accepted / arrived / on trip / done | Strong ETA hierarchy, progress steps, driver card, safety block, Emergency button | Progress labels in failing-contrast grey; "Edit" (contacts) 16 px; call button has no accessible name; star buttons 34 px | Darker muted grey; larger targets; `aria-label` on the call button | Readability, accessibility |
| Ride: fare ticket / boarding | Ticket is visually distinct; boarding explains why it matters | None blocking | none | — |
| Explore | Search, category and town filters | Grid of empty placeholders; barangays mixed into the featured view; no access to group hire | Restructure: **Group trips** entry (jeepney / van hire) at the top, photo cards only for places with photos, compact rows for the rest; barangays listed after tourist places | Much faster scanning; requested move of vehicle hire |
| Place detail | Clear title, source tag, primary "Ride here", TODA card price, map | Title repeated in header and body | Keep (the header title helps when scrolled); no change | — |
| Jeepney / van hire (new location) | Operator card shows seats, home town, rate, availability, contact | Lived on the Ride tab | Own page reached from Explore and from place pages; same cards and contact actions | Correct information architecture |
| Account and its pages | Grouped list rows, clear sections, safety visible | `×` remove-contact button 36 px | 40 px | Easier tap |
| Driver: drive / request / trip | Big status, 60 s countdown ring, fare locked, directions link | "toda fare card" wording; "Go offline" 36 px tall | Use the fare rule's label; 40 px secondary buttons | Correct copy; easier tap |
| Driver: earnings / account / vehicle | Simple totals and lists | none | none | — |
| Operator: My vehicle | Live preview of the passenger card, availability switch, edit | "Pause" 36 px | 40 px | Easier tap |
| Modals (fare options, share, report, safety prompt) | Bottom sheets with clear titles and actions | Steppers 36 px; segmented buttons 34 px | 40 px | Easier tap |

---

## C. Prioritized improvement backlog

| ID | Priority | Problem | Change | Why it matters |
|---|---|---|---|---|
| UX-1 | P1 | Vehicle hire is in the wrong place and clutters every trip | Move jeepney/van hire to Explore ("Group trips and tours") with its own page; place pages link to it; Ride tab becomes tricycle-only | Requested by the product owner; matches how people plan group outings |
| UX-2 | P1 | Explore is mostly empty placeholders; tourist spots buried | Photo cards only for places with photos; other places as compact rows (icon, name, town, category); barangays after tourist places in "All" | Scanning speed; the screen's job is discovering tourist places |
| UX-3 | P2 | 50 controls under 40 px; text actions 16 px tall | Minimum 40–44 px for text actions, icon buttons, chips, segmented controls, steppers, stars | Phone usability; fewer mis-taps (WCAG 2.5.8) |
| UX-4 | P2 | `--faint` text fails contrast | Darken to about 4.6:1 in light mode (dark mode checked separately) | Readability of tab labels and progress steps |
| UX-5 | P2 | No visible focus on buttons and links | Shared `:focus-visible` outline | Keyboard and switch-access users |
| UX-6 | P2 | Icon-only call button has no accessible name | `aria-label` stating it's unavailable in the demo | Screen readers |
| UX-7 | P3 | "toda fare card" lowercase wording on the driver screen | Use the fare rule's display label | Correct, professional copy |
| UX-8 | P3 | Quick-pick names truncated ("Guisi Lighthouse, Br…") | Show the short place name (before the first comma) | Readability |
| UX-9 | P3 | Terminal option uses a computer-monitor icon | Use a stop/flag icon | Clearer meaning |

Not proposed: photo galleries for the 61 places (no licensed photos exist; the tourism offices are the planned source), and changes to fares, routes or validation (out of scope).

---

## D. Proposed design direction

- **Style:** keep the current flat, map-first style. No gradients, glows or decorative motion, per the owner's standing preference.
- **Palette:** keep the brand navy `#0A3543` and teal `#0E7C86`. Muted text `#5B6F76` (about 5.3:1). Faint text darkens from `#8A9BA0` to `#6B7F85` (about 4.6:1). Status colours always paired with words: DEMO, Available, To verify, and so on.
- **Typography:** Inter. 22–28 px bold for screen titles, 15–17 px for card titles, 13–14 px body, 12 px hints. Numbers that matter (fare, ETA) at 22–32 px bold.
- **Spacing:** 4 px base; 12 px within cards; 16 px screen padding.
- **Controls:**
  - Primary is a solid teal 48 px button. Secondary is outlined. Destructive is red text on an outline.
  - Text actions get a 40 px minimum hit area.
  - Icon buttons are 40 px.
  - Chips are 36 px.
- **Cards, panels, dialogs:** 12 px radius, 1 px border, no shadow except the map bottom sheet. Dialogs are bottom sheets with the primary action on the right.
- **Navigation:** three fixed tabs per role. Secondary pages slide over the tab content with a back button, and the tab bar stays visible.
- **Responsive:**
  - Phone width: one full-screen app.
  - Laptop width: the side-by-side demo.
  - Content never relies on hover.
- **Accessibility:**
  - Visible focus ring.
  - Labelled controls.
  - 40–44 px targets.
  - AA contrast for text.
  - A dark theme that follows the system setting.

---

## E. Logic-preservation assessment

**Must stay functionally unchanged:**
- `src/fare.js`
- `src/network.js`
- `data/*.json`, including the TODA fare rule and its rates
- The demo server functions in `redesign.src.html`: `quote`, `dispatch`, `createRide`, `acceptRide`, `startRide`, `completeRide`, `boardRide`, safety watch / `sendAlert`, `availableTrikes`, `approach`
- Every validation rule: sign-up, contacts, unit number, listing, operator fields

**UI changes expected:**
- Explore rendering and a new Group trips page.
- `ride_home` without the vehicle switch.
- CSS tokens and sizes.
- Icon and label text.

**Risk points:**
1. **Removing the vehicle switch:** `R.vehicle` and `ride_hire` must not leave a dead path. The `data-hire-group` action on place pages must now open the Explore hire page, not the Ride tab.
2. **The operator contact message:** it uses the ride's destination. On the new page the destination comes from the place the passenger came from. The message stays the same otherwise.
3. **Explore restructure:** must keep search, category and town filters, owner listings, and the "List your place" call to action.

Implementation results and test evidence are in `QA_REPORT.md`.

---

## F. Implementation status (after this pass)

| ID | Status | Verified by |
|---|---|---|
| UX-1 Vehicle hire moved to Explore | Done: Explore → Group trips and tours → Hire a jeepney / van page with a Jeepney/Van switch; place pages open it with the destination; Ride tab tricycle-only | `controls.test.js` Hire checks (8), screenshot `L-passenger-hire-van` |
| UX-2 Explore restructure | Done: rows for places without photos, photo cards for listings with photos, featured first, Barangays section | Explore checks (7), screenshot |
| UX-3 Touch targets | Done: under 40 px went from 50 to 18 (38 px chips and Leaflet's attribution link remain) | Inventory re-crawl |
| UX-4 Contrast | Done: `--faint` #8A9BA0 → #6B7F85 (light), #71878D → #8399A0 (dark) | Computed style check in dark mode |
| UX-5 Focus | Done: shared `:focus-visible` ring | Code + render |
| UX-6 Accessible names | Done: call button, search field, chip rows (`aria-pressed`), safety dialog `role="alertdialog"` | A11y check; unnamed buttons 1 → 0 |
| UX-7 Driver fare-rule wording | Done: "from the New Poblacion TODA fare card" | Driver check |
| UX-8 Short names in quick picks | Done | Ride check |
| UX-9 Stop icon for terminals | Done | Ride check |

Not done: place photos (none licensed yet), and redesigning the older pages in `public/` (out of scope).
