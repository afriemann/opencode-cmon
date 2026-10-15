import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { usdToMicros } from "./money";
import type { Store } from "./store";
import type { StepAttribution } from "./recorder";
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
  tokens_output: number | null;
  tokens_reasoning: number | null;
  finish: string | null;
  has_error: number;
  directory: string | null;
}

function readSourceRows(sourcePath: string, cutoff: number): SourceRow[] {
  const db = new Database(sourcePath, { readonly: true });
  try {
    db.run("PRAGMA busy_timeout = 5000");
    return db
      .query(
        `SELECT m.id, m.session_id, m.type, m.time_created, s.parent_id, s.directory,
                json_extract(m.data, '$.tokens.output') AS tokens_output,
                json_extract(m.data, '$.tokens.reasoning') AS tokens_reasoning,
                json_extract(m.data, '$.finish') AS finish,
                json_extract(m.data, '$.error') IS NOT NULL AS has_error,
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
      failed: isStep ? row.has_error === 1 : row.status === "failed",
      costMicros: usdToMicros(row.cost),
      tokens: {
        input: row.tokens_input ?? 0,
        cacheRead: row.tokens_cache_read ?? 0,
        cacheWrite: row.tokens_cache_write ?? 0,
      },
      outputTokens: row.tokens_output ?? null,
      reasoningTokens: row.tokens_reasoning ?? null,
      // Mirrors the live recorder: a failed step has no finish reason.
      finish: isStep && row.has_error === 0 ? (row.finish ?? null) : null,
      directory: row.directory ?? null,
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

const ATTRIBUTION_BUSY_TIMEOUT_MS = 50;

export type AttributionFailure =
  | "source-unavailable"
  | "source-read"
  | "source-invalid"
  | "message-missing"
  | "message-mismatch"
  | "field-invalid"
  | "ledger-write";
type ReportAttributionFailure = (reason: AttributionFailure) => void;

/** Only categorical data crosses this boundary; diagnostic sinks cannot affect accounting. */
export function createAttributionDiagnostics(write: (line: string) => void): {
  live: ReportAttributionFailure;
  startupFailure: ReportAttributionFailure;
  startupSummary: (repaired: number) => void;
} {
  const correlation = randomUUID();
  const seen = new Set<AttributionFailure>();
  const counts: Partial<Record<AttributionFailure, number>> = {};
  let summarized = false;
  const emit = (message: string, extra: object): void => {
    try {
      write(
        JSON.stringify({
          service: "opencode-cmon",
          level: "warn",
          message,
          correlation,
          ...extra,
        }),
      );
    } catch {
      /* Diagnostics must not interrupt recording or startup. */
    }
  };
  return {
    live(reason) {
      if (seen.has(reason)) return;
      seen.add(reason);
      emit("attribution recovery unavailable", { reason, count: 1 });
    },
    startupFailure(reason) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    },
    startupSummary(repaired) {
      if (summarized) return;
      summarized = true;
      if (repaired === 0 && Object.keys(counts).length === 0) return;
      emit("attribution startup repair", { repaired, counts });
    },
  };
}

function withAttributionSource<T>(
  sourcePath: string,
  read: (db: Database) => T,
): T {
  const db = new Database(sourcePath, { readonly: true });
  try {
    db.run(`PRAGMA busy_timeout = ${ATTRIBUTION_BUSY_TIMEOUT_MS}`);
    return read(db);
  } finally {
    db.close();
  }
}

function readAttribution(
  db: Database,
  id: string,
  sessionId: string,
  report: ReportAttributionFailure,
): StepAttribution | undefined {
  const fields = ["agent", "model.providerID", "model.id"];
  const row = db
    .query(
      `SELECT id, session_id, type, json_valid(data) AS valid,
    ${fields.map((field, i) => `CASE WHEN json_valid(data) THEN CASE WHEN json_type(data, '$.${field}') = 'text' THEN json_extract(data, '$.${field}') END END AS field${i}`).join(",")}
    FROM session_message WHERE id = $id`,
    )
    .get({ $id: id }) as {
    id: string;
    session_id: string;
    type: string;
    valid: number;
    field0: string | null;
    field1: string | null;
    field2: string | null;
  } | null;
  if (!row) {
    report("message-missing");
    return undefined;
  }
  if (
    row.id !== id ||
    row.session_id !== sessionId ||
    row.type !== "assistant"
  ) {
    report("message-mismatch");
    return undefined;
  }
  if (!row.valid) {
    report("source-invalid");
    return undefined;
  }
  const result: { agent?: string; providerId?: string; modelId?: string } = {};
  const values = [
    ["agent", row.field0],
    ["providerId", row.field1],
    ["modelId", row.field2],
  ] as const;
  for (const [key, value] of values) {
    if (typeof value === "string" && value.trim() !== "" && value !== UNKNOWN)
      result[key] = value;
    else report("field-invalid");
  }
  return result;
}

/** Exact-message evidence only; source failures never interrupt live accounting. */
export function lookupAttribution(
  sourcePath: string,
  id: string,
  sessionId: string,
  report: ReportAttributionFailure = () => {},
): StepAttribution | undefined {
  try {
    if (!existsSync(sourcePath)) {
      report("source-unavailable");
      return undefined;
    }
    return withAttributionSource(sourcePath, (db) =>
      readAttribution(db, id, sessionId, report),
    );
  } catch {
    report("source-read");
    return undefined;
  }
}

/** Retries retained unknown steps on every startup; source reads never hold the ledger write lock. */
export function runAttributionFill(
  store: Store,
  options: Pick<BackfillOptions, "sourcePath" | "cutoff">,
  report: ReportAttributionFailure = () => {},
): number {
  let filled = 0;
  let phase: AttributionFailure = "ledger-write";
  try {
    let chunk = store.attributionCandidates(
      options.cutoff,
      "",
      FILL_CHUNK_SIZE,
    );
    if (chunk.length === 0) return 0;
    if (!existsSync(options.sourcePath)) {
      report("source-unavailable");
      return 0;
    }
    phase = "source-read";
    withAttributionSource(options.sourcePath, (db) => {
      while (chunk.length > 0) {
        phase = "source-read";
        const updates = chunk.map(({ id, sessionId }) => ({
          id,
          sessionId,
          ...readAttribution(db, id, sessionId, report),
        }));
        phase = "ledger-write";
        filled += store.fillAttribution(updates);
        const after = chunk[chunk.length - 1]!.id;
        chunk = store.attributionCandidates(
          options.cutoff,
          after,
          FILL_CHUNK_SIZE,
        );
      }
    });
  } catch {
    report(phase);
  }
  return filled;
}

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
      db.run("PRAGMA busy_timeout = 5000");
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

interface DetailSourceRow {
  id: string;
  tokens_output: number | null;
  tokens_reasoning: number | null;
  finish: string | null;
  has_error: number;
  directory: string | null;
}

/**
 * Fills output/reasoning tokens, finish reason, directory and (for imported steps) the failed flag of
 * rows the detail fill has not handled yet. Each row is handled once, even when its source message
 * is absent; unknown data stays NULL, never zero. A read failure writes nothing and the next start
 * retries. Returns how many rows were handled.
 */
export function runDetailFill(
  store: Store,
  options: Pick<BackfillOptions, "sourcePath" | "cutoff" | "log">,
): number {
  let handled = 0;
  try {
    const ids = store.idsMissingDetails(options.cutoff);
    if (ids.length === 0) return 0;
    if (!existsSync(options.sourcePath))
      throw new Error(`source database not found: ${options.sourcePath}`);
    const db = new Database(options.sourcePath, { readonly: true });
    try {
      db.run("PRAGMA busy_timeout = 5000");
      for (let start = 0; start < ids.length; start += FILL_CHUNK_SIZE) {
        const chunk = ids.slice(start, start + FILL_CHUNK_SIZE);
        const found = new Map(
          (
            db
              .query(
                `SELECT m.id, s.directory,
                        json_extract(m.data, '$.tokens.output') AS tokens_output,
                        json_extract(m.data, '$.tokens.reasoning') AS tokens_reasoning,
                        json_extract(m.data, '$.finish') AS finish,
                        json_extract(m.data, '$.error') IS NOT NULL AS has_error
                 FROM session_message m LEFT JOIN session_v2 s ON s.id = m.session_id
                 WHERE m.id IN (${chunk.map(() => "?").join(",")})`,
              )
              .all(...chunk) as DetailSourceRow[]
          ).map((row) => [row.id, row]),
        );
        handled += store.fillDetails(
          chunk.map((id) => {
            const row = found.get(id);
            const errored = row?.has_error === 1;
            return {
              id,
              outputTokens: row?.tokens_output ?? null,
              reasoningTokens: row?.tokens_reasoning ?? null,
              finish: row && !errored ? (row.finish ?? null) : null,
              directory: row?.directory ?? null,
              errored,
            };
          }),
        );
      }
    } finally {
      db.close();
    }
  } catch (error) {
    options.log(`detail fill stopped, will retry next start: ${String(error)}`);
  }
  return handled;
}
