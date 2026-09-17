export function classroomCountdown(room, now = Date.now()) {
  if (room?.status !== "active") return null;
  const startedAt = room.startedAt?.toMillis?.();
  if (!Number.isFinite(startedAt)) return null;
  const minutes = [2, 3, 5, 10].includes(room.durationMinutes) ? room.durationMinutes : 3;
  const seconds = Math.max(0, Math.ceil((startedAt + minutes * 60_000 - now) / 1000));
  return { seconds, text: `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` };
}
