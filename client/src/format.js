// Formatting helpers for prices and distances.

const gbp = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

// e.g. 2250 -> "£2,250 pcm"
export function formatPcm(amount) {
  if (amount == null || Number.isNaN(amount)) return '—';
  return `${gbp.format(Math.round(amount))} pcm`;
}

// e.g. 2250 -> "£2,250"
export function formatGbp(amount) {
  if (amount == null || Number.isNaN(amount)) return '—';
  return gbp.format(Math.round(amount));
}

// The headline price in whichever mode is being played: "£2,250 pcm" for a
// rent, "£425,000" for an asking price.
export function formatPrice(amount, mode) {
  return mode?.unit ? `${formatGbp(amount)} ${mode.unit}` : formatGbp(amount);
}

// e.g. 0.12 -> "0.1 mi away", 0.25 -> "0.25 mi away"
export function formatDistance(miles) {
  if (miles == null || Number.isNaN(miles)) return '';
  const rounded = miles < 0.1 ? miles.toFixed(2) : miles.toFixed(1);
  return `${rounded} mi away`;
}

// Station distances arrive from Rightmove as raw floats (0.46527164819595607).
// One decimal place is all anyone reads a walk in.
export function formatMiles(miles) {
  const n = Number(miles);
  if (miles == null || Number.isNaN(n)) return '';
  return `${n.toFixed(1)} mi`;
}

// Rightmove's station types are SCREAMING_ENUMS; render them as words.
const STATION_TYPES = {
  NATIONAL_TRAIN: 'National Rail',
  LONDON_UNDERGROUND: 'Underground',
  LONDON_OVERGROUND: 'Overground',
  LIGHT_RAILWAY: 'Light rail',
  TRAM: 'Tram',
  SUBWAY: 'Subway',
  METRO: 'Metro',
  CABLE_CAR: 'Cable car',
  FERRY: 'Ferry',
  BUS: 'Bus',
};
export function formatStationType(type) {
  if (!type) return '';
  return (
    STATION_TYPES[type] ||
    String(type).toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  );
}
