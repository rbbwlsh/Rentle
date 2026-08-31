// Unit tests for the client-side game engine: the percentage win margin,
// closeness tiers + share grid, hint progression, the share codec, and
// localStorage stats/streaks (via an injected fake storage).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ATTEMPTS,
  scoreGuess,
  summarizeGuesses,
  tierFor,
  emojiRow,
  shareGrid,
} from '../client/src/engine/engine.js';
import { encodeShare, decodeShare } from '../client/src/engine/share.js';
import { loadStats, recordGame, setName, summarize } from '../client/src/engine/stats.js';

const comparables = [{ price: 1150 }, { price: 1300 }];

test('the 5% win boundary is exact and scales with the rent', () => {
  // £1,200: 5% = £60 either side.
  assert.equal(scoreGuess({ actual: 1200, guess: 1260, attempt: 1 }).status, 'win');
  assert.equal(scoreGuess({ actual: 1200, guess: 1140, attempt: 5 }).status, 'win');
  assert.equal(scoreGuess({ actual: 1200, guess: 1261, attempt: 1, comparables }).status, 'continue');
  // £9,000: the same 5% is £450 — a flat £50 margin would have been absurd here.
  assert.equal(scoreGuess({ actual: 9000, guess: 9400, attempt: 1 }).status, 'win');
  // £600: 5% is £30 — tight, as it should be at the cheap end.
  assert.equal(scoreGuess({ actual: 600, guess: 640, attempt: 1, comparables }).status, 'continue');
});

test('closeness tiers map percentage-off to squares and colours', () => {
  assert.equal(tierFor(1000, 1050), 0); // 5% — win
  assert.equal(tierFor(1000, 1100), 1); // 10% — blazing
  assert.equal(tierFor(1000, 1150), 2); // 15% — warm
  assert.equal(tierFor(1000, 1300), 3); // 30% — chilly
  assert.equal(tierFor(1000, 1500), 4); // 50% — freezing
  assert.equal(emojiRow(0), '🟩🟩🟩🟩🟩');
  assert.equal(emojiRow(1), '🟨🟨🟨🟨⬜');
  assert.equal(emojiRow(2), '🟧🟧🟧⬜⬜');
  assert.equal(emojiRow(3), '🟥🟥⬜⬜⬜');
  assert.equal(emojiRow(4), '🟥⬜⬜⬜⬜');
  assert.equal(shareGrid([4, 1, 0]), '🟥⬜⬜⬜⬜\n🟨🟨🟨🟨⬜\n🟩🟩🟩🟩🟩');
});

test('hints: direction only for guesses 1-3, then a comparable each for 4 and 5', () => {
  // The opening guesses are an unaided read of the property.
  const g1 = scoreGuess({ actual: 1200, guess: 800, attempt: 1, comparables });
  assert.equal(g1.hint.type, 'direction');
  assert.equal(g1.hint.direction, 'low');
  assert.equal(g1.tier, 3); // 33% off

  const g2 = scoreGuess({ actual: 1200, guess: 3000, attempt: 2, comparables });
  assert.equal(g2.hint.type, 'direction');
  assert.equal(g2.hint.direction, 'high');
  assert.equal(g2.tier, 4);

  // After the 3rd guess the first comparable unlocks — in time for guess 4.
  const g3 = scoreGuess({ actual: 1200, guess: 1350, attempt: 3, comparables });
  assert.equal(g3.hint.type, 'comparable');
  assert.equal(g3.hint.property, comparables[0]);
  assert.equal(g3.hint.direction, 'high');
  assert.equal(g3.tier, 2); // 12.5% off

  // ...and the second after the 4th, in time for guess 5.
  const g4 = scoreGuess({ actual: 1200, guess: 1000, attempt: 4, comparables });
  assert.equal(g4.status, 'continue');
  assert.equal(g4.hint.type, 'comparable');
  assert.equal(g4.hint.property, comparables[1]);

  // Five guesses now, so the 4th is no longer the end of the road.
  const g5 = scoreGuess({ actual: 1200, guess: 1100, attempt: 5, comparables });
  assert.equal(g5.status, 'fail');
  assert.equal(g5.direction, 'low');
  assert.equal(g5.tier, 1); // 8.3% — agonisingly close
  assert.equal(g5.actual, 1200);
  assert.equal(MAX_ATTEMPTS, 5);
});

test('a comparable that does not exist degrades to a direction nudge', () => {
  const none = { actual: 1200, guess: 800, comparables: [] };
  assert.equal(scoreGuess({ ...none, attempt: 1 }).hint.type, 'direction');
  assert.equal(scoreGuess({ ...none, attempt: 3 }).hint.type, 'direction');
  // Only one comparable available: guess 5 falls back rather than repeating it.
  const one = { actual: 1200, guess: 800, comparables: [comparables[0]] };
  assert.equal(scoreGuess({ ...one, attempt: 3 }).hint.type, 'comparable');
  assert.equal(scoreGuess({ ...one, attempt: 4 }).hint.type, 'direction');
});

test('summarizeGuesses finds the winning attempt, best diff and best pct', () => {
  const s = summarizeGuesses([800, 1180], 1200);
  assert.equal(s.bestDiff, 20);
  assert.equal(s.attemptWon, 2);
  assert.ok(Math.abs(s.bestPct - 20 / 1200) < 1e-9);
  assert.equal(summarizeGuesses([800, 700], 1200).attemptWon, null);
});

test('share codec round-trips, including unicode names and best pct', () => {
  const score = { name: 'Röbbie 🎰', won: true, attemptWon: 2, bestDiff: 20, bestPct: 0.25 };
  const decoded = decodeShare(encodeShare(score));
  assert.deepEqual(decoded, {
    name: 'Röbbie 🎰',
    won: true,
    attemptWon: 2,
    bestDiff: 20,
    bestPct: 0.25,
  });
  assert.equal(decodeShare('not-a-token'), null);
  assert.equal(decodeShare(null), null);
  // URL-safe: no characters that need escaping in a query string.
  assert.match(encodeShare(score), /^[\w-]+$/);
});

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

test('stats record games once and track the daily streak', () => {
  const s = fakeStorage();

  recordGame({ mode: 'rent', id: '1', won: true, attemptWon: 2, bestDiff: 20, bestPct: 0.016, guesses: [800, 1180], isDaily: true, dateStr: '2026-08-30' }, s);
  let sum = summarize(loadStats('rent', s));
  assert.equal(sum.played, 1);
  assert.equal(sum.streak, 1);
  assert.equal(sum.winByAttempt[2], 1);
  assert.equal(loadStats('rent', s).games['1'].bestPct, 0.016);

  // Replaying the same listing does not overwrite.
  recordGame({ mode: 'rent', id: '1', won: false, attemptWon: null, bestDiff: 500, guesses: [700], isDaily: true, dateStr: '2026-08-30' }, s);
  sum = summarize(loadStats('rent', s));
  assert.equal(sum.played, 1);
  assert.equal(sum.won, 1);

  // Next-day daily win extends the streak.
  recordGame({ mode: 'rent', id: '2', won: true, attemptWon: 1, bestDiff: 0, bestPct: 0, guesses: [1000], isDaily: true, dateStr: '2026-08-31' }, s);
  sum = summarize(loadStats('rent', s));
  assert.equal(sum.streak, 2);
  assert.equal(sum.maxStreak, 2);

  // A skipped day resets the streak to 1 on the next win.
  recordGame({ mode: 'rent', id: '3', won: true, attemptWon: 1, bestDiff: 10, bestPct: 0.01, guesses: [900], isDaily: true, dateStr: '2026-09-02' }, s);
  assert.equal(summarize(loadStats('rent', s)).streak, 1);

  // A daily loss zeroes it; non-daily games never touch it.
  recordGame({ mode: 'rent', id: '4', won: false, attemptWon: null, bestDiff: 300, guesses: [1], isDaily: true, dateStr: '2026-09-03' }, s);
  assert.equal(summarize(loadStats('rent', s)).streak, 0);
  recordGame({ mode: 'rent', id: '5', won: true, attemptWon: 1, bestDiff: 5, bestPct: 0.005, guesses: [1], isDaily: false }, s);
  assert.equal(summarize(loadStats('rent', s)).streak, 0);
  assert.equal(summarize(loadStats('rent', s)).maxStreak, 2);
});

test('setName persists and trims', () => {
  const s = fakeStorage();
  setName('rent', '  A very long name that goes past twenty-four chars  ', s);
  assert.equal(loadStats('rent', s).name.length <= 24, true);
  assert.equal(loadStats('rent', s).name, 'A very long name that go');
});

test('each mode keeps its own games and its own streak', () => {
  const s = fakeStorage();
  recordGame(
    { mode: 'rent', id: '1', won: true, attemptWon: 1, bestDiff: 0, bestPct: 0, guesses: [1200], isDaily: true, dateStr: '2026-08-31' },
    s
  );
  recordGame(
    { mode: 'buy', id: '9', won: false, attemptWon: null, bestDiff: 50000, bestPct: 0.2, guesses: [200000], isDaily: true, dateStr: '2026-08-31' },
    s
  );

  // Two dailies a day means two independent streaks: losing the buy round
  // must not cost the rent streak, and neither corpus sees the other's games.
  assert.equal(summarize(loadStats('rent', s)).played, 1);
  assert.equal(summarize(loadStats('rent', s)).streak, 1);
  assert.equal(summarize(loadStats('buy', s)).played, 1);
  assert.equal(summarize(loadStats('buy', s)).streak, 0);
  assert.equal(loadStats('rent', s).games['9'], undefined);
  assert.equal(loadStats('buy', s).games['1'], undefined);

  // The player's name is theirs, not the mode's.
  setName('buy', 'Robbie', s);
  assert.equal(loadStats('rent', s).name, 'Robbie');
});
