# Tasks

## 1. Store (TDD)

- [x] 1.1 Schema v3 stepwise migration — "Version 1 database is upgraded", "Version 2 database is upgraded", "Concurrent upgrades both succeed", "Newer schema is refused"
- [x] 1.2 Token columns in upsert (COALESCE) and backfill insert — "Step tokens are stored", "A redelivery keeps stored tokens"
- [x] 1.3 `summaryInputs` (aggregates + candidates) and token-fill APIs; remove `summary`/correction APIs

## 2. Pure summary (TDD)

- [x] 2.1 `buildSummary` — "Summary shows the corrected figure", "Sonnet cache writes are priced", "No add-on outside the rule", "Tier selection matches opencode", incomplete scenarios, sorting

## 3. Recorder, backfill, fill (TDD)

- [x] 3.1 Recorder stores tokens, no prices — "Compaction without tokens stores NULL", "A malformed token object stores zeros"
- [x] 3.2 Backfill stores tokens — "Backfill stores tokens"
- [x] 3.3 `runTokenFill` — "Fill sets tokens", "Fill is idempotent without a marker", "Unavailable source writes nothing", "A confirmed-absent message gets zero tokens", "Concurrent fills apply once"

## 4. Price lookup and wiring (TDD)

- [x] 4.1 PriceLookup: non-waiting `table()`, miss-driven rate-limited reload, change callback — "Reloads are rate-limited", "A hanging catalog never stalls the summary", "The add-on follows the catalog"
- [x] 4.2 `index.ts`: order migrate -> backfill -> fill -> prune; RPC `complete`; debounced notify — "Change notifications are debounced"
- [x] 4.3 Remove correction code, markers, `hasCopilotClaudePrices`, `unpricedModels`

## 5. TUI (TDD)

- [x] 5.1 `~` on an incomplete total — "Incomplete total is marked", "Complete total is unmarked"; existing fixtures gain `complete`

## 6. Verify

- [x] 6.1 Tests, tsc, eslint, build; run against a copy of the live db with the real catalog shape; README note
