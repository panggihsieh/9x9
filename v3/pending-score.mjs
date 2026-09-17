// Pending targets are absolute per-round values, so retrying a committed batch is idempotent.
export function mergePendingScore(data, pending) {
  if (data.sessionId !== pending.sessionId || data.currentNumber !== pending.number
      || (data.roundVersion || 0) !== pending.round) throw new Error("題目或課堂已變更；保留未同步紀錄，請重新加入原班級確認。");
  const out = { tasks: { ...data.tasks }, wrongAttempts: { ...data.wrongAttempts },
    revealedTasks: { ...data.revealedTasks }, passCounts: { ...data.passCounts }, score: data.score || 0 };
  for (const task of ["factors", "pairs", "primes"]) {
    const target = pending.targets[task];
    if (!target || out.tasks[task]) continue;
    out.wrongAttempts[task] = Math.max(out.wrongAttempts[task] || 0, target.wrong || 0);
    if (target.done) {
      out.tasks[task] = true;
      out.revealedTasks[task] = Boolean(target.revealed);
      if (!target.revealed) {
        out.score += task === "pairs" ? 18 : 14;
        out.passCounts[task] = (out.passCounts[task] || 0) + 1;
      }
    }
  }
  return out;
}
