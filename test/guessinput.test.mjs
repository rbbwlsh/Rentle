// The rent box. These pin the regression that made it unusable: the value was
// clamped to the £200 slider floor on every keystroke, so the first digit of
// any guess was swallowed and the field could not be cleared.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTypedGuess,
  parseTypedGuess,
  clampGuess,
  TYPED_MAX,
} from '../client/src/engine/guessInput.js';

test('a guess can be typed one digit at a time', () => {
  // Typing "1500": every intermediate state must survive untouched.
  assert.equal(normalizeTypedGuess('1'), '1');
  assert.equal(normalizeTypedGuess('15'), '15');
  assert.equal(normalizeTypedGuess('150'), '150');
  assert.equal(normalizeTypedGuess('1500'), '1500');
  // Crucially, a value under the slider's £200 floor is NOT snapped up.
  assert.equal(parseTypedGuess('1'), 1);
});

test('the box can be emptied', () => {
  assert.equal(normalizeTypedGuess(''), '');
  assert.equal(parseTypedGuess(''), null);
  assert.equal(parseTypedGuess(null), null);
});

test('only digits survive, and leading zeros are dropped', () => {
  assert.equal(normalizeTypedGuess('£1,500 pcm'), '1500');
  assert.equal(normalizeTypedGuess('12.50'), '1250');
  assert.equal(normalizeTypedGuess('abc'), '');
  assert.equal(normalizeTypedGuess('007'), '7');
  assert.equal(normalizeTypedGuess('0'), '0');
  assert.equal(parseTypedGuess('0'), null); // zero isn't a guess
  // Six digits is plenty for a monthly rent; past that we stop accepting.
  assert.equal(normalizeTypedGuess('123456789'), '123456');
});

test('bounds are applied on submit, not while typing', () => {
  assert.equal(clampGuess(1500), 1500);
  assert.equal(clampGuess(1), 1);
  assert.equal(clampGuess(999999), TYPED_MAX);
  assert.equal(clampGuess(1500.6), 1501);
});
