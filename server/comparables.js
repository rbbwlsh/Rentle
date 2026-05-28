// Finds nearby rental "comparables" used as game hints: other Rightmove
// to-rent listings close to the target property, with their prices shown.
//
// Strategy: resolve a Rightmove locationIdentifier for the target's outcode via
// the location typeahead, fetch to-rent search results around it (which embed a
// `window.jsonModel` with a `properties[]` array including price + lat/long),
// then filter/sort those results by real distance from the target.
//
// This is the most fragile part of the app (it relies on Rightmove's internal
// search), so every failure path degrades to returning [] — the game then falls
// back to "too high / too low" hints and still completes.

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};

// Great-circle distance between two lat/long points, in miles.
function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Resolve an outcode (e.g. "SW1A") to a Rightmove locationIdentifier.
async function resolveLocationIdentifier(outcode) {
  if (!outcode) return null;
  // Rightmove's typeahead wants the query split into 2-char chunks.
  const chunks = outcode.toUpperCase().replace(/\s+/g, '').match(/.{1,2}/g);
  if (!chunks) return null;
  const url = `https://www.rightmove.co.uk/typeAhead/uknostreet/${chunks.join(
    '/'
  )}/`;
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    const match = data?.typeAheadLocations?.[0];
    if (match?.locationIdentifier) return match.locationIdentifier;
  } catch {
    /* fall through */
  }
  return null;
}

// Parse the `window.jsonModel` blob from a search results page.
function extractJsonModel(html) {
  const marker = html.indexOf('window.jsonModel');
  if (marker === -1) return null;
  const start = html.indexOf('{', marker);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function fetchSearchResults(locationIdentifier) {
  const params = new URLSearchParams({
    locationIdentifier,
    radius: '1.0',
    propertyTypes: '',
    includeLetAgreed: 'false',
    mustHave: '',
    dontShow: '',
    furnishTypes: '',
    keywords: '',
  });
  const url = `https://www.rightmove.co.uk/property-to-rent/find.html?${params}`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) return [];
  const html = await res.text();
  const model = extractJsonModel(html);
  const props = model?.properties;
  return Array.isArray(props) ? props : [];
}

// Normalize a Rightmove search-result property into a comparable card.
function toComparable(prop, targetLat, targetLng) {
  const lat = prop.location?.latitude;
  const lng = prop.location?.longitude;
  if (lat == null || lng == null) return null;

  // Search results expose the rent in `price.amount` (already monthly for the
  // pcm view) and a formatted `price.displayPrices`.
  const amount = prop.price?.amount;
  if (!amount) return null;

  return {
    id: String(prop.id),
    price: Math.round(amount),
    priceLabel:
      prop.price?.displayPrices?.[0]?.displayPrice || `£${Math.round(amount)} pcm`,
    bedrooms: prop.bedrooms ?? null,
    propertySubType: prop.propertySubType || 'Property',
    address: prop.displayAddress || '',
    imageUrl: prop.propertyImages?.mainImageSrc || prop.propertyImages?.images?.[0]?.srcUrl || null,
    url: prop.propertyUrl
      ? `https://www.rightmove.co.uk${prop.propertyUrl}`
      : `https://www.rightmove.co.uk/properties/${prop.id}`,
    distanceMiles: Number(haversineMiles(targetLat, targetLng, lat, lng).toFixed(2)),
  };
}

// Find up to `limit` comparables near the target. Prefers properties within
// 0.25 miles; if none are that close, widens to the nearest available (the real
// distance is always reported via `distanceMiles`). Returns [] on any failure.
export async function findComparables({
  outcode,
  lat,
  lng,
  bedrooms,
  excludeId,
  limit = 2,
}) {
  if (lat == null || lng == null) return [];

  try {
    const locationIdentifier = await resolveLocationIdentifier(outcode);
    if (!locationIdentifier) return [];

    const results = await fetchSearchResults(locationIdentifier);
    const comparables = results
      .filter((p) => String(p.id) !== String(excludeId))
      .map((p) => toComparable(p, lat, lng))
      .filter(Boolean);

    if (!comparables.length) return [];

    // Rank: closeness in bedroom count first, then physical distance.
    const bedDiff = (c) =>
      bedrooms == null || c.bedrooms == null
        ? 0
        : Math.abs(c.bedrooms - bedrooms);
    comparables.sort(
      (a, b) => bedDiff(a) - bedDiff(b) || a.distanceMiles - b.distanceMiles
    );

    const within = comparables.filter((c) => c.distanceMiles <= 0.25);
    const pool = within.length >= limit ? within : comparables;

    // De-dupe distinct properties and take the requested number.
    const seen = new Set();
    const picked = [];
    for (const c of pool) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      picked.push(c);
      if (picked.length >= limit) break;
    }
    return picked;
  } catch {
    return [];
  }
}
