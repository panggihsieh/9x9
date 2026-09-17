import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classroomCountdown } from '../v3/countdown.mjs';

const start = 1_000_000;
const room = (durationMinutes) => ({ status: 'active', durationMinutes, startedAt: { toMillis: () => start } });
test('selected durations start at their full minute count', () => {
  for (const minutes of [2, 3, 5, 10]) {
    assert.equal(classroomCountdown(room(minutes), start).seconds, minutes * 60);
  }
});
test('ten minute countdown tracks elapsed time including background pauses', () => {
  assert.equal(classroomCountdown(room(10), start).text, '10:00');
  assert.equal(classroomCountdown(room(10), start + 1000).text, '09:59');
  assert.equal(classroomCountdown(room(10), start + 301_000).text, '04:59');
  assert.equal(classroomCountdown(room(10), start + 590_000).text, '00:10');
});
test('time up stays at zero and waiting or unresolved server timestamps do not count down', () => {
  assert.equal(classroomCountdown(room(10), start + 600_000).text, '00:00');
  assert.equal(classroomCountdown(room(10), start + 900_000).seconds, 0);
  assert.equal(classroomCountdown({ status: 'waiting' }), null);
  assert.equal(classroomCountdown({ status: 'active', startedAt: null }), null);
});
