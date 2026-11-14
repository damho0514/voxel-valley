/**
 * Tiny frame profiler for the [perf] log: total and worst milliseconds per named section over
 * the logging window. `time(name, fn)` wraps a call; `report()` returns a summary and resets.
 */
type Slot = { total: number; worst: number };
const slots = new Map<string, Slot>();

export function addTime(name: string, ms: number) {
  let s = slots.get(name);
  if (!s) slots.set(name, (s = { total: 0, worst: 0 }));
  s.total += ms;
  if (ms > s.worst) s.worst = ms;
}

export function time<T>(name: string, fn: () => T): T {
  const t = performance.now();
  try {
    return fn();
  } finally {
    addTime(name, performance.now() - t);
  }
}

/** "name total/worst" pairs for sections that took any time, then resets. */
export function report(): string {
  const out: string[] = [];
  for (const [name, s] of slots) if (s.total >= 0.5) out.push(`${name} ${s.total.toFixed(0)}/${s.worst.toFixed(0)}`);
  slots.clear();
  return out.join('  ');
}
