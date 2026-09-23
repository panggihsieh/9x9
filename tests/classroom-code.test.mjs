import test from 'node:test';
import assert from 'node:assert/strict';
import { generateClassroomCode } from '../v3/classroom-code.mjs';

test('classroom code is always a four-digit number', () => {
  assert.equal(generateClassroomCode(() => 0), '1000');
  assert.equal(generateClassroomCode(() => 0.999999), '9999');
  for (let index = 0; index < 1000; index += 1) {
    assert.match(generateClassroomCode(Math.random), /^[1-9][0-9]{3}$/);
  }
});
