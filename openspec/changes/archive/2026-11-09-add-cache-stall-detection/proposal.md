# Proposal

## Why

A session cost $167 because the prompt cache silently stopped working mid-session: every step after the break read only the fixed system-prompt prefix from cache while uncached input grew from 60k to 490k tokens per step. The whole-session `low_cache_read` average could not show when the cache broke, how many steps and how much money were affected, or that it was still ongoing. The failure is model and route specific, so it needs per-session and per-model visibility, and a live warning while it is still avoidable.

## What Changes

- `cost_hotspots` gains a `cache_stall` finding: a run of at least 5 consecutive steps in one session that carry at least 20,000 uncached input tokens, a cache-read ratio under 0.5 and a cache-read value that stays at (or within 2% of input-side tokens above) the run's first value. Evidence: start time, stalled steps, whether it is ongoing, constant cache-read value, model, whether the cache was healthy before, stalled cost and estimated savings (omitted when the model has no cache-read price).
- `cost_report` shows a stalled-step count per group when it is above zero.
- The server plugin detects a stall right after recording a step and emits one `cacheStall` RPC event per stall; recovery re-arms it.
- The TUI shows a toast for each `cacheStall` event and a one-line warning in the cost block while a stall is ongoing ("cache stalled N steps, ~$X wasted since HH:MM").
- Rows with unknown token counts are skipped. No schema change, no new dependency.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cost-analysis`: new `cache_stall` hotspot requirement; `cost_report` stalled-step count.
- `cost-display`: stall notification over RPC, TUI toast and cost-block warning line.

## Impact

`src/analysis.ts`, `src/store.ts` (read-only session step query), `src/index.ts` and a new tracker module, `src/rpc.ts`, `src/tui.tsx`, `src/tools.ts`, `README.md`. The pinned vendoring SHA in the dotfiles repo is not changed here.
