// Turning what the player types into a guess.
//
// Split out of GuessControl so the rule that broke the box is pinned by a
// test: the typed text is normalised but NEVER bounded while typing. Clamping
// per keystroke meant the first digit of "1500" became the £200 floor, so the
// field could not be typed into at all.

// Defaults are the rent mode's; the buy mode passes its own, because six
// digits caps typing at £999,999 and would make a £1.2m listing literally
// unguessable.
export const TYPED_MAX = 50000; // a ceiling for fat fingers, not a game rule
export const MAX_DIGITS = 6;

// Digits only, no leading zeros — and an empty box stays empty.
export function normalizeTypedGuess(text, maxDigits = MAX_DIGITS) {
  const digits = String(text ?? '')
    .replace(/\D/g, '')
    .slice(0, maxDigits);
  return digits.replace(/^0+(?=\d)/, '');
}

// The number the box currently represents, or null when it isn't a guess yet.
export function parseTypedGuess(raw) {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Bounds applied once, on submit.
export function clampGuess(n, typedMax = TYPED_MAX) {
  return Math.max(1, Math.min(typedMax, Math.round(n)));
}
