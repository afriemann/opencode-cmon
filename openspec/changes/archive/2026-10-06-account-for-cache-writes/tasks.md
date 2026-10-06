# Tasks

## 1. Pricing (TDD)

- [x] 1.1 pricing.ts pure functions (`cacheWriteExtraMicros`, tier selection, predicate, `parseCatalog`, `tokenCounts`) — "Sonnet cache writes are priced", "No add-on outside the rule", "Tier selection matches opencode"
- [x] 1.2 PriceLookup (single-flight, keeps last non-empty, invalidate)

## 2. Store (TDD)

- [x] 2.1 Schema v2 migration under BEGIN IMMEDIATE — upgrade, concurrent, newer-refused scenarios
- [x] 2.2 upsert keeps non-zero add-on; summary sums both — "A redelivery with zero add-on keeps the stored add-on", "Summary shows the corrected figure"
- [x] 2.3 applyCacheWriteCorrection + marker — idempotent, concurrent scenarios

## 3. Recorder and backfill (TDD)

- [x] 3.1 Recorder add-on incl. failed steps and empty catalog
- [x] 3.2 Backfill add-on and runCacheWriteCorrection — all correction scenarios

## 4. Wiring

- [x] 4.1 index.ts: price lookup, order backfill -> correction -> prune, model.updated handling; verify model.updated delivery manually
- [x] 4.2 README note

## 5. Verify

- [x] 5.1 Tests, tsc, eslint, build; corrected figures compared with the GitHub table (UTC days)
