'use strict';
/* ============================================================================
   PLACE LISTINGS
   Owners and locals list a place (resort, eatery, viewpoint...) with its
   location and photos, the way a tourism board page advertises it.
   Listings are user-submitted: they are shown as "Listed by owner — not
   verified" and never enter the route network or the fare data.
   Shared by server.js and the Android embedded server.
   ========================================================================== */

const crypto = require('crypto');

const CATEGORIES = ['Beach / resort', 'Food', 'Lodging', 'Attraction', 'Pasalubong / shop', 'Other'];
// Guimaras and its islets. A pin outside this box is not a Guimaras place.
const BOUNDS = { minLat: 10.38, maxLat: 10.80, minLng: 122.44, maxLng: 122.80 };
const MAX_PHOTOS = 3;
const MAX_PHOTO_CHARS = 250000;   // the app downsizes photos to fit; keeps a post under the 1 MB body limit
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** Validate a submitted listing. Returns { error } or { place }. */
function cleanPlace(body, municipalities) {
  const name = text(body.name, 80);
  if (name.length < 3) return { error: 'Enter the name of the place.' };
  if (!CATEGORIES.includes(body.category)) return { error: 'Choose a category.' };
  if (!(municipalities || []).some(m => m.id === body.municipality)) return { error: 'Choose a municipality of Guimaras.' };
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'Set the location of the place.' };
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) {
    return { error: 'That location is outside Guimaras.' };
  }
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length > MAX_PHOTOS) return { error: `Up to ${MAX_PHOTOS} photos.` };
  for (const p of photos) {
    if (typeof p !== 'string' || p.length > MAX_PHOTO_CHARS || !PHOTO.test(p)) return { error: 'A photo is not a valid image or is too large.' };
  }
  const ownerKey = text(body.ownerKey, 64);
  if (ownerKey.length < 16) return { error: 'Missing owner key.' };
  return {
    place: {
      id: 'PL-' + crypto.randomBytes(5).toString('hex').toUpperCase(),
      name, category: body.category, municipality: body.municipality,
      description: text(body.description, 600),
      contact: text(body.contact, 80),
      lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6,
      locationSource: body.locationSource === 'gps' ? 'gps' : 'map',
      photos,
      status: 'unverified',
      createdAt: new Date().toISOString(),
      ownerKey
    }
  };
}

// A public server must not be filled up by one phone: hosted databases are small.
const MAX_PER_OWNER = 5, MAX_TOTAL = 300;
/** Error message if this owner (or everyone) has listed too much, else null. */
function limitError(places, ownerKey) {
  if (places.length >= MAX_TOTAL) return 'The listing board is full. Ask the LGU to review older listings.';
  if (places.filter(p => p.ownerKey === ownerKey).length >= MAX_PER_OWNER) return `Up to ${MAX_PER_OWNER} listings per phone. Remove one first.`;
  return null;
}

/** What other users see: never the owner key. */
function publicPlace(p) {
  const { ownerKey, ...rest } = p;
  return rest;
}

module.exports = { cleanPlace, publicPlace, limitError, CATEGORIES, BOUNDS, MAX_PHOTOS, MAX_PHOTO_CHARS };
