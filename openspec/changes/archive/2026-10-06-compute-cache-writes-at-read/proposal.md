# Proposal

## Why

Persisting the cache-write add-on at write time (and correcting history once) has failed three times on the user's database: the add-on depends on the model catalog, which is incomplete or provisional at startup, so rows were stored (and a one-time marker set) with wrong zeros that never heal. The user wants the calculation in code, not baked into the database.

## What Changes

- Rows store opencode's own cost plus the raw token counts needed for pricing (`tokens_input`, `tokens_cache_read`, `tokens_cache_write`) instead of a computed add-on.
- The cache-write add-on is computed in code when the summary is built, per row, from the current catalog (existing pricing rules: Copilot Claude, selected tier with write price 0, 1.25x input, rounded once per row). The figure therefore follows the catalog at read time; there is nothing to correct and no marker.
- Remove: the one-time correction (`runCacheWriteCorrection`, `applyCacheWriteCorrection`, its markers and `model.updated`-triggered reruns) and the recorder's/backfill's use of prices. The persisted `cache_write_extra_micros` column is left in place but unused and ignored (never dropped: dropping would break still-running older processes and needs SQLite >= 3.35).
- Schema v3 is purely additive and concurrency-safe like v2: add the three token columns (NULL = tokens unknown). A marker-less token fill runs on every start while NULL-token rows exist: it reads `opencode.db` outside the lock, looks rows up by id, and updates `WHERE tokens IS NULL` under `BEGIN IMMEDIATE`. It writes zero tokens for a row only when the source read succeeded and the id is confirmed absent; any read failure writes nothing.
- The summary stays SQL for `SUM(cost_micros)` grouped by agent and by `provider/model` (the per-model breakdown now on `main`) and fetches only candidate rows (`github-copilot`, `tokens_cache_write > 0`) to price in code; a pure `buildSummary(aggregate, candidates, catalog)` combines them. The add-on is applied to the total, to each agent and to each model, and both lists are re-sorted in code. Rounding is one `Math.round` per row, summed as integers.
- Catalog handling at read time: a candidate row whose model has no priced catalog entry triggers a rate-limited catalog reload (fetches capped, no per-call 5 s stall), and NULL-token rows and unpriced candidates mark the summary incomplete. The summary RPC reports `complete: boolean`; when false the TUI prefixes the amount with `~` (e.g. `~$12.34`) instead of silently showing an understated figure. `changed` emissions are debounced (about 500 ms).
- Live recording: compactions that arrive without tokens store NULL (picked up by the fill); the upsert merges tokens with `COALESCE`.
- Accepted: each server process prices from its own catalog (two TUIs can differ); past rows are re-priced at today's catalog, so a retired model loses its add-on and, if the catalog ever prices cache writes itself, history is understated.

Out of scope: non-Claude/non-Copilot models, title-generation cost, any other display change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cost-recording`: rows store tokens; the add-on is no longer stored.
- `cost-retention`: backfill stores tokens; the one-time correction is replaced by a token fill.
- `cost-display`: totals include the add-on computed at read time; the RPC reports completeness and the TUI marks an incomplete figure with `~`.

## Impact

- `src/store.ts` (schema v3, summary), `src/recorder.ts`, `src/backfill.ts`, `src/index.ts`, `src/pricing.ts` (read-time use), tests. Net code reduction.
- Schema 2 -> 3 (additive): a v2 process already running keeps working; a v2 build starting later refuses the database (same rollback caveat as before).
- Follow-up: bump the pinned SHA in ai-dotfiles.
