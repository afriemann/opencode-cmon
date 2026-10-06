const MICROS_PER_USD = 1_000_000;

/** Converts a USD amount to integer micro-USD once at ingest so all later sums are exact. */
export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD);
}

export function formatUsd(micros: number): string {
  const cents = Math.round(micros / 10_000);
  return `$${(cents / 100).toFixed(2)}`;
}
