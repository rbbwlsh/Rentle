// Unit tests for the daily/random pickers: determinism, spread, and the
// Europe/London day boundary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { londonDate, pickDaily, pickRandom } from '../client/src/engine/picker.js';

const order = Array.from({ length: 450 }, (_, i) => String(1000 + i));

test('pickDaily is deterministic for a date', () => {
  assert.equal(pickDaily(order, '2026-08-30'), pickDaily(order, '2026-08-30'));
  assert.equal(typeof pickDaily(order, '2026-08-30'), 'string');
  assert.equal(pickDaily([], '2026-08-30'), null);
});

test('consecutive dates spread across the corpus', () => {
  const seen = new Set();
  for (let d = 1; d <= 30; d++) {
    seen.add(pickDaily(order, `2026-09-${String(d).padStart(2, '0')}`));
  }
  assert.ok(seen.size > 10, `only ${seen.size} distinct listings in 30 days`);
});

test('londonDate flips at UK midnight, not UTC midnight', () => {
  // BST (summer): 23:30 UTC is 00:30 next day in London.
  assert.equal(londonDate(new Date('2026-06-15T23:30:00Z')), '2026-06-16');
  // GMT (winter): 23:30 UTC is still the same day.
  assert.equal(londonDate(new Date('2026-01-15T23:30:00Z')), '2026-01-15');
});

test('pickRandom avoids played listings until everything is played', () => {
  const small = ['a', 'b', 'c'];
  for (let i = 0; i < 20; i++) {
    assert.equal(pickRandom(small, ['a', 'c']), 'b');
  }
  // All played: still returns something rather than nothing.
  assert.ok(small.includes(pickRandom(small, small)));
});
