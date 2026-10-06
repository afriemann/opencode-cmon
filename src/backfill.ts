import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { usdToMicros } from "./money";
import {
  cacheWriteExtraMicros,
  hasCopilotClaudePrices,
  priceKey,
  type PriceTable,
} from "./pricing";
import type { Store } from "./store";
import { COMPACTION_AGENT, UNKNOWN, type CostRow } from "./types";

export interface BackfillOptions {
  readonly sourcePath: string;
  /** Epoch ms; messages created before this are not imported. */
  readonly cutoff: number;
  /** Snapshot of model prices; without a Copilot Claude price no add-on can be computed. */
  readonly prices: PriceTable;
  readonly log: (message: string) => void;
}

interface SourceRow {
  id: string;
  session_id: string;
  type: "assistant" | "compaction";
  time_created: number;
  agent: string | null;
  provider_id: string | null;
  model_id: string | null;
  status: string | null;
  cost: number | null;
  has_tokens: number;
  tokens_input: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  created: number | null;
  parent_id: string | null;
}

function readSourceRows(sourcePath: string, cutoff: number): SourceRow[] {
  const db = new Database(sourcePath, { readonly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return db
      .query(
        `SELECT m.id, m.session_id, m.type, m.time_created, s.parent_id,
                json_extract(m.data, '$.agent') AS agent,
                json_extract(m.data, '$.model.providerID') AS provider_id,
                json_extract(m.data, '$.model.id') AS model_id,
                json_extract(m.data, '$.status') AS status,
                json_extract(m.data, '$.cost') AS cost,
                json_extract(m.data, '$.tokens') IS NOT NULL AS has_tokens,
                json_extract(m.data, '$.tokens.input') AS tokens_input,
                json_extract(m.data, '$.tokens.cache.read') AS tokens_cache_read,
                json_extract(m.data, '$.tokens.cache.write') AS tokens_cache_write,
                json_extract(m.data, '$.time.created') AS created
         FROM session_message m LEFT JOIN session_v2 s ON s.id = m.session_id
         WHERE m.type IN ('assistant', 'compaction') AND m.time_created >= $cutoff
         ORDER BY m.session_id, m.seq`,
      )
      .all({ $cutoff: cutoff }) as SourceRow[];
  } finally {
    db.close();
  }
}

/** Maps source messages to rows using the same rules as the live recorder. */
function mapRows(rows: readonly SourceRow[], prices: PriceTable): CostRow[] {
  const lastAgent = new Map<string, string>();
  const result: CostRow[] = [];
  for (const row of rows) {
    const isStep = row.type === "assistant";
    if (isStep && row.agent) lastAgent.set(row.session_id, row.agent);
    if (typeof row.cost !== "number" || !row.has_tokens) continue;
    if (!isStep && row.status !== "completed" && row.status !== "failed")
      continue;
    const providerId = row.provider_id ?? UNKNOWN;
    const modelId = row.model_id ?? UNKNOWN;
    result.push({
      id: row.id,
      sessionId: row.session_id,
      parentSessionId: row.parent_id,
      agent: isStep
        ? (row.agent ?? UNKNOWN)
        : (lastAgent.get(row.session_id) ?? COMPACTION_AGENT),
      providerId,
      modelId,
      kind: isStep ? "step" : "compaction",
      failed: isStep ? false : row.status === "failed",
      costMicros: usdToMicros(row.cost),
      cacheWriteExtraMicros: cacheWriteExtraMicros(
        {
          input: row.tokens_input ?? 0,
          cacheRead: row.tokens_cache_read ?? 0,
          cacheWrite: row.tokens_cache_write ?? 0,
        },
        prices.get(priceKey(providerId, modelId)),
      ),
      createdAt: row.created ?? row.time_created,
    });
  }
  return result;
}

/**
 * Imports history from opencode.db once. Fails soft: any problem reading the source is logged and
 * leaves the marker unset so the next start retries; live recording is unaffected.
 */
export function runBackfill(store: Store, options: BackfillOptions): void {
  if (store.isBackfillDone()) return;
  try {
    if (!existsSync(options.sourcePath))
      throw new Error(`source database not found: ${options.sourcePath}`);
    store.completeBackfill(
      mapRows(
        readSourceRows(options.sourcePath, options.cutoff),
        options.prices,
      ),
    );
  } catch (error) {
    options.log(`backfill skipped, will retry next start: ${String(error)}`);
  }
}

const CLAUDE_ID_PREFIX = "claude-";
const COPILOT_PROVIDER = "github-copilot";
/** Last deferral message per store, so retries on every catalog update do not repeat the same line. */
const lastDeferral = new WeakMap<Store, string>();

/** Copilot Claude models that have cache-write tokens in the data but no priced catalog entry. */
function unpricedModels(
  rows: readonly SourceRow[],
  prices: PriceTable,
): string[] {
  const missing = new Set<string>();
  for (const row of rows) {
    if ((row.tokens_cache_write ?? 0) <= 0) continue;
    if (row.provider_id !== COPILOT_PROVIDER) continue;
    if (!row.model_id?.startsWith(CLAUDE_ID_PREFIX)) continue;
    const price = prices.get(priceKey(row.provider_id, row.model_id));
    if (!price || price.cost.length === 0) missing.add(row.model_id);
  }
  return [...missing].sort();
}

/**
 * One-time correction of existing rows: sets the cache-write add-on from the source message's model
 * and tokens, for every row whose model is priced. The marker is set only once every Copilot Claude
 * model with cache-write tokens in the data is priced, so models missing from the catalog keep the
 * correction rerunning (idempotently). Fails soft. Returns whether any row changed.
 */
export function runCacheWriteCorrection(
  store: Store,
  options: BackfillOptions,
): boolean {
  if (store.isCorrectionDone() || !hasCopilotClaudePrices(options.prices))
    return false;
  try {
    if (!existsSync(options.sourcePath))
      throw new Error(`source database not found: ${options.sourcePath}`);
    const source = readSourceRows(options.sourcePath, options.cutoff);
    const unpriced = unpricedModels(source, options.prices);
    const updates = mapRows(source, options.prices)
      .filter((row) => row.cacheWriteExtraMicros > 0)
      .map((row) => ({ id: row.id, micros: row.cacheWriteExtraMicros }));
    const changedRows = store.applyCacheWriteCorrection(
      updates,
      unpriced.length === 0,
    );
    if (changedRows > 0)
      options.log(`cache-write correction: priced ${changedRows} rows`);
    if (unpriced.length > 0) {
      const message = `cache-write correction incomplete: no price for ${unpriced.join(", ")} (catalog has ${options.prices.size} models)`;
      if (lastDeferral.get(store) !== message) {
        lastDeferral.set(store, message);
        options.log(message);
      }
    }
    return changedRows > 0;
  } catch (error) {
    options.log(`cache-write correction skipped, will retry: ${String(error)}`);
    return false;
  }
}
