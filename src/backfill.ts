import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { usdToMicros } from "./money";
import type { Store } from "./store";
import { COMPACTION_AGENT, UNKNOWN, type CostRow } from "./types";

export interface BackfillOptions {
  readonly sourcePath: string;
  /** Epoch ms; messages created before this are not imported. */
  readonly cutoff: number;
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
function mapRows(rows: readonly SourceRow[]): CostRow[] {
  const lastAgent = new Map<string, string>();
  const result: CostRow[] = [];
  for (const row of rows) {
    const isStep = row.type === "assistant";
    if (isStep && row.agent) lastAgent.set(row.session_id, row.agent);
    if (typeof row.cost !== "number" || !row.has_tokens) continue;
    if (!isStep && row.status !== "completed" && row.status !== "failed")
      continue;
    result.push({
      id: row.id,
      sessionId: row.session_id,
      parentSessionId: row.parent_id,
      agent: isStep
        ? (row.agent ?? UNKNOWN)
        : (lastAgent.get(row.session_id) ?? COMPACTION_AGENT),
      providerId: row.provider_id ?? UNKNOWN,
      modelId: row.model_id ?? UNKNOWN,
      kind: isStep ? "step" : "compaction",
      failed: isStep ? false : row.status === "failed",
      costMicros: usdToMicros(row.cost),
      tokens: {
        input: row.tokens_input ?? 0,
        cacheRead: row.tokens_cache_read ?? 0,
        cacheWrite: row.tokens_cache_write ?? 0,
      },
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
      mapRows(readSourceRows(options.sourcePath, options.cutoff)),
    );
  } catch (error) {
    options.log(`backfill skipped, will retry next start: ${String(error)}`);
  }
}

const FILL_CHUNK_SIZE = 500;

interface TokenSourceRow {
  id: string;
  has_tokens: number;
  tokens_input: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
}

/**
 * Fills token counts of rows that lack them, on every start while any exist (no marker; the
 * `IS NULL` guard makes it idempotent). Messages are looked up by id, outside the cmon lock, in
 * chunks that each commit on their own. Zeros are written only for messages a successful read
 * confirmed absent or without token data; any read failure writes nothing more and the next start
 * retries. Returns how many rows were filled.
 */
export function runTokenFill(
  store: Store,
  options: Pick<BackfillOptions, "sourcePath" | "cutoff" | "log">,
): number {
  let filled = 0;
  try {
    const ids = store.idsMissingTokens(options.cutoff);
    if (ids.length === 0) return 0;
    if (!existsSync(options.sourcePath))
      throw new Error(`source database not found: ${options.sourcePath}`);
    const db = new Database(options.sourcePath, { readonly: true });
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      for (let start = 0; start < ids.length; start += FILL_CHUNK_SIZE) {
        const chunk = ids.slice(start, start + FILL_CHUNK_SIZE);
        const found = new Map(
          (
            db
              .query(
                `SELECT id, json_extract(data, '$.tokens') IS NOT NULL AS has_tokens,
                        json_extract(data, '$.tokens.input') AS tokens_input,
                        json_extract(data, '$.tokens.cache.read') AS tokens_cache_read,
                        json_extract(data, '$.tokens.cache.write') AS tokens_cache_write
                 FROM session_message WHERE id IN (${chunk.map(() => "?").join(",")})`,
              )
              .all(...chunk) as TokenSourceRow[]
          ).map((row) => [row.id, row]),
        );
        filled += store.fillTokens(
          chunk.map((id) => {
            const row = found.get(id);
            return {
              id,
              tokens: {
                input: row?.has_tokens ? (row.tokens_input ?? 0) : 0,
                cacheRead: row?.has_tokens ? (row.tokens_cache_read ?? 0) : 0,
                cacheWrite: row?.has_tokens ? (row.tokens_cache_write ?? 0) : 0,
              },
            };
          }),
        );
      }
    } finally {
      db.close();
    }
  } catch (error) {
    options.log(`token fill stopped, will retry next start: ${String(error)}`);
  }
  return filled;
}
