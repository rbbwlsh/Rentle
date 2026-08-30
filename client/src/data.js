// Loads the static corpus the build baked into /data/. This replaces the old
// api.js — the "backend" is now JSON files on the CDN.

let indexPromise = null;
const listingCache = new Map();

async function fetchJson(path) {
  let res;
  try {
    res = await fetch(path);
  } catch {
    throw new Error('Could not load the game data. Are you offline?');
  }
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'That listing is not in the current game.'
        : `Could not load the game data (HTTP ${res.status}).`
    );
  }
  return res.json();
}

// { builtAt, order: [ids], listings: [{id, city, area, ...}] } — price-free.
export function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetchJson('/data/index.json').catch((err) => {
      indexPromise = null; // allow a retry after a transient failure
      throw err;
    });
  }
  return indexPromise;
}

// The full listing chunk with the base64 `secret` (price, address, Rightmove
// URL) decoded into an `answer` object, kept separate from the public fields.
export async function loadListing(id) {
  const key = String(id);
  if (listingCache.has(key)) return listingCache.get(key);
  const chunk = await fetchJson(`/data/listings/${encodeURIComponent(key)}.json`);
  const { secret, ...listing } = chunk;
  const answer = decodeSecret(secret);
  const loaded = { listing, answer };
  listingCache.set(key, loaded);
  return loaded;
}

function decodeSecret(secret) {
  try {
    const bytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
