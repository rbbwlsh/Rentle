// Unit tests for the client-side game engine: exact win margin, hint
// progression, the share codec, and localStorage stats/streaks (via an
// injected fake storage).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreGuess, summarizeGuesses } from '../client/src/engine/engine.js';
import { encodeShare, decodeShare } from '../client/src/engine/share.js';
import { loadStats, recordGame, setName, summarize } from '../client/src/engine/stats.js';

const comparables = [{ price: 1150 }, { price: 1300 }];

test('the ±£50 win boundary is exact', () => {
  assert.equal(scoreGuess({ actual: 1200, guess: 1250, attempt: 1 }).status, 'win');
  assert.equal(scoreGuess({ actual: 1200, guess: 1150, attempt: 4 }).status, 'win');
  assert.equal(scoreGuess({ actual: 1200, guess: 1251, attempt: 1, comparables }).status, 'continue');
});

test('hint progression: comparable, comparable, direction, then fail', () => {
  const g1 = scoreGuess({ actual: 1200, guess: 800, attempt: 1, comparables });
  assert.equal(g1.hint.type, 'comparable');
  assert.equal(g1.hint.property, comparables[0]);
  assert.equal(g1.hint.direction, 'low');

  const g2 = scoreGuess({ actual: 1200, guess: 3000, attempt: 2, comparables });
  assert.equal(g2.hint.type, 'comparable');
  assert.equal(g2.hint.property, comparables[1]);
  assert.equal(g2.hint.direction, 'high');

  const g3 = scoreGuess({ actual: 1200, guess: 700, attempt: 3, comparables });
  assert.equal(g3.hint.type, 'direction');
  assert.equal(g3.hint.direction, 'low');

  const g4 = scoreGuess({ actual: 1200, guess: 700, attempt: 4, comparables });
  assert.equal(g4.status, 'fail');
  assert.equal(g4.direction, 'low');
  assert.equal(g4.actual, 1200);
});

test('missing comparables degrade to direction hints from the first guess', () => {
  const g1 = scoreGuess({ actual: 1200, guess: 800, attempt: 1, comparables: [] });
  assert.equal(g1.hint.type, 'direction');
});

test('summarizeGuesses finds the winning attempt and the best diff', () => {
  assert.deepEqual(summarizeGuesses([800, 1180], 1200), { bestDiff: 20, attemptWon: 2 });
  assert.deepEqual(summarizeGuesses([800, 700], 1200), { bestDiff: 400, attemptWon: null });
});

test('share codec round-trips, including unicode names', () => {
  const score = { name: 'Röbbie 🎰', won: true, attemptWon: 2, bestDiff: 20 };
  const decoded = decodeShare(encodeShare(score));
  assert.deepEqual(decoded, { name: 'Röbbie 🎰', won: true, attemptWon: 2, bestDiff: 20 });
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

  recordGame({ id: '1', won: true, attemptWon: 2, bestDiff: 20, guesses: [800, 1180], isDaily: true, dateStr: '2026-08-30' }, s);
  let sum = summarize(loadStats(s));
  assert.equal(sum.played, 1);
  assert.equal(sum.streak, 1);
  assert.equal(sum.winByAttempt[2], 1);

  // Replaying the same listing does not overwrite.
  recordGame({ id: '1', won: false, attemptWon: null, bestDiff: 500, guesses: [700], isDaily: true, dateStr: '2026-08-30' }, s);
  sum = summarize(loadStats(s));
  assert.equal(sum.played, 1);
  assert.equal(sum.won, 1);

  // Next-day daily win extends the streak.
  recordGame({ id: '2', won: true, attemptWon: 1, bestDiff: 0, guesses: [1000], isDaily: true, dateStr: '2026-08-31' }, s);
  sum = summarize(loadStats(s));
  assert.equal(sum.streak, 2);
  assert.equal(sum.maxStreak, 2);

  // A skipped day resets the streak to 1 on the next win.
  recordGame({ id: '3', won: true, attemptWon: 1, bestDiff: 10, guesses: [900], isDaily: true, dateStr: '2026-09-02' }, s);
  assert.equal(summarize(loadStats(s)).streak, 1);

  // A daily loss zeroes it; non-daily games never touch it.
  recordGame({ id: '4', won: false, attemptWon: null, bestDiff: 300, guesses: [1], isDaily: true, dateStr: '2026-09-03' }, s);
  assert.equal(summarize(loadStats(s)).streak, 0);
  recordGame({ id: '5', won: true, attemptWon: 1, bestDiff: 5, guesses: [1], isDaily: false }, s);
  assert.equal(summarize(loadStats(s)).streak, 0);
  assert.equal(summarize(loadStats(s)).maxStreak, 2);
});

test('setName persists and trims', () => {
  const s = fakeStorage();
  setName('  A very long name that goes past twenty-four chars  ', s);
  assert.equal(loadStats(s).name.length <= 24, true);
  assert.equal(loadStats(s).name, 'A very long name that go');
});
