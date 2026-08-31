// Turning what the player types into a guess.
//
// Split out of GuessControl so the rule that broke the box is pinned by a
// test: the typed text is normalised but NEVER bounded while typing. Clamping
// per keystroke meant the first digit of "1500" became the £200 floor, so the
// field could not be typed into at all.

export const TYPED_MAX = 50000; // a ceiling for fat fingers, not a game rule
const MAX_DIGITS = 6;

// Digits only, no leading zeros — and an empty box stays empty.
export function normalizeTypedGuess(text) {
  const digits = String(text ?? '')
    .replace(/\D/g, '')
    .slice(0, MAX_DIGITS);
  return digits.replace(/^0+(?=\d)/, '');
}

// The number the box currently represents, or null when it isn't a guess yet.
export function parseTypedGuess(raw) {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Bounds applied once, on submit.
export function clampGuess(n) {
  return Math.max(1, Math.min(TYPED_MAX, Math.round(n)));
}
