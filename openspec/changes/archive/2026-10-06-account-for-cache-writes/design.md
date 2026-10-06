# Design

## Context

See proposal.md for the why and the scope. This builds on the archived `add-monthly-cost-tracking` design (D1–D9). Facts the design relies on (checked against the pinned opencode v2 source):

- `SessionUsage.calculateCost(costs, usage)` (core `session/usage.ts`) picks the price entry like this: context = `input + cache.read + cache.write`; take the `tier.type === "context"` entry with the largest `tier.size` below context, else the untiered entry, else cost 0. Prices are USD per million tokens.
- `Model.Info` has `id`, `providerID`, an optional `family` (a free string) and `cost: Model.Cost[]`, where each entry has `{tier?, input, output, cache: {read, write}}`.
- In the server plugin context, `ctx.model.list()` is the client `model.list` endpoint. It returns `{ location, data: Model.Info[] }` and its docs say the snapshot "may precede initial plugin settlement", so it can be empty or incomplete at startup. `ctx.model.get` only exists inside a transform editor, so it is not used. Note: the proposal's Impact line that names `ctx.model.get` is out of date; this design uses `list`.
- `model.updated` is an ephemeral event with an empty payload. It only means "the catalog changed".
- Token usage is `{input, output, reasoning, cache: {read, write}}`. The step and compaction events carry it as `data.tokens`, and `session_message.data` stores it as `$.tokens`.

## Goals / Non-Goals

**Goals:** a pure, table-tested add-on calculation that matches opencode's tier selection; a single price source shared by recording, backfill and correction; an additive schema migration that is safe with several processes; a correction that is idempotent and fails soft.

**Non-Goals:** a price snapshot per row, a token column, showing the two figures separately, any price source other than the catalog, live cross-process notification.

## Decisions

### D1 New module `src/pricing.ts`

Everything pure lives here, plus the one stateful lookup.

```ts
interface CostTier {
  tier?: { type: "context"; size: number };
  input: number;
  cache: { read: number; write: number };
}
interface ModelPrice {
  providerId: string;
  modelId: string;
  family?: string;
  cost: readonly CostTier[];
}
interface TokenCounts {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}
type PriceTable = ReadonlyMap<string, ModelPrice>; // key `${providerId}/${modelId}`

const CACHE_WRITE_MULTIPLIER = 1.25;
function isCopilotClaude(p: ModelPrice): boolean;
function selectTier(
  cost: readonly CostTier[],
  t: TokenCounts,
): CostTier | undefined; // mirrors calculateCost
function cacheWriteExtraMicros(
  t: TokenCounts,
  price: ModelPrice | undefined,
): number;
function parseCatalog(response: unknown): PriceTable; // defensive; bad entries skipped
function tokenCounts(value: unknown): TokenCounts; // missing / non-finite / negative -> 0, like SessionUsage.safe
```

- **Predicate:** `providerId === "github-copilot"`, and either `family` lowercased starts with `"claude"`, or `family` is absent and `modelId` starts with `"claude-"`.
- **`cacheWriteExtraMicros`** returns 0 when: price is undefined, the predicate fails, `cacheWrite` is 0, no tier is selected, or the selected tier's `cache.write !== 0` (opencode already charges for writes). Otherwise it returns `Math.round(cacheWrite × 1.25 × tier.input)`. Units: tokens × USD/M × 10⁶ µUSD/USD ÷ 10⁶ = µUSD, so no extra scaling is needed. Rounding happens once per row.
- **`parseCatalog`** reads `response.data`, or the response itself if it is an array. It keeps only entries with string `id`/`providerID` and finite `input`/`cache.write` per cost entry. If the shape is unknown it returns an empty table and never throws.

Alternative considered: a per-call `ctx.model.list()` with no cache. Rejected because it makes one HTTP round trip per step and still needs the same empty-catalog handling.

### D2 `PriceLookup` (refresh and caching)

```ts
interface PriceLookup {
  current(): Promise<PriceTable>; // returns the cache; loads when empty or invalidated; single-flight
  invalidate(): void; // marks the cache stale
}
function createPriceLookup(
  list: () => Promise<unknown>,
  log: (m: string) => void,
): PriceLookup;
```

- The cache holds the last **non-empty** table. A load that fails or returns an empty table keeps the old table, so it never drops to empty. With no old table it returns empty and stays "needs load", so the next `current()` retries.
- All concurrent `current()` calls share one in-flight promise (single-flight).
- `model.updated` → `invalidate()`. The next `current()` reloads. Before that reload finishes, callers get the stale table, which is better than 0.
- Errors are logged only on the transition from success to failure, so a repeated outage doesn't spam the log.

Alternatives considered: a periodic refresh timer (rejected under YAGNI, since `model.updated` covers changes), and eager reload inside the event handler (rejected because lazy reload batches bursts of updates).

### D3 Recorder

- New dependency: `prices: () => Promise<PriceTable>` (wired to `lookup.current`). The recorder stays free of I/O; only the injected function does any.
- `stepRow`/`compactionRow` compute `cacheWriteExtraMicros(tokenCounts(data.tokens), table.get(key))`. For an `unknown` provider or model, the lookup misses and the add-on is 0. Failed steps and failed compactions get the add-on under the same rule as `cost_micros`.
- `CostRow` gains `cacheWriteExtraMicros: number` (always present, default 0).

### D4 Backfill and correction (`src/backfill.ts`)

- The source query adds `json_extract(m.data,'$.tokens.input')`, `'$.tokens.cache.read'` and `'$.tokens.cache.write'`. `mapRows(rows, table)` fills `cacheWriteExtraMicros` with the same function. `runBackfill` takes `prices: PriceTable` (a synchronous snapshot that `index.ts` fetched beforehand).
- New `runCacheWriteCorrection(store, {sourcePath, cutoff, prices, log}): boolean` (returns true when rows changed):
  1. Return if `store.isCorrectionDone()`. Return quietly if `prices.size === 0` (deferred).
  2. Read the source rows outside the lock with the same query and `mapRows`, and keep only rows whose add-on is greater than 0, as `{id, micros}`.
  3. Call `store.applyCacheWriteCorrection(updates)`.
  4. On any error, log and leave the marker unset so the next start or catalog refresh retries.
- The correction prices each row with the **source message's** model, which is the same mapping as backfill. A live row that was stored with `unknown` attribution but has a source row is therefore corrected too. This is intended: billing does not depend on our attribution.

Alternative considered: storing tokens per row and correcting from `cmon.db` alone. Rejected because it needs a token column (a non-goal) and still couldn't fix existing rows.

### D5 Store and schema v2

`CURRENT_SCHEMA_VERSION = 2`. `SCHEMA` (used for fresh installs) includes the column directly.

```sql
-- migrate(): fast path when user_version == 2; else, after WAL/busy_timeout pragmas:
BEGIN IMMEDIATE;
  -- re-read PRAGMA user_version under the lock; > 2 -> ROLLBACK + throw (unchanged rule)
  -- 0: exec SCHEMA (with the column)
  -- 1: ALTER TABLE cost_entry ADD COLUMN cache_write_extra_micros INTEGER NOT NULL DEFAULT 0;
  PRAGMA user_version = 2;
COMMIT;
```

`user_version` is written as part of the transaction, so a second process that waited on the lock sees 2 and does nothing. Statements:

- **Insert columns** add `cache_write_extra_micros`. `upsertLive` adds `cache_write_extra_micros = CASE WHEN excluded.cache_write_extra_micros > 0 THEN excluded.cache_write_extra_micros ELSE cost_entry.cache_write_extra_micros END`. A live write made while the catalog is empty therefore never wipes out an add-on that backfill or the correction already computed.
- **Correction** (`applyCacheWriteCorrection(updates): boolean`), run as `transaction(...).immediate()`:
  1. Re-check the marker `cache_write_correction_done`; if set, return false.
  2. For each update: `UPDATE cost_entry SET cache_write_extra_micros = $micros WHERE id = $id AND cache_write_extra_micros = 0`.
  3. Set the marker to `Date.now()`.
  4. Bump `revision` if any row changed, and return whether any row changed.

  The `= 0` guard makes it idempotent and lets it repair zero rows that a still-running v1 process wrote before the correction ran. Rows with no source row keep 0.

- **Summary:**

  ```sql
  SELECT agent, SUM(cost_micros + cache_write_extra_micros) AS micros FROM cost_entry
  WHERE created_at >= $from AND created_at < $to GROUP BY agent ORDER BY micros DESC, agent ASC
  ```

  The RPC contract and the TUI are unchanged because they display `micros`. `tui.tsx` needs no code change.

Alternatives considered: running the correction inside the DDL migration (rejected because DDL must not depend on the catalog or on `opencode.db` being readable), and reusing `backfill_done` for the correction (rejected because existing installs already have that marker set).

### D6 Wiring (`src/index.ts`)

```mermaid
sequenceDiagram
  participant I as setup()
  participant L as PriceLookup
  participant S as Store
  participant O as opencode.db (ro)
  I->>S: open + migrate (v1→v2 under BEGIN IMMEDIATE)
  I->>L: await current()  (ctx.model.list)
  I->>O: runBackfill(prices) — add-on if catalog loaded, else 0
  I->>O: runCacheWriteCorrection(prices) — no-op if catalog empty or marker set
  I->>S: prune(cutoff)
  I->>I: register RPC, start loop
  loop events
    alt model.updated
      I->>L: invalidate(); await current()
      I->>O: runCacheWriteCorrection if !done → notify() if changed
    else step / compaction
      I->>L: recorder awaits current()
      I->>S: upsertLive → notify()
    end
  end
```

- Startup order is backfill → correction → prune. The correction always runs after backfill, so a fresh install corrects its own zero-priced backfill rows (for example when the catalog was still loading) and then sets the marker.
- The `model.updated` branch is guarded by an in-flight flag so overlapping updates don't stack corrections. It runs inside the existing per-event `try` (fail-soft). Startup steps don't notify, because the TUI pulls on mount.
- `createPriceLookup(() => ctx.model.list(), log)`. A failure in the lookup never disables recording.

## Testing

| File               | Scenarios                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pricing.test.ts`  | Table-driven `cacheWriteExtraMicros`: Copilot Claude with write 0 gives a value (one Sonnet row hand-checked against the Copilot table); the family set vs. the `claude-` prefix fallback; non-Copilot provider, non-Claude model, write price > 0, zero write tokens and undefined price all give 0. Tier selection: below and above a tier size, context counting all three token kinds, no untiered entry gives 0, and the zero-write check uses the selected tier. Rounding happens once. `parseCatalog`: `{data}`, a bare array, garbage, and partially bad entries. `tokenCounts`: missing, NaN and negative values. |
| `pricing.test.ts`  | `PriceLookup`: loads once under concurrent calls; empty or failed loads keep the previous table and retry; `invalidate` triggers a reload.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `recorder.test.ts` | A step and a compaction carry the add-on; a failed step gets the add-on; `unknown` attribution and an empty table give 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `store.test.ts`    | A fresh DB is created at v2 with the column; a v1 file (rows kept) migrates to v2 with default 0; two stores migrate the same v1 file concurrently and both succeed; v3 is refused. Upsert keeps a non-zero add-on when the live value is 0. Summary sums both columns. Correction: updates only zero rows, sets the marker, a second call is a no-op, and concurrent correctors each apply once.                                                                                                                                                                                                                          |
| `backfill.test.ts` | Fixture `session_message` with token JSON gives the right add-on. Correction: fixes live and backfilled zero rows, leaves rows with no source row at 0, defers on an empty table (marker unset), and on a missing or broken source logs and leaves the marker unset.                                                                                                                                                                                                                                                                                                                                                       |
| `index.test.ts`    | With a stubbed `ctx.model.list`: startup applies the correction; empty-at-startup followed by `model.updated` with a full catalog runs the correction and emits `changed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Component breakdown

| Part                                        | Kind of work                 | Done when                                                                                      |
| ------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `pricing.ts` (pure parts + lookup)          | application code, unit tests | The table tests above pass, and the tier selection matches `calculateCost` on the same inputs. |
| Recorder token and add-on                   | application code             | Every recorder scenario carries the right `cacheWriteExtraMicros`.                             |
| Store v2 (DDL, upsert, correction, summary) | application code (SQLite)    | Migration and concurrency tests pass on a v1 fixture file.                                     |
| Backfill and correction runner              | application code             | Fixture tests pass, and a source failure never throws.                                         |
| `index.ts` wiring                           | application code             | Startup order and the `model.updated` path are verified in `index.test.ts`.                    |
| README                                      | documentation                | It states that the figure includes Copilot Claude cache writes at 1.25× input.                 |

## Risks / Trade-offs

- [`model.updated` is not delivered through `ctx.event.subscribe`] → The startup load plus the retry on empty in `current()` still prices live rows, and the correction runs at the next start. Verify this during implementation with a manual check.
- [Catalog stays empty for a whole session] → Live rows record 0. If the correction marker was already set, they stay at 0. Accepted as rare. The `CASE` upsert at least keeps any add-on that backfill or the correction already computed.
- [A v1 process writes rows after the correction marker is set] → Those rows keep 0 until the process restarts on v2. Accepted, and noted in the proposal.
- [Prices change after rows are computed] → Rows use the price current when computed, with no snapshot. Accepted.
- [opencode starts pricing cache writes itself (TODO #35765)] → The `cache.write !== 0` check turns the add-on off automatically. If upstream switches to Copilot's billed amount without changing the catalog, it would double count. Recheck when bumping the pinned SHA.

## Migration Plan

Deploy a v2 build. The first process to start migrates under the lock, then backfill (a no-op on existing installs), correction and prune run. Rollback: a v1 build refuses the v2 DB, so tracking is disabled in that process. Re-enable v2 or delete `cmon.db`. `opencode.db` is never written.
