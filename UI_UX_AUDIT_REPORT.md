# UI/UX Audit Report: PANAW redesign

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
