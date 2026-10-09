# Proposal

## Why

The sidebar total dropped from about $348.72 to $174.68 for October. The cache-write add-on is applied only when the catalog tier prices cache writes at zero. In the sidebar's process the catalog reports a non-zero cache-write price, so about $172 of Claude cache-write cost vanished from the total. The recorded rows still exclude cache writes (e.g. a step with 123,430 micro-USD of cache writes was recorded at 1,238 micro-USD), so the catalog price is the wrong signal.

## What Changes

- Decide per row, from the row's own recorded cost, whether cache writes are already included. Expected cost without cache writes is `input x input price + cacheRead x read price + (output + reasoning) x output price` (selected tier). If the recorded cost is below that expected cost plus half the cache-write charge, the add-on applies; otherwise it is 0.
- When output tokens are unknown, fall back to the current rule (catalog cache-write price is 0).
- The add-on amount stays `cacheWrite x 1.25 x input price`, rounded once per row.
- Summary candidates carry the row's recorded cost and output/reasoning tokens; sidebar summary and `cost_report` tool use the same decision.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cost-display`: requirement "Totals include the cache-write add-on" changes how it decides that a row lacks the cache-write cost.

## Impact

- `src/pricing.ts`, `src/types.ts`, `src/store.ts` (`summaryInputs`), `src/summary.ts`, `src/analysis.ts` and their tests.
- No schema migration, no stored-data rewrite, no new dependencies.
- Out of scope: sidebar UI, and why the sidebar's catalog differs from the one seen elsewhere.
