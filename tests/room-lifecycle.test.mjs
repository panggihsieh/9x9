import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReclaimRoom, ROOM_IDLE_MS, withPresence } from '../v3/room-lifecycle.mjs';
const now = 2_000_000;
const time = (ms) => ({ toMillis: () => ms });
const stale = { status: 'active', teacherEmail: 'teacher@example.com', teacherLastSeenAt: time(now - ROOM_IDLE_MS), lastStudentSeenAt: time(now - ROOM_IDLE_MS) };
test('reclaim only after both teacher and students have been inactive for five minutes', () => {
  assert.equal(canReclaimRoom(stale, now), true);
  assert.equal(canReclaimRoom({ ...stale, teacherLastSeenAt: time(now - ROOM_IDLE_MS + 1) }, now), false);
  assert.equal(canReclaimRoom({ ...stale, lastStudentSeenAt: time(now - 1000) }, now), false);
});
test('legacy classrooms require admin release, including missing heartbeat metadata', () => {
  assert.equal(canReclaimRoom({ ...stale, teacherEmail: undefined }, now), false);
  assert.equal(canReclaimRoom({ ...stale, teacherLastSeenAt: undefined }, now), false);
  assert.equal(canReclaimRoom({ status: 'released' }, now), true);
});

test('separate presence prevents release while either role is active', () => {
 const room = {...stale, sessionId:'new'};
 assert.equal(canReclaimRoom(withPresence(room,{sessionId:'new',teacherLastSeenAt:time(now)}),now),false);
 assert.equal(canReclaimRoom(withPresence(room,{sessionId:'new',lastStudentSeenAt:time(now)}),now),false);
 assert.equal(canReclaimRoom(withPresence(room,{sessionId:'old',lastStudentSeenAt:time(now)}),now),true);
 assert.equal(canReclaimRoom(withPresence({...room,lastStudentSeenAt:time(now)},{sessionId:'new',lastStudentSeenAt:time(1)}),now),false);
});
