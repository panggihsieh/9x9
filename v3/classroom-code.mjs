export function generateClassroomCode(random = Math.random) {
  return String(1000 + Math.floor(random() * 9000));
}
