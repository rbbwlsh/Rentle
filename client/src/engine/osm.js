// Map URLs for a listing's location.
//
// OpenStreetMap's embed endpoint takes a bounding box plus a marker and needs
// no API key, account or billing — which keeps the site as deployable-by-file-
// copy as the rest of it. The Google Maps link is the plain public search URL,
// also keyless, for people who want directions or Street View.

// ~390m north-south. Close enough to read the street layout, wide enough to
// show which way the park/main road/river sits.
export const SPAN_DEG = 0.0035;

// Number(null) is 0 and Number('') is 0, so a bare Number.isFinite check would
// happily place a listing with no coordinates off the coast of Africa.
export function hasLocation(lat, lon) {
  const ok = (v) =>
    (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) &&
    Number.isFinite(Number(v));
  return ok(lat) && ok(lon);
}

// A square-ish box around the point. A degree of longitude shrinks as you go
// north, so it's widened by 1/cos(lat) — without that, Edinburgh's map would
// be noticeably squashed compared with Bristol's.
export function boundingBox(lat, lon, span = SPAN_DEG) {
  const dLat = span;
  const dLon = span / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return {
    minLon: lon - dLon,
    minLat: lat - dLat,
    maxLon: lon + dLon,
    maxLat: lat + dLat,
  };
}

export function osmEmbedUrl(lat, lon, span = SPAN_DEG) {
  const b = boundingBox(lat, lon, span);
  const bbox = [b.minLon, b.minLat, b.maxLon, b.maxLat]
    .map((n) => n.toFixed(6))
    .join('%2C');
  return (
    `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}` +
    `&layer=mapnik&marker=${lat.toFixed(6)}%2C${lon.toFixed(6)}`
  );
}

// The full OSM site, for "view a larger map".
export function osmViewUrl(lat, lon, zoom = 17) {
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(
    6
  )}#map=${zoom}/${lat.toFixed(5)}/${lon.toFixed(5)}`;
}

export function googleMapsUrl(lat, lon) {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(
    6
  )}%2C${lon.toFixed(6)}`;
}
