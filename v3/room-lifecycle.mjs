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
