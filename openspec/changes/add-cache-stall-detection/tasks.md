## 1. Detection

- [x] 1.1 Add `STALL_MIN_STEPS` and `findStalls` in `src/analysis.ts`; add the `cache_stall` finding (scenarios: Healthy cache is not reported ... Savings are omitted without a cache-read price)
- [x] 1.2 Add stalled-step count to `GroupStats` and `renderReport` (Stalled steps are counted per model)
- [x] 1.3 Add read-only session-steps store query with 24h window

## 2. Live warning

- [x] 2.1 Add `src/stall-watch.ts` tracker and wire it after `upsertLive` in `src/index.ts` (Stall announced once; Stall after recovery is announced again)
- [x] 2.2 Add `cacheStall` event and summary `stalls` field in `src/rpc.ts` and the summary builder (Late-connecting TUI sees an ongoing stall; Recovered stall is not listed)
- [x] 2.3 TUI toast and cost-block warning line in `src/tui.tsx` (Toast on event; Warning line without stalls)

## 3. Docs

- [x] 3.1 Update `cost_hotspots` description in `src/tools.ts` and the finding list in `README.md`
