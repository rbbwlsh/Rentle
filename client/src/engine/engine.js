// The guess-scoring engine, moved client-side. Mirrors the old server's
// /api/guess contract exactly (win margin, attempt cap, hint progression), so
// the game plays identically — the "server" is now a static JSON chunk.

export const WIN_MARGIN = 50; // £ pcm — a guess this close (or closer) wins.
export const MAX_ATTEMPTS = 4;

// Score one guess. Returns the same shapes the old API did:
//   { status: 'win', actual }
//   { status: 'fail', actual, direction }            (final attempt used up)
//   { status: 'continue', attempt, hint }            (hint for the next guess)
// Hints: attempt 1 -> comparable #1, attempt 2 -> comparable #2 (if available),
// later attempts (or missing comparables) -> too high / too low.
export function scoreGuess({ actual, guess, attempt, comparables = [] }) {
  const diff = guess - actual;
  const direction = diff > 0 ? 'high' : 'low';
  const won = Math.abs(diff) <= WIN_MARGIN;

  if (won) return { status: 'win', actual };
  if (attempt >= MAX_ATTEMPTS) return { status: 'fail', actual, direction };

  let hint;
  if (attempt <= comparables.length && attempt <= 2) {
    hint = { type: 'comparable', property: comparables[attempt - 1], direction };
  } else {
    hint = { type: 'direction', direction };
  }
  return { status: 'continue', attempt, hint };
}

// Which guess (1-based) first landed within the margin, and how close the
// best one got — the same numbers the old server computed for the share card.
export function summarizeGuesses(guesses, actual) {
  const bestDiff = Math.min(...guesses.map((g) => Math.abs(g - actual)));
  const idx = guesses.findIndex((g) => Math.abs(g - actual) <= WIN_MARGIN);
  return { bestDiff, attemptWon: idx >= 0 ? idx + 1 : null };
}
