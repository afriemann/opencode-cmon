export const RETENTION_MONTHS = 6;

/** Half-open `[from, to)` epoch-ms range of the local calendar month containing `now`. */
export function localMonthRange(now: Date): readonly [number, number] {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return [from.getTime(), to.getTime()];
}

/** Rows older than this epoch-ms instant are outside the retention window. */
export function retentionCutoff(now: Date): number {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  return cutoff.getTime();
}
