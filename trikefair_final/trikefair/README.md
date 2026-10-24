# PANAW — Progressive Advanced Network for Automated Wayfinding

*Formerly TRIKEFAIR.*

A working prototype of a tricycle fare transparency and trip safety system.
The fare is computed by a server from an LGU ordinance, locked before the trip
starts, and issued afterwards as a signed receipt anyone can verify by scanning
a QR code.

Academic research prototype. Fare figures are demonstration data.

**Guimaras expansion.** The prototype now covers all five municipalities of
Guimaras (Buenavista, Jordan, Nueva Valencia, San Lorenzo, Sibunag) with
municipality → terminal → destination selection, a route-network graph,
shortest-path route optimization, GPS, and a transport monitor. The original
Buenavista fare system is unchanged. See **section 8**.

---

## 1. Running it

You need Node.js 18 or newer. Nothing else — **there are no npm packages to
install.** That is deliberate: the demo has to work on a laptop with no
internet, in a room with unreliable Wi-Fi.

```bash
cd trikefair
node server.js
```

You will see:

```
  PANAW server running
  ------------------------------------------
  Passenger app : http://localhost:3000
  Driver console: http://localhost:3000/driver
  On this network: http://192.168.1.10:3000   <-- open this on the phone
  ------------------------------------------
  Ordinance: Provisional matrix — pending Buenavista SB ordinance (Buenavista, Guimaras)
  Night window 21:00-04:00 · currently DAY
```

**For the two-device demo:** put the laptop and the phone on the same Wi-Fi or
the laptop's hotspot, then open the `On this network` address on the phone.
The phone is the passenger, the laptop browser is the driver console at
`/driver`.

If the phone cannot reach the laptop, it is almost always the laptop firewall.
On Windows, allow Node.js through Windows Defender Firewall on private
networks, or run `netsh advfirewall firewall add rule name="PANAW"
dir=in action=allow protocol=TCP localport=3000` in an admin prompt.
**Test this before the defense, not during it.**

To wipe the data between panels:

```bash
curl -X POST http://localhost:3000/api/admin/reset
```

or just delete `data/db.json` and restart.

---

## 2. What's in here

```
trikefair/
├── server.js              HTTP server and all API routes (no framework)
├── package.json           no dependencies
├── src/
│   ├── fare.js            THE FARE ENGINE — the only place money is computed
│   ├── trips.js           trip lifecycle, event classification, receipt signing
│   └── db.js              JSON-file datastore, atomic writes
├── data/
│   ├── rules.json         the ordinance: rates, destinations, drivers
│   └── db.json            created on first run; trips and reports
└── public/
    ├── index.html         passenger app (markup)
    ├── app.js             passenger app (logic)
    ├── driver.html        driver console — one file, self-contained
    ├── receipt.html       public receipt page, what a scanned QR opens
    ├── styles.css         shared design system
    └── vendor/qrcode.js   QR encoder (MIT, Kazuhiko Arase) — not hand-rolled
```

Roughly 2,000 lines total. Every file is commented where a decision was made
rather than a default taken.

---

## 3. How it works

### The one idea

Tricycle fares are set by ordinance but transacted verbally, and the gap
between those two things is where overcharging lives. This system closes the
gap by making the fare a **server-side fact** rather than a conversation.

Three properties enforce it:

**No client ever sends a peso amount.** The passenger app sends inputs —
destination, passenger count, hire type, discount claims. The server returns
the money. When you create a trip, the server *recomputes* the fare and ignores
anything money-shaped in the request body.

**There is no endpoint that changes a fare after locking.** Not restricted, not
permission-checked — absent. Look through `server.js`: there is no
`PATCH /api/trips/:id/fare`. That absence is the product.

**The night rate comes from the server clock.** `src/fare.js` reads the night
window from the server's own time. A phone with a wrong clock, or a driver who
wants a night rate at noon, changes nothing.

### Trip lifecycle

```
   quote          arithmetic only, never stored
     │
     ▼  POST /api/trips
   locked         fare frozen; the driver's screen now shows this number
     │
     ▼  POST /api/trips/:id/accept
   accepted       a driver is bound to the trip
     │
     ▼  POST /api/trips/:id/start
  in_progress     safety monitoring live; deviation pings classified server-side
     │
     ▼  POST /api/trips/:id/complete
   completed      immutable; HMAC signature computed; receipt is public
```

### Where the local data came from

The terminal is **New Poblacion (Calingao), Buenavista, Guimaras** at
10.69729 N, 122.64675 E.

All twelve destinations are real, mappable places in Buenavista. Their
coordinates came from Google Places lookups, and the distances in
`rules.json` are great-circle distances from the terminal multiplied by a
road factor of 1.2 to 1.35 depending on how much the circumferential road
bends on that leg.

| Destination | Barangay | km |
|---|---|---|
| Guimaras State University – Salvador Campus | Mclain | 0.6 |
| Mclain Barangay Hall | Mclain | 0.7 |
| Salvacion Barangay Hall | Salvacion | 1.1 |
| Buenavista New Terminal Market | Sto. Rosario | 1.8 |
| Buenavista Emergency Hospital | Sto. Rosario | 1.9 |
| Tastasan Barangay Hall | Tastasan | 1.9 |
| Supang Barangay Hall | Supang | 3.9 |
| MacArthur Wharf (Buenavista pier) | Sto. Rosario | 4.2 |
| Daliran Cave | San Miguel | 4.7 |
| Navalas Church | Navalas | 7.3 |
| Roca Encantada | Lawi | 8.0 |
| Lagdon Beach | Getulio | 8.2 |

**Verify these on the ground.** Walking or riding each route with a phone
odometer, and correcting `rules.json` from what you measure, is a couple of
afternoons of work and it turns "estimated distances" into "measured
distances" in your methodology. That is a cheap upgrade to the paper.

### The rates are provisional — fix this before the defense

`baseFare: 15`, `baseKm: 2`, `perKmRate: 2` are **placeholders**, and
`rules.json` says so on line one. The nearest documented comparable structure
is Iloilo City's published tricycle fare of ₱15 for the first 2 km plus ₱1 per
succeeding kilometre; Guimaras rates are set locally and were not published
anywhere I could verify.

Get the real numbers. Ask the Buenavista Sangguniang Bayan secretary or the
Municipal Treasurer's office for the current tricycle fare ordinance, or
photograph the fare matrix posted at the New Poblacion terminal. Then edit
`data/rules.json` — no code changes, the structure is data. Being able to say
"these are the rates under Ordinance No. ___" instead of "these are
representative rates" is worth more than any feature in this build.

The night window is set to 21:00–04:00 here rather than 22:00, because the
last Buenavista–Iloilo boat leaves in the evening and the ride home from the
wharf after dark is exactly the trip this system is meant to cover. Confirm
that against the ordinance too.

### The fare model

Terminal: **New Poblacion TODA Terminal, Buenavista, Guimaras.**

| | Regular hire | Special trip |
|---|---|---|
| What it is | the ordinary shared queue ride | passenger hires the whole unit |
| How it's charged | **each passenger pays a full fare** | **one vehicle fare, split by the group** |
| First 2 km | ₱15.00 per passenger | ₱25.00 for the unit |
| Succeeding km | ₱1.00 / km per passenger | ₱2.00 / km |

Each hire type has its own base and per-km rate, the way an ordinance states
them, rather than one rate multiplied by a fudge factor.

**These rates are not yet verified against the Buenavista Sangguniang Bayan
ordinance.** They follow the rate structure commonly published for tricycles in
the Iloilo–Guimaras area (₱15 for the first 2 km plus ₱1 per succeeding km, with
a higher whole-unit rate for special trips). Getting the actual SB ordinance and
replacing these four numbers in `data/rules.json` is the single highest-value
thing left to do — being able to say *"these are the enacted rates"* is worth
more to a panel than any feature in the build. Every rate is data, not code.

**Night surcharge defaults to OFF**, because no night surcharge is assumed to be
authorized in Buenavista. The app therefore adds ₱0 at 11 p.m. — which is worth
demonstrating, since it shows the system refusing to apply an unauthorized
charge. The Rules screen can switch it on to show the mechanism.

The distinction between hire types matters. An earlier version of this project
divided one fare among all passengers, which meant four riders paid ₱3.75 each
and the driver earned the same whether the sidecar was full or empty. No
ordinance works that way and no driver would adopt it. Regular hire is now
per-passenger; the split model survives only where it is actually true.

Destinations in the matrix, with road distance from the terminal:

| Destination | km | 1 pax | 3 pax |
|---|---|---|---|
| Guimaras State University — Salvador Campus | 0.6 | ₱15.00 | ₱45.00 |
| Buenavista New Terminal Market | 1.9 | ₱15.00 | ₱45.00 |
| Buenavista Emergency Hospital | 2.0 | ₱15.00 | ₱45.00 |
| MacArthur Wharf, Sto. Rosario | 4.6 | ₱17.50 | ₱52.50 |
| Daliran Cave | 4.6 | ₱17.50 | ₱52.50 |
| Brgy. Getulio | 6.7 | ₱19.75 | ₱59.25 |
| Roca Encantada | 8.0 | ₱21.00 | ₱63.00 |
| GSU Mosqueda Campus, Jordan | 13.6 | ₱26.50 | ₱79.50 |

Distances are straight-line measurements between surveyed coordinates multiplied
by a 1.3 road factor. Replace them with odometer readings before using the
system in the study — a wrong distance is a wrong fare, and it is the input a
driver will notice first.

Discounts (20%, RA 9994 for seniors, RA 10754 for PWDs, LGU rules for students)
come off **each qualified passenger's own fare**, not off the group total.

Every payable share rounds to ₱0.25, and the trip total is the exact sum of the
rounded shares — so the receipt total always equals the coins that change hands.
On a split special trip this can leave the total a quarter-peso above or below
the whole-unit rate; rounding is to nearest, so it averages out and never
exceeds ₱0.25 either way.

### Safety monitoring

The passenger app reports coordinates. The **server** decides what they mean,
by measuring the perpendicular distance from the terminal→destination corridor:

- within 0.35 km → `on_route`, logged, nothing shown
- 0.35–1.05 km → `minor`, banner only ("likely traffic rerouting")
- beyond 1.05 km → `major`, confirmation prompt with an 8-second countdown

If the passenger doesn't confirm, the emergency contacts are alerted with the
live location. **If the passenger does confirm, that is also recorded** — as
`safe_confirmed`. That is not decoration: false positives are a result the
study needs to count, and a system that only logs its alarms cannot report its
own false-positive rate.

### The receipt

On completion the server computes
`HMAC-SHA256(tripId | total | lockedAt)` and truncates it to 12 hex characters.
The QR encodes `http://<host>/r/<tripId>?s=<signature>`. Opening that link makes
the server re-derive the signature and compare. Edit one character of the URL
and the page says the signature does not match.

The QR is a real, scannable QR code — verified against an independent decoder,
not a decorative pattern.

---

## 4. API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/rules` | ordinance, destinations, drivers, server time, night status |
| POST | `/api/quote` | compute a fare; stores nothing |
| POST | `/api/trips` | create a **locked** trip (fare recomputed server-side) |
| GET | `/api/trips` | list; filters `?status= &device= &driver= &open=1` |
| GET | `/api/trips/:id` | one trip (both apps poll this every 2s) |
| POST | `/api/trips/:id/accept` | driver binds to the trip |
| POST | `/api/trips/:id/start` | departure |
| POST | `/api/trips/:id/events` | position ping / safe confirmation / alert |
| POST | `/api/trips/:id/complete` | close and sign |
| POST | `/api/trips/:id/cancel` | close without a receipt |
| GET | `/api/trips/:id/receipt?s=` | public signed receipt view |
| POST | `/api/reports` | file a fare dispute |
| POST | `/api/admin/rules` | demo toggles: night authorized, simulate night |
| POST | `/api/admin/reset` | wipe the database between panels |
| GET | `/api/health` | is it up |

Sync between the two devices is 2-second polling, not WebSockets. Polling is
four lines, cannot drop a connection, and no judge notices a two-second lag.

---

## 5. Demo script (about four minutes)

Set up first: laptop on `/driver`, phone on the LAN address, both visible.

1. **Phone.** Pick *Buenavista New Terminal Market*, 2 passengers, 1 student discount. Tap
   **Calculate fare**. Show the breakdown — base, distance, per-passenger
   charging, the discount taken off one share only, and each passenger's
   amount. Say: *this arithmetic ran on the server, not on this phone.*

2. **Phone.** Tap **Lock fare**. Point at the trip ID.

3. **Laptop.** The trip appears in the driver's queue **at the same peso
   amount**. Say the line that matters: *there is no field on this screen where
   the driver types a fare. The console can display the amount and nothing
   else.* Tap **Accept**, then **Depart terminal**.

4. **Phone.** The status changes on its own. Tap **Major deviation**. The
   server classifies the ping, the countdown appears. Let it run out once —
   the alert is logged with coordinates and the notified contact. Then trigger
   it again and tap **I'm safe** to show that the confirmation is logged too.

5. **Laptop.** End the trip. The phone jumps to the receipt.

6. **The moment.** Hand a judge their own phone and ask them to scan the QR.
   The signed receipt opens on *their* device with a green verification banner.
   Then edit one character of the signature in the URL and reload — the banner
   goes red.

Optional, if a judge asks about the night rate: open **Rules**, turn on
*Simulate night-time clock*, go back and recalculate — **nothing changes**,
because no night surcharge is authorized for Buenavista. Then switch on *Night
surcharge authorized* to show the mechanism working. Point out that neither
control exists on the passenger screen.

---

## 6. Known limitations

State these before a judge finds them.

- **Simulated GPS.** Position pings are generated by the app, not by a receiver.
  The corridor classification logic is real; the coordinates feeding it are not.
- **No authentication.** Anyone on the LAN can act as any driver. Real
  deployment needs OTP sign-in and driver registration tied to the TODA roster.
- **No SMS.** Emergency alerts are recorded in the trip log, not sent. A
  gateway (Semaphore, Twilio) is a line of code and a billing account, and adds
  a failure point to a demo.
- **Fixed distance table.** Distances come from `rules.json`, not live routing.
  This is a defensible choice for fixed short routes, but it is a choice.
- **Unverified rates.** The structure follows what is commonly published for
  tricycles in this area, but it has not been checked against the Buenavista SB
  ordinance. Say this before a panelist asks.
- **Estimated distances.** Straight-line coordinates × 1.3, not odometer
  readings or actual road routing.
- **JSON file, not a database.** Fine for tens of records; wrong past a few
  hundred concurrent trips.
- **No duress path.** A passenger forced to press "I'm safe" is undetectable.
- **Smartphone requirement.** The seniors and PWDs whose discounts this system
  protects are the least likely to carry one. Partial mitigation: the driver
  console shows the same locked fare, so a walk-up passenger can be shown the
  screen. Full coverage needs a terminal kiosk.

---

## 7. If something breaks

**Phone can't load the page.** Laptop firewall. See section 1.

**"Server unreachable" chip appears.** The passenger app fell back to local
computation so the screens keep working. It cannot lock a fare or issue a
receipt in this state — say so if it happens live, don't pretend.

**Night makes no difference to the fare.** Correct — night surcharge is off by
default because none is assumed to be authorized here. Switch on *Night
surcharge authorized* in `Rules` to demonstrate the mechanism.

**Port 3000 in use.** `PORT=4000 node server.js`.

---

## 8. Guimaras expansion

> PANAW is a Guimaras-focused local transportation prototype that combines
> transparent tricycle fare computation with municipality-based terminal
> selection, route-network management, basic route optimization, and
> GPS-enabled transportation monitoring.

It is a prototype that demonstrates the architecture and workflow. It is not a
production island-wide transport system, and it does not do real-time traffic
optimization or fleet management.

### Flow

```
Municipality → Terminal → Destination → Route engine → distance → fare engine (src/fare.js, unchanged) → trip record
```

The route engine only supplies a distance. `src/fare.js` is still the only
place where money is computed.

### New files

```
data/
├── municipalities.json   the five municipalities + PhilAtlas municipal-center coordinates
├── terminals.json        origin terminals: municipality, route node, fare rule, destinations served
├── destinations.json     d1–d8 (original, ids kept) + municipal centers + places still missing coordinates
├── routes.json           the graph: nodes (places) and edges (road segments), cost weights, speed assumption
├── fare_rules.json       which rate set each terminal uses
├── demo_vehicles.json    simulated vehicles for the monitor
└── transport_modes.json  tricycle (active); jeepney, multicab (future, no data)
src/network.js            validation, Dijkstra route search, terminal → fare-rule resolution
public/monitor.html       admin view: vehicles, map, segment availability, terminals, trip records
public/netmap.js          offline schematic map (inline SVG, no map tiles, no internet)
tests/run-tests.js        npm test — fare regression, route engine, data validation, API
```

`rules.json` is untouched. Its Buenavista destinations were copied into the new
files, and the validator raises an error if the two copies ever disagree on a
distance.

### Adding a terminal — no code changes

1. Add a node to `routes.json` (or reuse one) and connect it with edges.
2. Add the terminal to `terminals.json`, with its `municipality`, `nodeId`,
   `fareRuleId` and the `destinationIds` it serves.
3. Restart nothing: the server re-reads the data files when they change. Check
   the monitor's "Data check" for errors.

### Where the data came from

| Data | Source | Status |
|---|---|---|
| New Poblacion terminal, d1–d8, their distances, all rates | the original project (`rules.json`) | existing project data, provisional |
| Municipality names and centre coordinates | PhilAtlas municipal-center points | reference data |
| Inter-municipal segments and every new segment (`dataStatus: "osm"`) | road distance from OSRM over OpenStreetMap (router.project-osrm.org), retrieved 2026-10-24 | public map data, verify on the ground |
| 14 places in all five municipalities (Jordan Wharf, Provincial Capitol, Trappist Abbey, Guisi Lighthouse, Wind Farm, Sebaste Port...) | OpenStreetMap coordinates via Nominatim; each node's `source` names its OSM id | public map data |
| Travel times | distance ÷ an assumed 20 km/h | **DEMO assumption** |
| Terminals outside New Poblacion | named for demonstration, routed from the municipal center | **DEMO terminal, coordinates required** |
| Fares at those terminals | the same rate structure, labelled **DEMO / SAMPLE RATE** | no ordinance on file |
| Place listings | posted by owners from the app | shown as **Listed by owner, not verified**; never used for routes or fares |

No official fare, road, coordinate or travel time has been invented. Anything
not from the original project, PhilAtlas or OpenStreetMap is labelled DEMO in
the data and on screen.

### Route optimization

Dijkstra's shortest path over the segments that are currently available.
Segment cost = `distance × distanceWeight + minutes × timeWeight`, with the
weights set in `routes.json` (distance-only by default). On the monitor,
switching a segment off makes every quote take the next-best path, or answer
NO ROUTE AVAILABLE. No live traffic data is used, and the app says so on screen.

### GPS, and what "centralized" means here

| Where | What it does |
|---|---|
| Passenger app → Location (GPS) | device GPS, shown on the route map. Off until turned on, explained first, **never sent to the server**. |
| Driver console → Location sharing | device GPS (or a clearly labelled **SIMULATED** position) sent to `/api/vehicles/:id/location` every 5 s |
| Monitor | last known position per vehicle, kept separate from **DEMO VEHICLES** |

- **Node server (`node server.js`)** reports **CONNECTED CENTRALIZED MODE**:
  every phone and laptop on it shares one database, so a driver's phone really
  does feed the monitor on the laptop.
- **Android APK on its own** reports **LOCAL DEMO MODE**: the embedded backend
  lives on the phone, so positions never leave the device. A real centralized
  deployment needs a hosted server. The API is already split so one could be
  added without touching the pages.
- Browsers only allow GPS on secure pages. The APK and `http://localhost`
  qualify, but a phone opening `http://192.168.x.x:3000` does not. It shows
  GPS UNAVAILABLE and the driver console offers Simulate (DEMO) instead.

### New API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/network` | municipalities, terminals, destinations, graph, fare rules, validation report, backend mode |
| POST | `/api/quote`, `/api/trips` | now take `terminalId` (default: New Poblacion, so old requests give the old fare); 422 = NO ROUTE AVAILABLE |
| GET | `/api/trip-records` | structured trip records (municipality, terminal, destination, distance, time, fare, mode, timestamp) |
| GET | `/api/vehicles` | last known vehicle positions |
| POST | `/api/vehicles/:id/location` | report a position (`lat`, `lng`, `accuracy`, `source: device|simulated`) |
| POST | `/api/vehicles/:id/offline` | stop sharing |
| POST | `/api/admin/network` | `{ edgeId, available }` — open or close a route segment |

### Passenger app (panel recommendations)

`/` is the passenger app (`public/index.html` + `passenger.js`). The earlier
booking flow with locked fares and signed receipts is unchanged at
`/booking.html`, linked from More.

| Tab | What it does |
|---|---|
| Explore | places by category and municipality, list or map, plus owner listings with photos |
| Trip | municipality, terminal, up to 4 stops, best stop order, alternate routes, fare breakdown and fare basis |
| Pick-up | ranks online trikes (drivers sharing location + DEMO vehicles) by ETA to your pin, with alternate pick-up routes |
| More | list your place, your listings, fare policy, associations, tourism offices, offline, comparison with Google Maps / Waze |

- **Map**: Leaflet 1.9.4 (bundled in `public/vendor/leaflet`) with OpenStreetMap
  tiles. Tiles need internet; offline, the app draws the stored-network
  schematic instead and the fare check keeps working.
- **Listings**: `GET/POST /api/places`, `POST /api/places/:id/delete` (owner key
  held only by the posting phone), `POST /api/admin/places/:id/remove` (monitor).
  Validation in `src/places.js`: name, category, a Guimaras municipality, a pin
  inside Guimaras, up to 3 JPEG/PNG/WebP photos of at most 250 000 characters
  each (the app resizes them first). In the APK, listings are stored on the
  phone only (LOCAL DEMO MODE) and localStorage holds a few MB.
- **Pick-up requests** go to the chosen driver's console (accept, decline,
  "I have arrived"); the passenger app shows each answer. Requests nobody answers
  expire after 2 minutes. Requests to DEMO trikes are only simulated. Logic in
  `src/pickups.js`; API: `POST /api/pickups`, `GET /api/pickups/:id`,
  `GET /api/pickups?driver=ID` (driver PIN), `POST /api/pickups/:id/accept|decline|arrived`
  (driver PIN) and `/cancel` (the passenger's phone).

### Going online (Render + Neon, like ProFarms)

| Piece | What it is |
|---|---|
| Server | this folder on Render's free plan (`render.yaml` at the repository root) |
| Database | Neon PostgreSQL, used when `DATABASE_URL` is set; without it the server keeps using `data/db.json` |
| Driver PINs | `DRIVER_PINS=BTODA-0142:4821,...` on Render; the driver console asks for the PIN |
| Admin key | `ADMIN_KEY` on Render; the monitor asks for it before closing roads, removing listings or resetting |
| Online APK | `npm run apk:online` in the project root, using the address in `packaging/environments.json`; writes `PANAW-online.apk` |

Steps:
1. Put the TRIKE folder in a GitHub repository (`.gitignore` keeps APKs, builds and `db.json` out).
2. Neon: create a free project in Singapore and copy its connection string.
3. Render: New → Blueprint → the repository. Paste `DATABASE_URL` and `DRIVER_PINS` when asked.
   `ADMIN_KEY` is generated; read it in the service's Environment tab.
4. Open `https://<service>.onrender.com/api/health`: it should say `"storage":"postgres"`.
5. If the address is not `https://panaw-api.onrender.com`, change `packaging/environments.json`,
   then build the online APK with `npm run apk:online`.

Free plan: the server sleeps after 15 minutes without visitors, and the first request after that
takes about a minute. The fare check still works during that minute from the data stored on the
phone.

### Tests

```bash
npm test
```

Results: 2,944 golden fare cases, captured from the original engine before the
expansion, still produce identical outputs with and without a `terminalId`. The
route-engine cases (direct, intermediate, cross-municipality, no route, invalid
destination, disconnected graph, closures), the data-validation cases and the
API lifecycle all pass.
