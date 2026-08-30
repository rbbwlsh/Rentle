// Encode a finished score into a URL-safe token for "beat my score" links.
// The link is /p/<id>?s=<token>; there is no backend, so the score travels in
// the URL itself. Compact keys: n=name, w=won, a=attemptWon, d=bestDiff.

const toBase64Url = (s) =>
  btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64Url = (s) =>
  decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export function encodeShare({ name, won, attemptWon, bestDiff }) {
  return toBase64Url(
    JSON.stringify({
      n: name || '',
      w: won ? 1 : 0,
      a: attemptWon ?? null,
      d: bestDiff ?? null,
    })
  );
}

// Returns { name, won, attemptWon, bestDiff } or null for a bad token.
export function decodeShare(token) {
  if (!token) return null;
  try {
    const { n, w, a, d } = JSON.parse(fromBase64Url(token));
    return {
      name: n || null,
      won: Boolean(w),
      attemptWon: a ?? null,
      bestDiff: d ?? null,
    };
  } catch {
    return null;
  }
}
