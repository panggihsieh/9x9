export const ROOM_IDLE_MS = 5 * 60_000;
export function timestampMillis(value) {
  return value?.toMillis?.() ?? (value?.seconds != null ? value.seconds * 1000 : 0);
}
export function canReclaimRoom(room, now = Date.now()) {
  if (room.status === "released") return true;
  // Unknown legacy owners require an explicit admin release.
  if (!room.teacherEmail || !timestampMillis(room.teacherLastSeenAt)) return false;
  const teacherSeen = timestampMillis(room.teacherLastSeenAt);
  const studentSeen = timestampMillis(room.lastStudentSeenAt || room.updatedAt);
  return teacherSeen + ROOM_IDLE_MS <= now && studentSeen + ROOM_IDLE_MS <= now;
}
export function roomIsOpen(room) {
  return Boolean(room && ["waiting", "active"].includes(room.status));
}

// Keep legacy timestamps as a lower bound while older open clients coexist.
export function withPresence(room, presence) {
  if (!presence || presence.sessionId !== room.sessionId) return room;
  const later = (a, b) => timestampMillis(a) >= timestampMillis(b) ? a : b;
  return { ...room, teacherLastSeenAt: later(room.teacherLastSeenAt, presence.teacherLastSeenAt),
    lastStudentSeenAt: later(room.lastStudentSeenAt || room.updatedAt, presence.lastStudentSeenAt) };
}
