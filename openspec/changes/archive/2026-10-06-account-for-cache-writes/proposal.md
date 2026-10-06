# Proposal

## Why

opencode's cost figure prices cache-write tokens at $0 for Claude models, but GitHub Copilot bills them at 1.25x the input price. Verified against the GitHub usage table for Sonnet 5.5 (UTC days 1, 2, 6 Oct: formula matches to the cent) and Opus 5.5. The plugin therefore under-reports Sonnet by roughly 40%, and the gap grows with cache-heavy use. The user wants accurate figures in the TUI.

## What Changes

- Each recorded row gets an additional cost: `cacheWriteTokens x CACHE_WRITE_MULTIPLIER (1.25, the 5-minute cache write rate verified against Copilot's usage table; the 1-hour TTL is out of scope) x input price`, rounded once per row. It applies only to `github-copilot` models whose `family` is Claude (id prefix `claude-` when `family` is absent) and whose catalog cache-write price is 0. The price is taken with opencode's own tier selection (largest context tier below input+cache read+cache write, else the untiered entry), and the zero-write check uses that same entry. Failed steps get the add-on like their `cost_micros`; unknown attribution or a missing price yields 0. opencode's own cost stays stored unchanged in `cost_micros`; the add-on is a separate integer column `cache_write_extra_micros`.
- The summary (totals and per-agent) and therefore the TUI show the corrected figure: `cost_micros + cache_write_extra_micros`.
- The recorder reads `tokens.cache.write` from step/compaction events. Prices come from `await ctx.model.list()` through an injected price lookup (not `ctx.model.get`, which only exists inside transforms), cached and refreshed on `model.updated`; an empty or not-yet-loaded catalog yields 0 for live rows and defers the correction.
- Backfill computes the add-on from `session_message` token data the same way.
- Migration v2 is two separate steps. (a) DDL: `ALTER TABLE ADD COLUMN cache_write_extra_micros INTEGER NOT NULL DEFAULT 0` inside a `BEGIN IMMEDIATE` transaction that re-reads `user_version` under the lock (also created for fresh installs). (b) Data correction with its own meta marker (`cache_write_correction_done`), set in the same transaction as the updates and re-checked under the lock: once the catalog is non-empty and opencode.db is readable, recompute the add-on for existing rows (live and backfilled) that have a source row, order backfill -> correction -> prune. Fails soft and retries next start; rows with no source row keep 0 (accepted under-report). Correction only touches rows whose add-on is 0 so it is idempotent and also repairs rows written by a still-running older process.
- Accepted risks: a plugin v1 process starting after the upgrade refuses the newer schema (tracking off in that process) and rollback disables tracking; rows are priced at the price current when computed (no price snapshot column); a future opencode fix using Copilot's billed amount (opencode TODO #35765) could double count — revisit when bumping the pin.

Out of scope: non-Claude models, Copilot-side services (Code Review, GPT-5 mini), title-generation cost, per-model UI, showing the two figures separately.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cost-recording`: rows carry a cache-write add-on.
- `cost-retention`: backfill and the one-time correction compute the add-on.
- `cost-display`: totals and per-agent amounts are the corrected figure.

## Impact

- `src/recorder.ts`, `src/store.ts`, `src/backfill.ts`, `src/index.ts`, tests. Schema version 1 -> 2 (additive column).
- Depends on `ctx.model.list()` (model cost tiers, per million tokens) at runtime.
- Follow-up: bump the pinned SHA in ai-dotfiles.
