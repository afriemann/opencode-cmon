## Context

A broken prompt cache went unnoticed because the existing whole-session `low_cache_read` average hides when it broke. Detection must be consistent across the analysis tools, the live warning and the TUI, and must not touch the ledger schema. `cost_entry` is indexed only on `created_at`, not `session_id`.

## Goals / Non-Goals

- Goals: one definition of "stall"; a live warning while the stall is still avoidable; a durable TUI indicator.
- Non-Goals: persisted alert state, a schema change, cross-process dedup, auto-remediation, per-model thresholds.

## Decisions

1. **One pure `findStalls(steps)` in `src/analysis.ts`.** `cost_hotspots`, `cost_report` stalled counts, the tracker and the summary all call it, so they cannot disagree. Ordering is `createdAt` then `id`. Only `kind='step'` rows with non-null tokens count; null-token and compaction rows are skipped. Failed steps with tokens count.
2. **Live tracker in `src/stall-watch.ts`.** After `upsertLive` succeeds it runs in its own try/catch, so detection failures never mix with ledger-write diagnostics or block recording. It reads the session's steps through a new read-only store method and runs `findStalls`. Emit-once state lives in memory per session and re-arms when the latest evaluation finds no ongoing stall. A session belongs to one server process, so no cross-process dedup is needed. A restart mid-stall may toast once more; accepted over a persisted marker.
3. **Bounded read.** The query filters `session_id` plus a `created_at` lower bound (24h) so it uses the existing `created_at` index. This avoids a new index and a schema change. A stall that began before the window is detected from its in-window tail only.
4. **TUI.** The durable surface is the cost-block warning, fed by an optional `summary` field of ongoing stalls, derived server side with `findStalls` over the range's recent rows. It is capped at 3 stalls, most wasted cost first, so a late-connecting TUI still sees them. The `cacheStall` RPC event only triggers a toast (`context.ui.toast.show`, warning variant, `sessionID` passed). The TUI tolerates a missing field, so a new TUI on an old server shows no warning.
5. **Sub-agent sessions toast too.** A stall in a child session costs real money; the toast carries `sessionID` so the user can locate it.
6. **`estimatedSavings`** uses the selected tier's catalog cache-read price and is omitted when the model is unpriced.

## Risks

- Per-step DB read on every step: bounded by session and window; cost is small next to a step.
- Heuristic thresholds may false-positive on legitimately cache-less models: the cache-read ratio and constant-value conditions limit this; thresholds live in one place.
- A restart can duplicate a toast; accepted.
- Old server with new TUI shows no warning; accepted.
