'use strict';
/* ============================================================================
   DATASTORE
   A single JSON file. Deliberate: a tricycle terminal demo holds tens of
   records, and a file you can open in Notepad during a defense is worth more
   than a database you have to explain. The access pattern below (load once,
   write whole file on change) is what a real DB layer would replace.

   Online (DATABASE_URL set, e.g. Neon on Render): the same document lives in
   PostgreSQL, because a hosted server's disk is wiped on every deploy. It is
   read once at start-up (init) and written after every change. Listings are
   rows of their own so their photos are not rewritten on every GPS update.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'db.json');
const RULES_PATH = path.join(DATA_DIR, 'rules.json');

let db = null;
let pg = null;                    // { query(sql, params) } in PostgreSQL mode
let persistedPlaces = new Set();  // listing ids already stored as rows
let writing = Promise.resolve();  // writes run one after another, in order

function seed() {
  return {
    trips: [],
    reports: [],
    vehicles: {},           // latest reported position per vehicle (Guimaras expansion)
    networkOverrides: {},   // route segments switched on/off from the monitor
    places: [],             // owner-submitted place listings (unverified)
    pickups: [],            // pick-up requests to a passenger's pin
    meta: { seededAt: new Date().toISOString(), version: 1 }
  };
}

function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    db = seed();
    save();
  }
  // a db.json written before the expansion has no vehicle or network sections
  if (!db.vehicles) db.vehicles = {};
  if (!db.networkOverrides) db.networkOverrides = {};
  normalize();
  return db;
}
function normalize() {
  if (!db.places) db.places = [];
  if (!db.pickups) db.pickups = [];
}

/** Connect to PostgreSQL when DATABASE_URL is set (or a client is passed, for tests). */
async function init(client) {
  if (!client && !process.env.DATABASE_URL) { load(); return 'file'; }
  pg = client || new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL, max: 3 });
  await pg.query('CREATE TABLE IF NOT EXISTS panaw_state (id int PRIMARY KEY, doc jsonb NOT NULL)');
  await pg.query('CREATE TABLE IF NOT EXISTS panaw_places (id text PRIMARY KEY, doc jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
  const state = await pg.query('SELECT doc FROM panaw_state WHERE id = 1');
  const rows = await pg.query('SELECT doc FROM panaw_places ORDER BY created_at DESC');
  db = state.rows[0] ? state.rows[0].doc : seed();
  if (!db.vehicles) db.vehicles = {};
  if (!db.networkOverrides) db.networkOverrides = {};
  normalize();
  db.places = rows.rows.map(r => r.doc);
  persistedPlaces = new Set(db.places.map(p => p.id));
  if (!state.rows[0]) save();
  return 'postgres';
}
const mode = () => (pg ? 'postgres' : 'file');
/** Resolves once every queued write has reached the database. */
const flush = () => writing;

function save() {
  if (pg) return savePg();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);          // atomic: a crash mid-write can't corrupt db.json
}

function savePg() {
  const { places, ...rest } = db;
  const state = JSON.stringify(rest);
  const ids = new Set(places.map(p => p.id));
  const added = places.filter(p => !persistedPlaces.has(p.id)).map(p => [p.id, JSON.stringify(p)]);
  const removed = [...persistedPlaces].filter(id => !ids.has(id));
  persistedPlaces = ids;
  writing = writing.then(async () => {
    await pg.query('INSERT INTO panaw_state (id, doc) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc', [state]);
    for (const [id, doc] of added) await pg.query('INSERT INTO panaw_places (id, doc) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [id, doc]);
    for (const id of removed) await pg.query('DELETE FROM panaw_places WHERE id = $1', [id]);
  }).catch(err => console.error('[db] could not save to PostgreSQL:', err.message));
}

function reset() {
  db = seed();
  save();
  return db;
}

/* ---- rules are loaded fresh so you can edit rules.json without restarting ---- */
let rulesCache = null, rulesMtime = 0;
function rules() {
  const stat = fs.statSync(RULES_PATH);
  if (!rulesCache || stat.mtimeMs !== rulesMtime) {
    rulesCache = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
    rulesMtime = stat.mtimeMs;
  }
  return rulesCache;
}
/** Demo toggles from the Rules screen. Persisted so both devices agree. */
function patchRules(patch) {
  const current = rules();
  const allowed = ['nightSurchargeEnabled', 'simulateNight'];
  for (const key of allowed) {
    if (key in patch) current[key] = Boolean(patch[key]);
  }
  fs.writeFileSync(RULES_PATH, JSON.stringify(current, null, 2));
  rulesMtime = fs.statSync(RULES_PATH).mtimeMs;
  return current;
}

/* ---- Guimaras route network: the data files, re-read when any of them changes ---- */
const NETWORK_FILES = {
  municipalities: 'municipalities.json', terminals: 'terminals.json', destinations: 'destinations.json',
  routes: 'routes.json', fareRules: 'fare_rules.json', demoVehicles: 'demo_vehicles.json',
  transportModes: 'transport_modes.json'
};
let networkCache = null, networkStamp = '';

/** Raw network data, assembled from the files in data/. Not yet validated. */
function networkData() {
  const stamp = Object.values(NETWORK_FILES)
    .map(f => fs.statSync(path.join(DATA_DIR, f)).mtimeMs).join('|');
  if (!networkCache || stamp !== networkStamp) {
    const read = f => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
    const f = {};
    for (const [k, file] of Object.entries(NETWORK_FILES)) f[k] = read(file);
    networkCache = assembleNetwork(f);
    networkStamp = stamp;
  }
  return networkCache;
}
/** Shape the separate files into one object. Shared with the Android build. */
function assembleNetwork(f) {
  return {
    province: f.municipalities.province,
    municipalities: f.municipalities.municipalities,
    defaultTerminalId: f.terminals.defaultTerminalId,
    terminals: f.terminals.terminals,
    destinations: f.destinations.destinations,
    settings: f.routes.settings,
    nodes: f.routes.nodes,
    edges: f.routes.edges,
    fareRules: f.fareRules.fareRules,
    demoVehicles: f.demoVehicles.vehicles,
    transportModes: f.transportModes.modes
  };
}

module.exports = { init, mode, flush, load, save, reset, rules, patchRules, networkData, assembleNetwork, NETWORK_FILES, DB_PATH };
