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

// e.g. 0.12 -> "0.1 mi away", 0.25 -> "0.25 mi away"
export function formatDistance(miles) {
  if (miles == null || Number.isNaN(miles)) return '';
  const rounded = miles < 0.1 ? miles.toFixed(2) : miles.toFixed(1);
  return `${rounded} mi away`;
}
