import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseProgressiveNumber, chooseClassroomNumber } from '../v3/question-difficulty.mjs';

test('teacher modes keep beginner and intermediate ranges regardless of score', () => {
  for (const score of [0, 138, 10000]) {
    assert.equal(chooseClassroomNumber('beginner', score, 12, () => 0.99), 27);
    assert.equal(chooseClassroomNumber('intermediate', score, 36, () => 0.99), 50);
  }
  assert.equal(chooseClassroomNumber('advanced', 0, 72, () => 0.99), 81);
  assert.equal(chooseClassroomNumber('advanced', 138, 72, () => 0.99), 100);
  assert.equal(chooseClassroomNumber('', 414, 24, () => 0.99), 100);
});

test('scores progress from small composites to richer factorization problems', () => {
  assert.equal(chooseProgressiveNumber(0, 24, () => 0.99), 27);
  assert.equal(chooseProgressiveNumber(138, 24, () => 0.99), 50);
  assert.equal(chooseProgressiveNumber(276, 24, () => 0.99), 81);
  assert.equal(chooseProgressiveNumber(414, 24, () => 0.99), 100);
});
test('advanced levels retain previous-level review opportunities', () => {
  const rolls = [0.1, 0];
  assert.equal(chooseProgressiveNumber(414, 24, () => rolls.shift()), 48);
});
test('all generated numbers are composite, fit the board and avoid immediate repeats', () => {
  for (const score of [0, 137, 138, 275, 276, 413, 414, 10000]) {
    for (let current = 2; current <= 100; current++) {
      for (let roll = 0; roll < 100; roll++) {
        const n = chooseProgressiveNumber(score, current, () => roll / 100);
        assert.ok(n >= 2 && n <= 100);
        assert.notEqual(n, current);
        assert.ok(Array.from({ length: n - 2 }, (_, i) => i + 2).some(d => n % d === 0));
      }
    }
  }
});
