// Picks which listing to play: the deterministic daily, or a random one.
//
// "Today" is London's today — the daily flips at UK midnight for everyone,
// wherever they are. The pick is a hash of the date over the corpus `order`
// (a committed, append-only shuffle), so every player gets the same listing
// with no backend.

// YYYY-MM-DD in Europe/London, regardless of the player's timezone.
export function londonDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// FNV-1a over the date string — tiny, stable, spreads consecutive dates well.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pickDaily(order, dateStr = londonDate()) {
  if (!order?.length) return null;
  return order[fnv1a(dateStr) % order.length];
}

// "Rentle #N" — puzzle 1 is launch day, counted in London days. Each mode
// carries its own epoch, so a mode added later starts at #1 on ITS launch day
// rather than inheriting a number from a game it wasn't part of.
const EPOCH = '2026-08-31';
export function dailyNumber(dateStr = londonDate(), epoch = EPOCH) {
  const days = Math.round(
    (Date.parse(`${dateStr}T12:00:00Z`) - Date.parse(`${epoch}T12:00:00Z`)) / 86400000
  );
  return days + 1;
}

export function pickRandom(order, excludeIds = []) {
  if (!order?.length) return null;
  const excluded = new Set(excludeIds.map(String));
  const pool = order.filter((id) => !excluded.has(String(id)));
  const from = pool.length ? pool : order;
  return from[Math.floor(Math.random() * from.length)];
}
