# Design

## Context

See proposal.md for the why and the scope. This change replaces decisions D3–D6 of the archived `account-for-cache-writes` design and the two follow-up marker changes. The parts that carry over unchanged are `selectTier`, `parseCatalog`, `tokenCounts`, the 1.25x rule, the Copilot Claude predicate, and the `PriceLookup` rule that an empty or failed load keeps the last non-empty table.

Current state (schema v2):

- `cost_entry.cache_write_extra_micros` is written by the recorder and backfill and patched by `runCacheWriteCorrection` under a meta marker. `summary()` calls the private `totalsBy(column, alias, from, to)` twice, once by `agent` and once by `provider_id || '/' || model_id`. Each call sums `cost_micros + cache_write_extra_micros` and orders by `micros DESC, <name> ASC` in SQL. `Summary` is `{ revision, totalMicros, agents: AgentTotal[], models: ModelTotal[] }`, where `ModelTotal = { model: "provider/model", micros }` (archived `add-model-breakdown`).
- The TUI has an Agents/Models toggle (`breakdownLines`). It reads `models ?? []`, so a reply without `models` from an older server renders an empty list instead of crashing (archived `fix-missing-models-crash`).
- `index.ts` awaits `lookup.current()` before backfill and correction. On `model.updated` it invalidates the lookup and reruns the correction.
- Existing facts this design relies on:
  - Live step rows always have tokens, because the recorder drops a step without `data.tokens`. Compactions may arrive without tokens.
  - Backfill imports only messages with `$.tokens`.
  - A row id equals its `session_message.id`. The correction already relied on this.

## Goals / Non-Goals

**Goals:**

- The add-on is a pure function of (stored tokens, current catalog), evaluated on every summary.
- The schema migration is additive only.
- The token fill is idempotent and has no marker.
- The summary never blocks on the catalog.
- An honest `complete` flag tells the user when the add-on figure may be understated.

**Non-Goals:**

- Per-agent or per-model completeness, or a `~` on agent or model lines.
- Dropping the old column.
- Re-running the fill during a session.
- Price snapshots.
- Partial indexes.

## Decisions

### D1 Schema v3 (stepwise, additive)

`CURRENT_SCHEMA_VERSION = 3`. `SCHEMA` (used for a fresh database) defines every column: it keeps `cache_write_extra_micros INTEGER NOT NULL DEFAULT 0` and adds three nullable columns, `tokens_input INTEGER`, `tokens_cache_read INTEGER` and `tokens_cache_write INTEGER`, with no default.

`migrate()` keeps its current shape: a fast path, a re-read under `.immediate()`, and a refusal when the version is above 3. The steps are:

| from | steps (one transaction)                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| 0    | `exec(SCHEMA)`                                                                                                     |
| 1    | `ADD COLUMN cache_write_extra_micros …` (as today), then the v2→v3 step                                            |
| 2    | `ADD COLUMN tokens_input INTEGER`, `ADD COLUMN tokens_cache_read INTEGER`, `ADD COLUMN tokens_cache_write INTEGER` |

The rule is `version === 0 ? SCHEMA : (version < 2 && v1→v2; version < 3 && v2→v3)`, followed by `user_version = 3`.

Every existing row ends up with NULL tokens, and the fill (D4) repairs them.

**Token invariant:** the three columns are written together, either all NULL or all non-NULL. "Tokens unknown" is tested with `tokens_cache_write IS NULL` everywhere.

Alternatives considered:

- A `tokens_known` flag column. Rejected as redundant with NULL.
- Storing tokens as JSON. Rejected because the candidate filter `tokens_cache_write > 0` needs a real column.

### D2 Store API

`CostRow` drops `cacheWriteExtraMicros` and gains `tokens: TokenCounts | null`. `TokenCounts` moves to `types.ts`, or `types.ts` imports it from `pricing.ts`.

`INSERT_COLUMNS` and `bindings` drop the old column, which falls back to its DEFAULT 0, and bind the three token columns. A NULL `tokens` binds NULL to all three.

| Method                                                                          | Change                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upsertLive(row)`                                                               | The conflict update sets each token column to `COALESCE(excluded.tokens_x, cost_entry.tokens_x)`. The old `cache_write_extra_micros` CASE is removed. The `WHERE source='backfill' OR agent='unknown'` guard is unchanged.                                                                    |
| `completeBackfill(rows)`                                                        | Unchanged apart from the bindings.                                                                                                                                                                                                                                                            |
| `summaryInputs(from, to)`                                                       | **New.** Returns `{ agents: AgentTotal[]; models: ModelTotal[]; candidates: Candidate[] }`. Three queries run in one deferred read transaction so they see the same snapshot. `agents` and `models` come from `totalsBy`, which is kept but sums only `cost_micros` and drops its `ORDER BY`. |
| `idsMissingTokens(since)`                                                       | **New.** `SELECT id … WHERE tokens_cache_write IS NULL AND created_at >= $since`.                                                                                                                                                                                                             |
| `fillTokens(updates)`                                                           | **New.** `updates: {id, tokens}[]`. One `.immediate()` transaction per call runs `UPDATE … SET <3 cols> WHERE id=$id AND tokens_cache_write IS NULL`. It returns the number of changed rows and bumps the revision when that is above 0.                                                      |
| `summary`, `isCorrectionDone`, `applyCacheWriteCorrection`, `CORRECTION_MARKER` | **Removed.** Old marker rows stay in `meta`, where they do no harm.                                                                                                                                                                                                                           |

The three summary queries:

```sql
-- agents   (totalsBy("agent", "agent", …))
SELECT agent AS agent, SUM(cost_micros) AS micros FROM cost_entry
WHERE created_at >= $from AND created_at < $to GROUP BY agent;
-- models   (totalsBy("provider_id || '/' || model_id", "model", …))
SELECT provider_id || '/' || model_id AS model, SUM(cost_micros) AS micros FROM cost_entry
WHERE created_at >= $from AND created_at < $to GROUP BY model;
-- candidates
SELECT agent, provider_id, model_id, tokens_input, tokens_cache_read, tokens_cache_write
FROM cost_entry WHERE created_at >= $from AND created_at < $to
  AND provider_id = 'github-copilot'
  AND (tokens_cache_write > 0 OR tokens_cache_write IS NULL);
```

`Candidate = { agent, providerId, modelId, tokens: TokenCounts | null }`. NULL-token rows are fetched as candidates because whether they matter depends on the catalog (D3). Ordering moves to code for both lists, because the add-on can reorder agents and models.

Alternative considered: separate public methods per query. Rejected because separate reads can straddle a concurrent write and produce a total that is inconsistent for a moment.

### D3 Pure `buildSummary` (new `src/summary.ts`)

```ts
function buildSummary(
  aggregate: { agents: readonly AgentTotal[]; models: readonly ModelTotal[] },
  candidates: readonly Candidate[],
  catalog: PriceTable,
): {
  totalMicros: number;
  agents: AgentTotal[];
  models: ModelTotal[];
  complete: boolean;
  unpriced: string[];
};
```

`pricing.ts` gains `addOnApplies(providerId, modelId, price?)`. With a price it applies the existing `isCopilotClaude(price)`. Without a price it falls back to `providerId === "github-copilot" && modelId.startsWith("claude-")`, which is the same fallback `isCopilotClaude` uses. `cacheWriteExtraMicros` is unchanged.

Rules for each candidate, with `price = catalog.get(key)`:

| Case                                          | Add-on                                                           | Effect on `complete`                        |
| --------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| `!addOnApplies` (e.g. a GPT model on Copilot) | 0                                                                | none                                        |
| tokens NULL                                   | 0                                                                | `complete = false`                          |
| no price, or `price.cost` is empty            | 0                                                                | `complete = false`, key added to `unpriced` |
| priced                                        | `cacheWriteExtraMicros(tokens, price)`, one `Math.round` per row | none                                        |

Each row's add-on is added, as an integer, to three places: the total, its agent's bucket and its `${providerId}/${modelId}` bucket (the same key the SQL builds). `totalMicros` is the sum of the agent buckets, which equals the sum of the model buckets. Both lists are re-sorted with the SQL tie-break: micros descending, then name (`agent` or `model`) ascending. A candidate whose agent or model is missing from the aggregate gets a new bucket anyway, defensively. `unpriced` is deduplicated and is used only to trigger a reload (D5).

The function is pure and table-tested, with no I/O and no clock.

### D4 Token fill (`backfill.ts`, `runTokenFill`)

The function is `runTokenFill(store, { sourcePath, cutoff, log }): number`. It returns the number of rows filled.

1. `ids = store.idsMissingTokens(cutoff)`. If the list is empty, return 0 without opening the source. This is the fast path for every start after the first.
2. If the source is missing, log and return 0. Nothing is written.
3. Open the source read-only (busy_timeout 5000). For each chunk of up to **500 ids**, staying well under the bound-variable limit, run `SELECT id, $.tokens IS NOT NULL, $.tokens.input, $.tokens.cache.read, $.tokens.cache.write FROM session_message WHERE id IN (…)` **outside** the cmon lock. Then call `store.fillTokens(chunkUpdates)`. Each chunk holds the lock briefly, and progress is durable.
4. Mapping:
   - Found with tokens: fill the counts, mapping missing or non-finite sub-fields to 0. This mirrors `tokenCounts`.
   - Found without `$.tokens`, or id absent from a chunk that read successfully: write zeros, because the row is confirmed to have no tokens.
5. If a chunk read fails (an error, or a schema mismatch such as a missing table), stop. Chunks already written stay, because they are correct. The failing chunk and the remaining chunks write nothing. The function logs and returns, and the next start retries.

The fill is idempotent because of the `IS NULL` guard. When concurrent starters both run it, the second one updates 0 rows. No marker is needed.

Alternatives considered:

- A full-scan join like the old correction. Rejected because it reads all history every time and ties the fill to backfill's mapping.
- One transaction for all chunks. Rejected because it holds the write lock while doing source I/O.

### D5 `PriceLookup` (summary never waits)

```ts
interface PriceLookup {
  table(): PriceTable;                        // cached snapshot; synchronous; never loads
  refresh(reason: "updated" | "miss"): void;  // fire-and-forget, single-flight
}
createPriceLookup(list, log, onChange: () => void, now = Date.now): PriceLookup;
```

- `"updated"` is used at startup and on `model.updated`. It always loads. If a load is already in flight, one more load is queued after it, because the in-flight load may have fetched the old catalog.
- `"miss"` comes from the summary when `unpriced` is non-empty. It loads only when no load is in flight **and** at least **60 s** have passed since the last miss-driven start. That caps miss reloads at one per minute per process, whatever the polling rate.
- The 5 s load timeout and the keep-last-non-empty rule stay. They now bound only the background load.
- `onChange` fires only when a load produced a table whose fingerprint differs from the cached one. The fingerprint is a stable stringification of its entries. Without this check, a permanently unpriced model would cause a loop: notify, then summary, then miss, then reload, then notify again.
- `current()`, `invalidate()` and `hasCopilotClaudePrices` are removed.

Alternative considered: await the load in the summary with a short timeout. Rejected because it still stalls each call and is what the proposal rules out. With the chosen design, the first summary after a start may show `~` until the catalog arrives, and `onChange` then refreshes the TUI.

### D6 Recorder and backfill (no prices)

- **Recorder:** the `prices` dependency and `addOn` are removed.
  - A step row gets `tokens: tokenCounts(data.tokens)`. It is always non-NULL, because steps without tokens are already dropped.
  - A compaction row gets `tokens: data.tokens == null ? null : tokenCounts(data.tokens)`. NULL means unknown, and the fill (on the next start) or the COALESCE merge (on redelivery) resolves it.
  - A tokens object that is present but malformed becomes zeros, matching opencode's `safe`.
- **Backfill:** `BackfillOptions.prices` is removed. `mapRows` sets `tokens` from the `tokens_*` columns using `?? 0`, so backfilled rows are never NULL because the import requires `has_tokens`.
- **Removed:** `runCacheWriteCorrection`, `unpricedModels`, `lastDeferral`, and the pricing imports in `backfill.ts`.

### D7 RPC and TUI

- `CostRpc.summary.output` keeps `models` and gains `complete: { type: "boolean" }`, which is added to `required`. `Summary` gains `readonly complete: boolean`.
- `tui.tsx`, `amount(state)`: when the state is `ready` and `summary.complete === false`, it returns `"~" + formatUsd(total)`. Otherwise the output is unchanged. The comparison is strict, so a server without the field renders as before.
  - `amount` is the single choke point. The sidebar header (`This month: ~$12.34`) and both footer forms (`▶ ~$12.34 this month`, `▼ ~$12.34 · build $8.10 …`) pick up the marker without any JSX change.
  - Agent lines, model lines and footer agent parts stay unmarked.
  - The Agents/Models toggle and `breakdownLines` are unchanged, including the `models ?? []` guard, so a reply without `models` (or without `complete`) still renders safely.
- Impact on existing tests: `Summary` fixtures in `tui.test.ts` (and any in `index.test.ts`) need `complete: true`. String expectations are unchanged.

### D8 Wiring (`index.ts`)

```mermaid
sequenceDiagram
  participant I as setup()
  participant S as Store (cmon.db)
  participant O as opencode.db (ro)
  participant L as PriceLookup
  participant T as TUI
  I->>S: open + migrate (→ v3 under BEGIN IMMEDIATE)
  I->>L: refresh("updated") (not awaited)
  I->>O: runBackfill (stores tokens; once, marker)
  I->>O: runTokenFill (ids by NULL tokens, chunked)
  I->>S: prune(cutoff)
  T->>I: summary(from,to)
  I->>S: summaryInputs
  I->>L: table()
  I->>I: buildSummary → {…, complete}
  I-->>L: refresh("miss") if unpriced
  L-->>I: onChange → scheduleNotify (500 ms debounce)
  I-->>T: changed{revision}
```

- The startup order is migrate, backfill, fill, prune. All of these are synchronous and do not depend on the catalog, so startup never awaits the catalog.
- The summary handler is the sequence `summaryInputs` → `buildSummary(…, lookup.table())` → `refresh("miss")` if `unpriced.length` → `{ revision: store.revision(), totalMicros, agents, models, complete }`.
- `scheduleNotify()` is a trailing 500 ms debounce on an unref'd timer, cleared on dispose. It emits the revision current at fire time. It replaces every direct `notify()`: for upserts, prune, and `onChange`.
- On `model.updated` the handler calls `lookup.refresh("updated")` and nothing else. The notify follows through `onChange`, once the new table actually differs. Notifying earlier would be pointless, because the summary reads the cache.
- **Removed:** `backfillOptions`, `correctAfterCatalogChange`, and the `correcting` flag.

## Risks / Trade-offs

- [A compaction recorded without tokens shows `~` until the next opencode start, because the fill runs only at startup] → Accepted, as the proposal states. If it is noticed in practice, a cheap follow-up is to schedule a single deferred `runTokenFill` after storing a NULL-token row. That was rejected for now under YAGNI.
- [A redelivery that carries tokens onto a correctly attributed live row with NULL tokens is blocked by the upsert `WHERE` guard] → The fill on the next start repairs it. It is rare, because only compactions can be NULL.
- [A retired Claude model with no catalog entry keeps `~` showing for the rest of that month, with at most one miss reload per minute] → Accepted. It is honest that the figure is understated, and it ages out when the month rolls over.
- [The fill writes zeros if the source message has not yet committed its tokens at the moment of a concurrent start] → This needs a compaction to end in the same instant another process starts. Accepted.
- [A v2 process that is still running sums `cost + extra`, but new rows have extra 0, so its total is understated] → Accepted, as the proposal states. It goes away on restart.
- [Each process prices from its own catalog, so two TUIs can differ] → Accepted, as the proposal states.
- [Summary cost: one extra indexed range query per call] → The candidate set is a subset of one month and is small. No new index is needed (YAGNI).

## Migration Plan

1. Deploy the new build. The first start migrates v2 → v3 under the immediate lock (concurrent starters upgrade once), then fills tokens for every row inside the retention window. Until the fill completes, the summary may show `~`.
2. Later starts: if no row has NULL tokens, the fill is a single indexed `SELECT` that returns nothing.
3. Rollback: a v2 build refuses a v3 database, which is the same caveat as before. To recover, restore a backup, or delete `cmon.db` and let backfill reimport history.
4. Follow-up outside this repo: bump the pinned SHA in ai-dotfiles.

## Component Breakdown

| Part                                      | Work-kind                    | Done when                                                                                                                                                                                                                            |
| ----------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schema v3 and Store API (D1, D2)          | application code (TS/SQLite) | v0, v1 and v2 databases all reach v3 with identical columns. Concurrent upgrades succeed. The new and removed methods match D2.                                                                                                      |
| `buildSummary` and `addOnApplies` (D3)    | application code, pure       | The table tests cover every row of the D3 rules, rounding per row, the add-on reaching total, agent and model, and re-sorting of both lists.                                                                                         |
| Token fill (D4)                           | application code             | The fill is idempotent, chunks by 500, writes zeros only for rows confirmed to have no tokens, writes nothing on a read failure, and fails soft when the source is missing.                                                          |
| `PriceLookup` rework (D5)                 | application code             | Tests show `table()` never waits, the miss rate limit holds, a queued update reload runs, and `onChange` fires only when the table differs.                                                                                          |
| Recorder and backfill simplification (D6) | application code             | No pricing imports remain. The NULL vs 0 token rules are covered by tests.                                                                                                                                                           |
| RPC `complete` and TUI `~` (D7)           | application code (TUI)       | `~` appears in the sidebar and in both footer forms when `complete` is false, and never on agent or model lines. `models` is still returned. Existing tests pass with `complete: true`, and the missing-`models` case still renders. |
| Wiring (D8)                               | application code             | The startup order is as specified. Notifications are debounced. `model.updated` reaches the TUI only after the table changes.                                                                                                        |

## Test plan (by spec area; scenario names to follow the delta specs)

- **store.test:**
  - Each upgrade path: a v0 fresh database, a v1 fixture and a v2 fixture all reach v3 with NULL tokens on existing rows.
  - Concurrent upgrade, and refusal of a newer schema.
  - Upsert with NULL tokens keeps the stored tokens (COALESCE). Upsert with tokens fills NULL tokens on a backfill row.
  - `fillTokens` guard: only NULL rows are filled, and unknown ids are ignored.
  - `summaryInputs` keeps a half-open range and the candidate filter. It returns agent and `provider/model` sums of `cost_micros` only, ignoring `cache_write_extra_micros`.
  - The existing per-model summary tests are retargeted from `summary()` to `summaryInputs` plus `buildSummary`.
  - The correction tests are removed.
- **summary.test** (new):
  - Sonnet cache writes are priced at read time, and the add-on follows a catalog change.
  - Non-Claude Copilot models and other providers get no add-on.
  - An unpriced Claude candidate gives `complete=false` and appears in `unpriced`.
  - A NULL-token Claude row gives `complete=false`.
  - A NULL-token non-Claude row stays complete.
  - Rounding happens once per row.
  - The add-on is added to the total, the row's agent and the row's `provider/model`. The total equals the sum of agents and the sum of models.
  - An add-on reorders agents and models. Ties sort by name ascending.
  - A candidate whose agent or model is missing from the aggregate gets its own bucket.
- **backfill.test:**
  - Backfill stores tokens, and its result no longer depends on a catalog.
  - Fill: existing rows get tokens; the fill is idempotent and needs no marker; an absent id gets zeros; a missing source writes nothing; a read or schema failure writes nothing; rows outside the window are skipped; work is chunked by 500 (for example, 1,200 NULL rows are all filled).
  - The correction tests are removed.
- **recorder.test:**
  - A step stores its tokens.
  - A compaction without tokens stores NULL, and a malformed tokens object becomes zeros.
  - The add-on and price-failure tests are removed.
- **pricing.test:**
  - `PriceLookup`: no wait in `table()`; single flight; a queued `updated` reload; the miss rate limit, using an injected clock; `onChange` only when the table differs; the timeout.
  - `addOnApplies` fallback.
  - The `hasCopilotClaudePrices` tests are removed.
- **index.test:**
  - End to end, Sonnet cache writes appear in the summary (total, agent and model), including when the catalog loads after the first summary (`complete` goes from false to true, with a `changed` emitted).
  - Existing rows get tokens on start.
  - Changes are debounced: several events produce one `changed`.
  - `model.updated` with a changed catalog notifies.
  - The tests for the correction and for an empty catalog recording zero are replaced.
- **tui.test:**
  - `~` appears in `amount`, in the closed and opened footer, and in the sidebar header.
  - With no `complete` field, no `~` is shown.
  - Agent and model breakdown lines never show `~`.
  - A summary without `models` still renders (existing fix-missing-models-crash test kept).
  - Existing fixtures gain `complete: true`.
