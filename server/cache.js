// In-memory TTL cache for challenges. A challenge bundles the normalized
// listing (including the server-only rent) and its comparables, keyed by the
// Rightmove property id. Nothing is persisted: the share link carries the id,
// so any challenge is always re-derivable from Rightmove on a cache miss.

import { fetchListing } from './rightmove.js';
import { findComparables } from './comparables.js';

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const store = new Map(); // id -> { value, expires }

function getFresh(id) {
  const entry = store.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(id);
    return null;
  }
  return entry.value;
}

function set(id, value) {
  store.set(id, { value, expires: Date.now() + TTL_MS });
}

// Fetch (or return cached) the full challenge bundle for a property id.
// Comparables failing is non-fatal — the game degrades to direction hints.
export async function getChallenge(id) {
  const cached = getFresh(id);
  if (cached) return cached;

  const listing = await fetchListing(id);
  const comparables = await findComparables({
    outcode: listing.outcode,
    lat: listing.latitude,
    lng: listing.longitude,
    bedrooms: listing.bedrooms,
    excludeId: listing.id,
    limit: 2,
  });

  const value = { listing, comparables };
  set(id, value);
  return value;
}
