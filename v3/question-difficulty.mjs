// Progress follows earned points, so skipping or revealing answers does not raise difficulty.
const pools = [
  [4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21, 22, 24, 25, 27],
  [26, 28, 30, 32, 33, 34, 35, 36, 38, 39, 40, 42, 44, 45, 49, 50],
  [48, 54, 56, 60, 63, 64, 66, 70, 72, 75, 78, 80, 81],
  [60, 72, 84, 90, 96, 100]
];

export function chooseProgressiveNumber(score, currentNumber, random = Math.random) {
  const level = Math.min(3, Math.max(0, Math.floor((Number(score) || 0) / 138)));
  // 80% current level, 20% review of the preceding level.
  const selectedLevel = level > 0 && random() < 0.2 ? level - 1 : level;
  const values = pools[selectedLevel].filter((number) => number !== currentNumber);
  return values[Math.floor(random() * values.length)];
}
