# Design

## Module placement

- `cache-breaks.ts` is a new pure module over already-filtered store rows. `tools.ts` only wires the pinned `cache_breaks` tool.
- Reuse over reimplementation: `analysis.ts` exports `parsePeriod`, `validateLimit`, `price`/`selectTier`, `capText` and `money`.
- `cache_breaks` is separate from `cache_stall`/`findStalls`. That finding is a hotspot heuristic (frozen read, input>0, run>=15).

## Detection

- Ratio is cacheRead/(cacheRead+input). `cost_report`'s `cacheReadRatio` also counts cache writes. The difference is intentional: this ratio asks whether the prompt prefix was reused, and writes would mask a miss.
- The timeline is ordered by createdAt, then id (a stable tiebreak). Steps are kind step with non-null tokens. Compaction rows stay only so the step right after one is excluded, because compaction legitimately resets the cache. Null-token rows are counted in a note.
- A session is flagged on a frozen run >=15, any full miss, or any change-point. The change-point signal is a rolling 10-step ratio crossing below 0.5, evaluated from step 10. Listed misses and change-points are capped at 10 per session.
- Thresholds are named constants, like `STALL_MIN_STEPS`.

## Waste

- Waste is an estimate. `cmon.db` holds only per-step cost totals, so it is computed from the price catalog: uncached input x (tier.input - median cache-read price across the session's priced steps), via `selectTier`.
- The flagged-step set is the union of frozen-run and full-miss steps.
- If any flagged step is unpriced, waste is omitted with an explicit statement instead of reporting a partial figure as complete.

## Output

- The session label is its most frequent provider/model pair. The per-model summary is keyed provider/model and covers all examined sessions.
- `limit` caps only the flagged-session list, ordered by total cost descending.
- The output carries no prompts or message content.

## cost_report two-dimension groupBy

- Pair rows carry `keys [a,b]` and the key `"a / b"`. Single-value output is unchanged, so existing consumers are unaffected.
- Folding into others and shares work as they do today. Gap-bucket ordering applies only to a single `gap` groupBy. `stalledSteps` stays per group.
