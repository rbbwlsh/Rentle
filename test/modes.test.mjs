// The mode table and the guess slider. The buy mode's slider is log-scaled;
// these pin that it stays usable across the whole £25k–£1.5m span, which a
// linear track cannot do (a 1000-step linear track puts ~£1,475 per step and
// bunches the entire corpus into the left tenth).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODES,
  modeOf,
  guessToSlider,
  sliderToGuess,
  sliderBounds,
} from '../client/src/engine/modes.js';
import { planCells } from '../tools/seed.js';
import { MODES as BUILD_MODES } from '../tools/config/modes.js';

test('every build mode has a matching player-facing mode', () => {
  assert.deepEqual(Object.keys(BUILD_MODES).sort(), Object.keys(MODES).sort());
  // Rent keeps the storage key it shipped with, or players lose their history.
  assert.equal(MODES.rent.storageKey, 'rentle_stats_v1');
  assert.notEqual(MODES.buy.storageKey, MODES.rent.storageKey);
  // Rent keeps the original route, so share links already in the wild work.
  assert.equal(MODES.rent.playPath('123'), '/p/123');
  assert.equal(MODES.buy.playPath('123'), '/buy/p/123');
  assert.equal(modeOf('nonsense').key, 'rent');
});

test('the rent slider stays linear and untouched', () => {
  const rent = MODES.rent;
  assert.deepEqual(sliderBounds(rent), { min: 200, max: 10000, step: 25 });
  assert.equal(sliderToGuess(rent, 1500), 1500);
  assert.equal(guessToSlider(rent, 1500), 1500);
});

test('the buy slider is log-scaled and spans the whole band', () => {
  const buy = MODES.buy;
  assert.deepEqual(sliderBounds(buy), { min: 0, max: 1000, step: 1 });
  assert.equal(sliderToGuess(buy, 0), buy.guess.min);
  assert.equal(sliderToGuess(buy, 1000), buy.guess.max);

  // Monotonic, and the midpoint sits near the middle of the market rather than
  // at the arithmetic mean of the endpoints (£762k, which almost nothing is).
  const mid = sliderToGuess(buy, 500);
  assert.ok(mid > 100000 && mid < 300000, `midpoint was ${mid}`);
  let previous = -Infinity;
  for (let p = 0; p <= 1000; p += 25) {
    const v = sliderToGuess(buy, p);
    assert.ok(v >= previous, `slider went backwards at ${p}`);
    previous = v;
  }
});

test('a buy guess round-trips through the slider and snaps to round numbers', () => {
  const buy = MODES.buy;
  for (const value of [60000, 125000, 300000, 750000]) {
    assert.equal(sliderToGuess(buy, guessToSlider(buy, value)), value);
  }
  // Values a person would actually say: nothing lands on £317,431.
  for (let p = 0; p <= 1000; p += 7) {
    const v = sliderToGuess(buy, p);
    const grain = v >= 500000 ? 10000 : v >= 100000 ? 5000 : 1000;
    assert.equal(v % grain, 0, `${v} is not a round number`);
  }
});

test('planCells stratifies buy by bedroom count and round-robins the towns', () => {
  const config = {
    _note: 'ignored',
    Leeds: { outcodes: ['LS1', 'LS6'], beds: { 0: 2, 2: 3 } },
    Hull: { outcodes: ['HU1'], beds: { 0: 1 } },
  };
  const cells = planCells('buy', config);

  // A town's stratum quota is split across its outcodes, and nothing is lost.
  assert.equal(cells.reduce((n, c) => n + c.need, 0), 6);
  const ls = cells.filter((c) => c.city === 'Leeds' && c.beds[0] === 2);
  assert.deepEqual(ls.map((c) => c.need).sort(), [1, 2]);

  // Consecutive cells come from different towns, so stopping early leaves an
  // even spread rather than a complete north and an empty south.
  assert.notEqual(cells[0].city, cells[1].city);
  assert.ok(!Object.keys(cells).includes('_note'));
  assert.equal(cells.some((c) => c.city === '_note'), false);

  // Rent cells are per-outcode with no bedroom filter, exactly as before.
  const rent = planCells('rent', { Leeds: { perOutcode: 20, outcodes: ['LS1', 'LS6'] } });
  assert.deepEqual(rent, [
    { city: 'Leeds', outcode: 'LS1', beds: null, need: 20 },
    { city: 'Leeds', outcode: 'LS6', beds: null, need: 20 },
  ]);
});
