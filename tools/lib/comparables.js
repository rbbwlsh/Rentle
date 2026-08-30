// Builds the "nearby rental" price-anchor hints from the corpus itself.
//
// The old app scraped Rightmove's search live for every game; with a stored
// corpus the best comparables are simply the other corpus listings — same
// city, similar bedroom count, physically closest. Computed once at build
// time and baked into each listing's JSON chunk.

// Great-circle distance between two lat/long points, in miles.
export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cleanSummary(s) {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > 220 ? `${t.slice(0, 220)}…` : t;
}

// A corpus listing rendered as a comparable card (the shape ComparableCard.jsx
// expects). The other listing's own price IS shown — it's a price anchor — but
// its address stays at neighbourhood level and nothing links to it.
function toComparable(candidate, target, imageUrlFor) {
  return {
    price: candidate.priceAmount,
    priceLabel: candidate.priceLabel || `£${candidate.priceAmount} pcm`,
    bedrooms: candidate.bedrooms ?? null,
    bathrooms: candidate.bathrooms ?? null,
    propertySubType: candidate.propertySubType || 'Property',
    area: candidate.area || null,
    summary: cleanSummary(candidate.description),
    imageUrl: imageUrlFor(candidate) || null,
    imageCount: candidate.imageCount ?? 0,
    addedOrReduced: null,
    distanceMiles: Number(
      haversineMiles(
        target.latitude,
        target.longitude,
        candidate.latitude,
        candidate.longitude
      ).toFixed(2)
    ),
  };
}

// Pick up to `limit` comparables for `target` from `candidates` (the rest of
// the corpus). Rank: closeness in bedroom count first, then real distance;
// prefer listings within a mile when enough exist. Mirrors the old live
// search's ranking (server/comparables.js), widened from 0.25mi to 1mi since
// a ~500-listing corpus is sparser than a live search.
export function pickComparables(target, candidates, { limit = 2, imageUrlFor } = {}) {
  if (target.latitude == null || target.longitude == null) return [];

  const pool = candidates
    .filter(
      (c) =>
        c.id !== target.id &&
        c.city === target.city &&
        c.priceAmount != null &&
        c.latitude != null &&
        c.longitude != null
    )
    .map((c) => toComparable(c, target, imageUrlFor));

  if (!pool.length) return [];

  const bedDiff = (c) =>
    target.bedrooms == null || c.bedrooms == null
      ? 0
      : Math.abs(c.bedrooms - target.bedrooms);
  pool.sort((a, b) => bedDiff(a) - bedDiff(b) || a.distanceMiles - b.distanceMiles);

  const near = pool.filter((c) => c.distanceMiles <= 1.0);
  return (near.length >= limit ? near : pool).slice(0, limit);
}
