# CLAUDE.md

# TRIKEFAIR — GUIMARAS TRANSPORT INTEGRATION EXPANSION

## 1. PROJECT OBJECTIVE

TRIKEFAIR is an existing functional web-based tricycle fare calculator and transparency prototype.

The original prototype focuses on:

* Tricycle fare calculation
* Fare transparency
* Passenger/fare splitting
* Destination selection
* Night/late-hour fare rules
* Trip/booking-related controls
* A fixed set of destinations from the New Poblacion TODA Terminal in Buenavista, Guimaras

The project is now being expanded into a **Guimaras-wide local transportation prototype**.

The expanded system should cover the five municipalities of Guimaras:

1. Buenavista
2. Jordan
3. Nueva Valencia
4. San Lorenzo
5. Sibunag

The Province of Guimaras officially consists of these five municipalities.

The system must allow the user to select the municipality and terminal from which the trip begins.

The goal is NOT to turn this into a commercial transportation platform.

The goal is to create a functional prototype demonstrating:

* Localized electronic fare computation
* Terminal-to-destination route selection
* Multi-municipality transportation coverage
* Route-network representation
* Basic route optimization
* Centralized GPS/location data tracking
* Transportation terminal management
* Fare transparency
* Expandable local public-transport data architecture

---

# 2. CRITICAL RULE

## PRESERVE THE EXISTING TRIKEFAIR FUNCTIONALITY

The existing application is already functional.

Do NOT unnecessarily rewrite or destroy the existing implementation.

Preserve:

* Existing UI design language
* Existing colors
* Existing fonts
* Existing fare calculation logic
* Existing fare rules
* Existing night/late-hour rules
* Existing fare splitting
* Existing validation
* Existing destination selection behavior where applicable
* Existing reset functionality
* Existing local-storage behavior
* Existing booking-related controls
* Existing responsive behavior

However, unlike the previous APK-only version of this CLAUDE.md, this project is now explicitly authorized to ADD the transportation-network functionality described below.

The new functionality must be integrated into the existing application rather than replacing it with an unrelated application.

---

# 3. CORE EXPANSION

The application must evolve from:

```text
ONE TERMINAL
     ↓
FIXED DESTINATIONS
     ↓
FARE CALCULATOR
```

into:

```text
GUIMARAS
     ↓
SELECT MUNICIPALITY
     ↓
SELECT TERMINAL
     ↓
SELECT DESTINATION
     ↓
IDENTIFY ROUTE
     ↓
CALCULATE FARE
     ↓
SHOW ROUTE / DISTANCE
     ↓
OPTIONAL GPS TRACKING
     ↓
TRIP RECORD
```

The application must support all five municipalities.

---

# 4. MUNICIPALITY SELECTION

Add a municipality selector.

The available municipalities must be:

```text
Buenavista
Jordan
Nueva Valencia
San Lorenzo
Sibunag
```

Example:

```text
SELECT MUNICIPALITY

[ Buenavista ▼ ]
```

When the municipality changes, the available terminals must update accordingly.

Do NOT display every terminal from every municipality at the same time.

Use a hierarchical selection:

```text
Municipality
     ↓
Terminal
     ↓
Destination
```

Example:

```text
Municipality:
[ Buenavista ▼ ]

Terminal:
[ New Poblacion TODA Terminal ▼ ]

Destination:
[ Select destination ▼ ]
```

Another example:

```text
Municipality:
[ Jordan ▼ ]

Terminal:
[ Jordan Poblacion Terminal ▼ ]

Destination:
[ Select destination ▼ ]
```

The terminal list must be data-driven.

---

# 5. TERMINAL DATA ARCHITECTURE

Do NOT hardcode terminal logic directly throughout JavaScript.

Create a centralized data structure.

For example:

```javascript
const transportData = {
    municipalities: [
        {
            id: "buenavista",
            name: "Buenavista",
            terminals: []
        },
        {
            id: "jordan",
            name: "Jordan",
            terminals: []
        },
        {
            id: "nueva_valencia",
            name: "Nueva Valencia",
            terminals: []
        },
        {
            id: "san_lorenzo",
            name: "San Lorenzo",
            terminals: []
        },
        {
            id: "sibunag",
            name: "Sibunag",
            terminals: []
        }
    ]
};
```

The actual terminal records should contain:

```text
terminal ID
terminal name
municipality
latitude
longitude
terminal type
available routes
fare rules
```

---

# 6. EXISTING BUENAVISTA TERMINAL

The existing:

```text
New Poblacion TODA Terminal
Buenavista, Guimaras
```

must remain functional.

Do NOT remove its existing destinations or fare rules.

Move its existing data into the new municipality/terminal data structure while preserving its current behavior.

The existing Buenavista terminal becomes one terminal within the larger Guimaras transportation database.

---

# 7. FIVE-MUNICIPALITY COVERAGE

The system must contain a data structure capable of representing:

```text
GUIMARAS
│
├── BUENAVISTA
│   └── Terminals
│       ├── destinations
│       └── routes
│
├── JORDAN
│   └── Terminals
│       ├── destinations
│       └── routes
│
├── NUEVA VALENCIA
│   └── Terminals
│       ├── destinations
│       └── routes
│
├── SAN LORENZO
│   └── Terminals
│       ├── destinations
│       └── routes
│
└── SIBUNAG
    └── Terminals
        ├── destinations
        └── routes
```

The architecture must allow additional terminals to be added later without rewriting application logic.

---

# 8. DO NOT INVENT OFFICIAL FARES

This is extremely important.

Do NOT invent actual government-approved fares.

Do NOT present fabricated fares as official Guimaras fares.

The application may use:

* Existing TRIKEFAIR fare rules
* User-provided prototype values
* Clearly labelled demonstration/sample values
* Configurable fare tables

If data is unavailable, use:

```text
DEMO / SAMPLE RATE
```

rather than falsely presenting the value as an official fare.

All fare values must be stored in configuration/data files rather than scattered throughout the JavaScript.

---

# 9. ROUTE NETWORK

The previous application uses a fixed table of distances.

The expanded application must introduce a basic route network.

Instead of:

```text
Terminal → Destination
```

support:

```text
Terminal
   ↓
Road/Route Segment
   ↓
Intermediate Location
   ↓
Road/Route Segment
   ↓
Destination
```

Represent the transportation network as a graph.

Example:

```javascript
const routeNetwork = {
    nodes: [],
    edges: []
};
```

Each node may represent:

* Terminal
* Municipality center
* Barangay/poblacion
* Major route point
* Destination

Each edge should contain:

```text
from
to
distance
estimated travel time
route type
availability
```

---

# 10. ROUTE OPTIMIZATION

Implement basic route optimization.

The purpose is to demonstrate how a transportation system could identify an efficient route between a selected terminal and destination.

The algorithm should work on the route graph.

For example:

```text
Terminal A
   │
   ├── Route 1 — 4.2 km
   │
   └── Route 2 — 6.8 km
```

If Route 1 is valid and available, the system can identify it as the shorter route.

For the prototype, use a standard shortest-path algorithm such as:

```text
Dijkstra's algorithm
```

or another appropriate graph shortest-path algorithm.

Do NOT claim that this is real-time traffic optimization.

The system is optimizing against the route data currently available to it.

Display this distinction clearly.

---

# 11. ROUTE RESULT

After selecting a destination, display:

```text
ROUTE FOUND

Origin:
New Poblacion TODA Terminal

Destination:
Example Destination

Distance:
XX.X km

Estimated Travel Time:
XX min

Route:
Terminal
↓
Route Point A
↓
Route Point B
↓
Destination

Estimated Fare:
₱XXX
```

The interface should clearly separate:

```text
ROUTE INFORMATION
```

from:

```text
FARE INFORMATION
```

---

# 12. INTER-MUNICIPALITY ROUTES

The route network must support routes crossing municipality boundaries.

For example:

```text
Buenavista
   ↓
Jordan
   ↓
Nueva Valencia
```

The system must not assume that a trip always stays within one municipality.

The selected terminal determines the origin.

The destination determines the endpoint.

The route engine determines whether an available route exists.

If a route crosses municipalities, display the municipality transitions.

Example:

```text
Buenavista
   ↓
Jordan
   ↓
Nueva Valencia
   ↓
Destination
```

---

# 13. COOPERATIVE / PUBLIC TRANSPORT ARCHITECTURE

The current working implementation is focused on tricycles.

Do NOT force jeepneys, multicabs, or other vehicles into the fare calculator unless corresponding data exists.

However, design the data architecture so additional transport modes can be supported.

Example:

```javascript
transportModes = [
    "tricycle",
    "jeepney",
    "multicab"
];
```

Initially:

```text
TRICYCLE
```

should be the active operational mode.

Other modes may exist as:

```text
Future / expandable transport modes
```

Do not fabricate route or fare data for them.

---

# 14. TERMINAL TOGGLE / LOCATION SELECTION

The application must allow the user to change the starting terminal.

Example UI:

```text
ORIGIN

Municipality
[ Buenavista ▼ ]

Terminal
[ New Poblacion TODA Terminal ▼ ]
```

If the user changes:

```text
Buenavista
```

to:

```text
Jordan
```

the terminal list must update.

If the user changes:

```text
Jordan
```

to:

```text
Sibunag
```

the destination/route options must update accordingly.

Do not reload the webpage unnecessarily.

Update the interface dynamically.

---

# 15. GPS FUNCTIONALITY

Add a GPS component to the expanded system.

There are two distinct concepts:

## A. DEVICE GPS

The user's Android device may provide its current location.

Use the browser/Capacitor geolocation capability where appropriate.

Possible displayed information:

```text
Current Location

Latitude:
10.xxxxx

Longitude:
122.xxxxx

GPS Status:
Connected
```

Do not continuously request location permission unless necessary.

Request location access only when the user activates the GPS/tracking function.

---

# 16. CENTRALIZED GPS DATA TRACKING

The expanded architecture must support centralized location data.

Conceptually:

```text
TRICYCLE / DRIVER DEVICE
        │
        │ GPS
        ↓
TRIKEFAIR SYSTEM
        │
        ↓
CENTRAL LOCATION DATA
        │
        ↓
ADMIN / MONITORING DASHBOARD
```

However, DO NOT pretend that local browser storage is a centralized GPS server.

A true centralized tracking system requires a backend/database.

Therefore the implementation must distinguish between:

```text
LOCAL DEMO MODE
```

and:

```text
CONNECTED CENTRALIZED MODE
```

---

# 17. GPS DEMO MODE

If no backend credentials/server are available, implement a safe prototype mode.

Example:

```text
GPS TRACKING

Status:
DEMO MODE

Location:
Simulated / device location

Last Update:
HH:MM:SS
```

The application must not falsely claim:

```text
CENTRAL SERVER CONNECTED
```

when no server exists.

---

# 18. CENTRALIZED MODE ARCHITECTURE

If the project already contains or is configured with a backend, integrate with it.

If no backend exists, Claude may propose/configure a lightweight backend architecture, but do not make the entire application dependent on an external service without clearly documenting the dependency.

Possible architecture:

```text
Android Tricycle Device
        ↓
GPS
        ↓
HTTPS / Realtime API
        ↓
Central Database
        ↓
Admin Dashboard
```

The backend should store only the data actually required.

Possible record:

```javascript
{
    vehicleId,
    municipality,
    terminalId,
    latitude,
    longitude,
    timestamp,
    status
}
```

---

# 19. PRIVACY AND GPS SAFETY

Do not collect unnecessary personal information.

Do not collect:

* Contacts
* SMS
* Microphone
* Camera
* Personal messages

unless explicitly required by another feature.

GPS tracking should be clearly labelled.

The UI must communicate when tracking is:

```text
OFF
```

```text
ACTIVE
```

or:

```text
DEMO
```

Do not silently track the user's location.

---

# 20. CENTRAL MONITORING DASHBOARD

Add a monitoring view suitable for demonstrating centralized transportation tracking.

The dashboard may display:

```text
GUIMARAS TRANSPORT MONITOR

Active Vehicles: XX

Buenavista: XX
Jordan: XX
Nueva Valencia: XX
San Lorenzo: XX
Sibunag: XX
```

and a map/list representation of active vehicles.

Each vehicle may display:

```text
Vehicle ID
Municipality
Terminal
Status
Latitude
Longitude
Last Update
```

Example:

```text
TRIKE-001
Buenavista
New Poblacion Terminal
ACTIVE
Updated 12 sec ago
```

Use demo vehicles if no real vehicles are connected.

Clearly label them as:

```text
DEMO VEHICLE
```

---

# 21. MAP

If a map is introduced, it must be useful rather than decorative.

The map should be capable of displaying:

* Terminals
* Route lines
* Selected origin
* Selected destination
* Current GPS position
* Demo vehicle positions
* Municipality boundaries where reliable data is available

Do not fabricate geographic coordinates.

If exact coordinates are unavailable, mark the location as:

```text
Coordinates required
```

rather than inventing a precise coordinate.

---

# 22. MAP TECHNOLOGY

For a web application, a lightweight map library such as Leaflet may be used if appropriate.

If using external map tiles:

```text
Inspect whether internet connectivity is required.
```

Do not claim the map works completely offline if it depends on online map tiles.

The core fare calculation must remain functional even if the map is unavailable.

---

# 23. OFFLINE-FIRST FARE CALCULATOR

The existing fare calculator should remain usable without an internet connection whenever possible.

The architecture should be:

```text
CORE FARE SYSTEM
        ↓
OFFLINE
```

while:

```text
GPS / CENTRAL TRACKING / LIVE MAP
        ↓
OPTIONAL CONNECTED FEATURES
```

This distinction is important.

If the internet disappears:

```text
Fare calculation → Continue working
Stored route data → Continue working
Basic destination selection → Continue working

Central GPS synchronization → Pause
Online map tiles → May become unavailable
```

---

# 24. DATA FILES

Do not hardcode all municipalities, terminals, destinations, routes, and fares inside UI JavaScript.

Prefer separate structured files.

For example:

```text
data/
├── municipalities.json
├── terminals.json
├── destinations.json
├── routes.json
├── fare_rules.json
└── demo_vehicles.json
```

The exact structure may differ depending on the existing project.

Do not break the current application while reorganizing the data.

---

# 25. EXAMPLE DATA STRUCTURE

Example:

```json
{
    "id": "terminal_buenavista_poblacion",
    "name": "New Poblacion TODA Terminal",
    "municipality": "buenavista",
    "type": "tricycle"
}
```

Route example:

```json
{
    "id": "route_001",
    "from": "terminal_buenavista_poblacion",
    "to": "destination_001",
    "distance_km": 4.2,
    "estimated_minutes": 12,
    "transport_mode": "tricycle"
}
```

These are STRUCTURAL EXAMPLES ONLY.

Do not treat example numbers as official data.

---

# 26. DATA VALIDATION

Before using route data:

Check:

* Missing terminal IDs
* Missing destination IDs
* Duplicate IDs
* Invalid municipality IDs
* Negative distances
* Invalid coordinates
* Routes pointing to nonexistent nodes
* Missing fare rules
* Duplicate route records

The application should fail gracefully if data is incomplete.

---

# 27. EXISTING FARE LOGIC

Do not replace the existing fare calculator with route optimization.

Instead:

```text
Route Engine
     ↓
Distance / Route Information
     ↓
Existing Fare Engine
     ↓
Fare Result
```

The existing fare engine remains the authority for existing fare calculations.

If the expanded system needs a new distance-based fare rule, implement it as a configurable rule rather than deleting the original implementation.

---

# 28. FARE TRANSPARENCY

The application must show users how the fare was produced.

For example:

```text
FARE BREAKDOWN

Base Fare:       ₱XX
Distance Factor: ₱XX
Passengers:      X
Night Adjustment: ₱XX

TOTAL:
₱XXX
```

Only display fields that are actually supported by the current fare rules.

Do not invent a breakdown that does not correspond to the implemented calculation.

---

# 29. TRIP RECORD

Allow a completed trip to be represented as a structured record.

Example:

```javascript
{
    tripId,
    municipality,
    terminal,
    destination,
    distance,
    estimatedTime,
    fare,
    transportMode,
    timestamp
}
```

Local storage may be used for offline trip history.

If centralized synchronization exists, records may also be uploaded.

---

# 30. ROUTE OPTIMIZATION EXPLANATION

The interface should make the purpose understandable to a nontechnical user.

Do not display:

```text
Dijkstra Graph Search Result
```

as the primary user-facing explanation.

Instead use:

```text
Suggested Route
```

and optionally:

```text
The system selected the available route with the lowest route cost based on the stored transportation network.
```

The technical algorithm can be documented separately.

---

# 31. ROUTE COST

Do not assume shortest distance is always the only optimization criterion.

Design the system so route cost can eventually consider:

```text
distance
travel time
route availability
```

For the initial prototype, distance may be the primary cost.

Example:

```text
routeCost =
    distanceWeight * distance +
    timeWeight * travelTime
```

Keep these weights configurable.

Do not claim that the prototype performs real-time traffic optimization unless real-time traffic data actually exists.

---

# 32. FIVE-MUNICIPALITY UI

The application should clearly communicate that the prototype covers Guimaras.

Suggested hierarchy:

```text
TRIKEFAIR

Guimaras Local Transport System

[ Municipality ▼ ]
[ Terminal ▼ ]
[ Destination ▼ ]

        FIND ROUTE

--------------------------------

ROUTE

Origin
Terminal

Destination
Selected Destination

Distance
XX.X km

Estimated Time
XX min

--------------------------------

FARE

Estimated Fare
₱XXX
```

Do not completely redesign the existing UI.

Integrate these controls into the existing visual system.

---

# 33. TERMINAL DATA MUST BE TOGGLABLE

The user must be able to change the origin terminal without modifying code.

This is mandatory.

The data should allow:

```text
Add terminal
Remove terminal
Edit terminal
Assign destinations
Assign routes
Assign fare rules
```

through data/configuration.

An administrator should not need to modify JavaScript logic just to add another terminal.

---

# 34. MUNICIPALITY FILTERING

When:

```text
Municipality = Buenavista
```

only Buenavista terminals should be displayed.

When:

```text
Municipality = Jordan
```

only Jordan terminals should be displayed.

The same applies to:

```text
Nueva Valencia
San Lorenzo
Sibunag
```

---

# 35. TERMINAL → DESTINATION FILTERING

Once a terminal is selected:

```text
Destination
```

must only display destinations/routes associated with that terminal.

Do not display every destination in Guimaras as though every terminal directly serves it.

---

# 36. INVALID ROUTES

If no route exists:

```text
NO ROUTE AVAILABLE

There is currently no configured route between this terminal and destination.
```

Do not automatically fabricate a route.

---

# 37. CROSS-MUNICIPAL ROUTE

If cross-municipality routes are configured:

Display:

```text
ORIGIN
Buenavista

↓
Jordan

↓
Nueva Valencia

↓
DESTINATION
```

This allows the prototype to demonstrate island-wide route connectivity without pretending to have complete real-world routing data.

---

# 38. DATA ACQUISITION

Claude must inspect the existing project before generating new geographic data.

Do not overwrite existing:

```text
rules.json
```

or equivalent files without first understanding their structure.

If route data is missing:

1. Preserve the existing data.
2. Create the new schema.
3. Migrate existing records.
4. Clearly identify demonstration/sample route records.
5. Keep official/local data distinguishable from prototype assumptions.

---

# 39. GEOGRAPHIC DATA

For municipality names and official administrative structure, use reliable Philippine/Guimaras sources.

For actual:

* Terminal coordinates
* Road distances
* Route paths
* Travel times
* Transport availability

use verified data when available.

Do not invent exact coordinates or claim a route exists merely because two municipalities are geographically connected.

If reliable data is unavailable:

```text
TODO: VERIFY LOCAL ROUTE DATA
```

should be used.

---

# 40. DEMO DATA

The application must still be demonstrable even if complete real-world transportation data is unavailable.

Create a clearly labelled demo dataset if necessary.

Example:

```text
DATA MODE: DEMONSTRATION
```

This allows the route engine and UI to be tested without falsely presenting fabricated transportation information as official.

---

# 41. TEST MODE

Add a development/test mode if useful.

Example:

```text
DEMO MODE
```

Capabilities may include:

* Simulated vehicle locations
* Sample GPS updates
* Sample route records
* Test terminals
* Test destinations

Do not mix test data silently with real operational data.

---

# 42. ANDROID / CAPACITOR

The final application must remain compatible with the existing Android packaging architecture.

Preferred architecture:

```text
HTML
CSS
JavaScript
     ↓
Capacitor
     ↓
Android
     ↓
APK
```

Do not convert the project to:

* Kotlin
* Java
* Flutter
* React Native
* .NET MAUI

unless an actual technical limitation requires it.

---

# 43. ANDROID PERMISSIONS

The expanded system may require location permission if GPS functionality is enabled.

Only request:

```text
Location
```

when the GPS feature actually requires it.

Do not add:

* Contacts
* SMS
* Microphone
* Camera
* Storage

without a legitimate requirement.

---

# 44. GPS PERMISSION UX

Before requesting GPS permission, explain why it is needed.

Example:

```text
Location Access

TRIKEFAIR uses your device location to display your current position and support trip tracking.

[Enable GPS]
```

Do not request location permission immediately when the application launches unless the feature genuinely requires it.

---

# 45. GPS FAILURE

If GPS is unavailable:

```text
GPS UNAVAILABLE

Your location could not be obtained.

Fare calculation and route selection remain available.
```

Do not crash the application.

---

# 46. NETWORK FAILURE

If centralized tracking is enabled but internet access fails:

```text
CENTRAL SYNC OFFLINE

Your local trip information remains available.
Location synchronization will resume when connectivity returns.
```

Do not prevent the user from using the core fare calculator.

---

# 47. SECURITY

Do not expose:

* API keys
* Database passwords
* Service credentials
* Private backend keys

inside frontend JavaScript.

If a backend requires credentials, use an appropriate server-side mechanism.

Never commit secrets into the project.

---

# 48. RESPONSIVE DESIGN

The expanded application must work on:

* Android smartphones
* Desktop browsers
* Laptop browsers

Do not create a desktop-only dashboard that makes the original phone interface unusable.

The core passenger workflow must remain easy to operate on a smartphone.

---

# 49. ADMIN / MONITORING VIEW

If an admin dashboard is added, separate it conceptually from the passenger fare interface.

Possible views:

```text
PASSENGER
    ↓
Fare + Route

DRIVER
    ↓
GPS / Trip Status

ADMIN
    ↓
Municipalities
Terminals
Routes
Vehicles
GPS Monitoring
Trip Records
```

Do not require the passenger to interact with administrative controls.

---

# 50. NO FALSE REAL-TIME CLAIMS

This is mandatory.

Do not label data as:

```text
LIVE
REAL-TIME
ACTIVE
CENTRALIZED
```

unless the application is actually receiving that data.

Use:

```text
DEMO
SIMULATED
LAST KNOWN
LOCAL
OFFLINE
```

when appropriate.

---

# 51. PERFORMANCE

The application should remain lightweight.

Do not introduce unnecessary:

* frameworks
* dependencies
* animations
* libraries
* backend services

unless they materially support the new transportation functionality.

The fare calculator should load quickly.

---

# 52. PROJECT INSPECTION

Before modifying anything:

Inspect:

```text
HTML
CSS
JavaScript
JSON
package.json
Capacitor configuration
existing Android configuration
```

Identify:

```text
Existing fare engine
Existing destination data
Existing terminal data
Existing local storage
Existing navigation
Existing UI components
```

Do not assume the structure.

---

# 53. MIGRATION STRATEGY

Use this sequence:

```text
1. Inspect existing project
        ↓
2. Backup/Git checkpoint
        ↓
3. Identify existing fare/data structures
        ↓
4. Create municipality structure
        ↓
5. Migrate existing Buenavista terminal
        ↓
6. Add terminal selector
        ↓
7. Add destination filtering
        ↓
8. Add route graph
        ↓
9. Add route optimization
        ↓
10. Add GPS capability
        ↓
11. Add centralized/demo tracking architecture
        ↓
12. Add monitoring view
        ↓
13. Test existing fare system
        ↓
14. Test expanded transportation system
        ↓
15. Build Android APK
```

---

# 54. REGRESSION TESTING

The existing application must continue to work.

Test at minimum:

## Existing functionality

* Destination selection
* Fare calculation
* Fare splitting
* Night/late-hour rules
* Booking toggle
* Validation
* Reset
* Result display
* Local storage

## New functionality

* Municipality selection
* Terminal selection
* Destination filtering
* Route lookup
* Route optimization
* Cross-municipality routing
* GPS permission
* GPS acquisition
* GPS failure handling
* Demo vehicle tracking
* Central synchronization if configured
* Offline behavior

---

# 55. ROUTE ENGINE TESTS

Create test cases such as:

```text
Terminal A → Destination A
```

```text
Terminal A → Destination B
```

```text
Municipality A → Municipality B
```

```text
No available route
```

```text
Invalid destination
```

```text
Disconnected route graph
```

Verify that the route engine never crashes.

---

# 56. FARE REGRESSION TEST

The old fare calculation must be tested before and after the expansion.

Use the exact same:

```text
inputs
```

and verify:

```text
outputs
```

remain unchanged unless a deliberate new fare rule was explicitly configured.

---

# 57. UI PRINCIPLE

The application should feel like an evolution of TRIKEFAIR, not a completely unrelated transportation application.

The visual language should remain consistent.

New components should fit into the existing UI.

Do not unnecessarily rebuild the interface.

---

# 58. PROJECT DESCRIPTION

The resulting application should be describable as:

> TRIKEFAIR is a Guimaras-focused local transportation prototype that combines transparent tricycle fare computation with municipality-based terminal selection, route-network management, basic route optimization, and GPS-enabled transportation monitoring.

Do not claim that it is a production-ready island-wide transportation system.

It is a prototype demonstrating the architecture and workflow.

---

# 59. IMPORTANT DISTINCTION

The following are different:

```text
Route Optimization
```

means:

> Selecting an efficient path from configured route data.

while:

```text
Real-Time Traffic Optimization
```

requires:

> live traffic/road-condition data.

Do not claim the latter unless implemented.

Likewise:

```text
GPS Tracking
```

means:

> receiving location coordinates.

while:

```text
Fleet Management
```

requires a much larger operational system.

Keep the prototype appropriately scoped.

---

# 60. FINAL APPLICATION ARCHITECTURE

The intended architecture is:

```text
                         TRIKEFAIR
                             │
             ┌───────────────┴───────────────┐
             │                               │
       PASSENGER SYSTEM                MONITORING SYSTEM
             │                               │
      Municipality                         GPS
             │                               │
        Terminal                      Vehicle Location
             │                               │
       Destination                    Central Data
             │                               │
       Route Engine                    Admin View
             │
      Route Optimization
             │
       Fare Calculation
             │
       Fare Transparency
```

---

# 61. MUNICIPALITY ARCHITECTURE

The top-level geographic structure must be:

```text
GUIMARAS
│
├── BUENAVISTA
│   ├── Terminals
│   ├── Routes
│   └── Destinations
│
├── JORDAN
│   ├── Terminals
│   ├── Routes
│   └── Destinations
│
├── NUEVA VALENCIA
│   ├── Terminals
│   ├── Routes
│   └── Destinations
│
├── SAN LORENZO
│   ├── Terminals
│   ├── Routes
│   └── Destinations
│
└── SIBUNAG
    ├── Terminals
    ├── Routes
    └── Destinations
```

---

# 62. FUTURE EXTENSIBILITY

The architecture should allow future additions such as:

```text
Jeepney
Multicab
Bus
Ferry integration
Electronic payment
Driver accounts
Passenger accounts
Trip history
Fleet analytics
Demand heatmaps
Traffic information
```

But DO NOT implement these unless explicitly requested.

Build the architecture so they can be added later.

---

# 63. ABSOLUTE PRIORITIES

Priorities are:

1. Preserve the working TRIKEFAIR fare system.
2. Cover all five municipalities of Guimaras.
3. Make municipality selection functional.
4. Make terminal selection functional.
5. Make destination filtering functional.
6. Introduce a real route-network data model.
7. Implement basic route optimization.
8. Support cross-municipality routes where configured.
9. Add GPS capability.
10. Provide a truthful centralized/demo tracking architecture.
11. Keep the application usable offline for core fare functionality.
12. Do not fabricate official fares, routes, coordinates, or live data.
13. Keep the application suitable for Android APK packaging.
14. Test old and new functionality.
15. Build a working APK.

---

# 64. FINAL DELIVERABLES

The finished project should contain, as applicable:

```text
Project/
│
├── Existing Web App
│
├── data/
│   ├── municipalities.json
│   ├── terminals.json
│   ├── destinations.json
│   ├── routes.json
│   ├── fare_rules.json
│   └── demo_vehicles.json
│
├── capacitor.config.*
│
├── package.json
│
├── android/
│
└── README.md
```

And:

```text
app-debug.apk
```

or an equivalent installable APK.

---

# 65. FINAL REPORT

When finished, report:

### 1. Existing Functionality Preserved

List the original TRIKEFAIR functions that were retained.

### 2. Municipality Coverage

Confirm:

```text
Buenavista
Jordan
Nueva Valencia
San Lorenzo
Sibunag
```

### 3. Terminal System

Explain how terminals are selected and filtered.

### 4. Route System

Explain:

* route graph
* route data
* route optimization
* cross-municipality routing

### 5. GPS System

Explain whether GPS is:

```text
device GPS
demo GPS
centralized GPS
```

and clearly identify what is actually functional.

### 6. Data Sources

Identify which data is:

```text
Existing project data
Verified geographic data
User-provided data
Demo/sample data
```

### 7. APK

Provide the exact APK path.

### 8. Testing

Report:

```text
PASS / FAIL
```

for the major existing and new features.

---

# 66. FINAL DEVELOPMENT PHILOSOPHY

Do not think of this task as:

> "Add random features to a fare calculator."

Think of it as:

> "Expand the existing TRIKEFAIR prototype into a Guimaras-wide local transportation information and fare system while preserving the original fare-transparency functionality."

The final flow should be:

```text
                    GUIMARAS
                        │
           ┌────────────┴────────────┐
           │                         │
     MUNICIPALITY                GPS SYSTEM
           │                         │
     ┌─────┼─────┐                   │
     │     │     │                   │
 Buenavista Jordan Nueva Valencia     │
     │           │                    │
 San Lorenzo  Sibunag                │
     │                                │
     └───────────┬────────────────────┘
                 │
              TERMINAL
                 │
             DESTINATION
                 │
            ROUTE ENGINE
                 │
          ROUTE OPTIMIZATION
                 │
          FARE CALCULATION
                 │
          FARE TRANSPARENCY
                 │
            TRIP RECORD
```

The application must remain a **working prototype**, not pretend to be a complete production transportation infrastructure.

When information is unavailable, use configurable/demo data and label it clearly rather than inventing real-world facts.
