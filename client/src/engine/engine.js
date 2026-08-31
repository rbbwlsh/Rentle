// The guess-scoring engine, moved client-side. Same contract shape as the old
// server's /api/guess (win / fail / continue-with-hint), but the win test is
// now PERCENTAGE-based: a flat £50 was 8% of a £600 Leeds flat and 0.6% of a
// £9k Chelsea townhouse — one trivial, one impossible. Within 5% is a fair
// fight everywhere.

export const WIN_PCT = 0.05; // within 5% of the listed rent wins
export const MAX_ATTEMPTS = 5;

// Comparables are held back so the opening guesses are a real read of the
// property rather than arithmetic on someone else's price: guesses 1-3 get
// nothing but too-high/too-low, and the two comparables land after guesses 3
// and 4 — in time to inform guesses 4 and 5.
export const COMPARABLE_AFTER_ATTEMPT = 3;

// How far off a guess is, as a fraction of the actual rent.
export const pctOff = (actual, guess) => Math.abs(guess - actual) / actual;

// Wordle-style closeness tiers. Tier 0 is the win; the rest set the colour
// and square count of the feedback row, hottest to coldest.
export const TIERS = [
  { max: WIN_PCT, squares: 5, color: 'green', label: 'Nailed it' },
  { max: 0.1, squares: 4, color: 'yellow', label: 'Blazing' },
  { max: 0.2, squares: 3, color: 'orange', label: 'Warm' },
  { max: 0.35, squares: 2, color: 'red', label: 'Chilly' },
  { max: Infinity, squares: 1, color: 'red', label: 'Freezing' },
];

export function tierFor(actual, guess) {
  const off = pctOff(actual, guess);
  return TIERS.findIndex((t) => off <= t.max);
}

// One share-grid row per guess, Wordle-style.
const EMOJI = { green: '🟩', yellow: '🟨', orange: '🟧', red: '🟥' };
export function emojiRow(tier) {
  const { squares, color } = TIERS[tier];
  return EMOJI[color].repeat(squares) + '⬜'.repeat(5 - squares);
}
export const shareGrid = (tiers) => tiers.map(emojiRow).join('\n');

// Score one guess. Returns the old API's shapes, each carrying the closeness
// tier for the feedback row:
//   { status: 'win', actual, tier: 0 }
//   { status: 'fail', actual, direction, tier }     (final attempt used up)
//   { status: 'continue', attempt, hint, tier }
// Hints: attempts 1-2 -> too high / too low only. After attempt 3 -> comparable
// #1, after attempt 4 -> comparable #2, so the last two guesses are the ones
// with price anchors. Missing comparables degrade to a direction nudge.
export function scoreGuess({ actual, guess, attempt, comparables = [] }) {
  const tier = tierFor(actual, guess);
  const direction = guess - actual > 0 ? 'high' : 'low';

  if (tier === 0) return { status: 'win', actual, tier };
  if (attempt >= MAX_ATTEMPTS) return { status: 'fail', actual, direction, tier };

  // 0 after the 3rd guess, 1 after the 4th; negative earlier, so no comparable.
  const compIndex = attempt - COMPARABLE_AFTER_ATTEMPT;
  const hint =
    compIndex >= 0 && compIndex < comparables.length
      ? { type: 'comparable', property: comparables[compIndex], direction }
      : { type: 'direction', direction };
  return { status: 'continue', attempt, hint, tier };
}

// Which guess (1-based) first landed within the margin, and how close the
// best one got — in £ for display and in % for fair comparison.
export function summarizeGuesses(guesses, actual) {
  const bestDiff = Math.min(...guesses.map((g) => Math.abs(g - actual)));
  const bestPct = bestDiff / actual;
  const idx = guesses.findIndex((g) => pctOff(actual, g) <= WIN_PCT);
  return { bestDiff, bestPct, attemptWon: idx >= 0 ? idx + 1 : null };
}
