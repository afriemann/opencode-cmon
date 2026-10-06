import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentTotal, CostRow, Summary } from "./types";

export interface StoreOptions {
  dbPath?: string;
  busyTimeoutMs?: number;
}

/** Bumped whenever the on-disk schema changes. */
export const CURRENT_SCHEMA_VERSION = 2;

const DEFAULT_BUSY_TIMEOUT_MS = 5000;
const BACKFILL_MARKER = "backfill_done";
/** Versioned: bump it when the correction's preconditions change so existing databases rerun it. */
const CORRECTION_MARKER = "cache_write_correction_v2_done";

export function opencodeDataDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const base =
    env.XDG_DATA_HOME || join(env.HOME ?? homedir(), ".local", "share");
  return join(base, "opencode");
}

export function resolveDbPath(
  options: Pick<StoreOptions, "dbPath"> = {},
): string {
  return options.dbPath ?? join(opencodeDataDir(), "cmon.db");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cost_entry (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_session_id TEXT,
  agent TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('step','compaction')),
  failed INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL,
  cache_write_extra_micros INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live','backfill'))
);
CREATE INDEX IF NOT EXISTS cost_entry_created_at ON cost_entry(created_at);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const INSERT_COLUMNS = `(id, session_id, parent_session_id, agent, provider_id, model_id, kind, failed, cost_micros, cache_write_extra_micros, created_at, source)
VALUES ($id, $sessionId, $parentSessionId, $agent, $providerId, $modelId, $kind, $failed, $costMicros, $cacheWriteExtraMicros, $createdAt, $source)`;

function bindings(row: CostRow, source: "live" | "backfill") {
  return {
    $id: row.id,
    $sessionId: row.sessionId,
    $parentSessionId: row.parentSessionId,
    $agent: row.agent,
    $providerId: row.providerId,
    $modelId: row.modelId,
    $kind: row.kind,
    $failed: row.failed ? 1 : 0,
    $costMicros: row.costMicros,
    $cacheWriteExtraMicros: row.cacheWriteExtraMicros,
    $createdAt: row.createdAt,
    $source: source,
  };
}

/** SQLite-backed cost ledger shared by every opencode server process on this machine. */
export class Store {
  private readonly db: Database;
  private revisionCounter = 0;

  constructor(options: StoreOptions = {}) {
    const path = resolveDbPath(options);
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    try {
      this.db.exec(
        `PRAGMA busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`,
      );
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
      this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private schemaVersion(): number {
    return (
      this.db.query("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
  }

  /**
   * Upgrades to the current schema. The version is re-read under an immediate write lock so
   * processes starting together upgrade exactly once.
   */
  private migrate(): void {
    if (this.schemaVersion() === CURRENT_SCHEMA_VERSION) return;
    this.db
      .transaction(() => {
        const version = this.schemaVersion();
        if (version > CURRENT_SCHEMA_VERSION) {
          throw new Error(
            `cmon.db schema version ${version} is newer than supported ${CURRENT_SCHEMA_VERSION}`,
          );
        }
        if (version === 0) this.db.exec(SCHEMA);
        if (version === 1) {
          this.db.exec(
            "ALTER TABLE cost_entry ADD COLUMN cache_write_extra_micros INTEGER NOT NULL DEFAULT 0",
          );
        }
        this.db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
      })
      .immediate();
  }

  /** Incremented on every change made through this instance; lets the TUI detect staleness. */
  revision(): number {
    return this.revisionCounter;
  }

  /**
   * Records a live event. Overwrites a backfilled row or a live row that only had fallback
   * attribution, but never degrades a correctly attributed live row (redelivery without `started`).
   */
  upsertLive(row: CostRow): void {
    this.db
      .query(
        `INSERT INTO cost_entry ${INSERT_COLUMNS}
         ON CONFLICT(id) DO UPDATE SET
           session_id = excluded.session_id, parent_session_id = excluded.parent_session_id,
           agent = excluded.agent, provider_id = excluded.provider_id, model_id = excluded.model_id,
           kind = excluded.kind, failed = excluded.failed, cost_micros = excluded.cost_micros,
           cache_write_extra_micros = CASE WHEN excluded.cache_write_extra_micros > 0
             THEN excluded.cache_write_extra_micros ELSE cost_entry.cache_write_extra_micros END,
           created_at = excluded.created_at, source = excluded.source
         WHERE cost_entry.source = 'backfill' OR cost_entry.agent = 'unknown'`,
      )
      .run(bindings(row, "live"));
    this.revisionCounter += 1;
  }

  isBackfillDone(): boolean {
    return this.getMeta(BACKFILL_MARKER) !== undefined;
  }

  /**
   * Inserts backfilled rows and sets the marker in one write transaction. The marker is re-checked
   * inside the lock so concurrent starters import once; returns false when another process won.
   */
  completeBackfill(rows: readonly CostRow[]): boolean {
    const insert = this.db.query(
      `INSERT OR IGNORE INTO cost_entry ${INSERT_COLUMNS}`,
    );
    const apply = this.db.transaction((): boolean => {
      if (this.isBackfillDone()) return false;
      for (const row of rows) insert.run(bindings(row, "backfill"));
      this.setMeta(BACKFILL_MARKER, String(Date.now()));
      return true;
    });
    const imported = apply.immediate();
    if (imported) this.revisionCounter += 1;
    return imported;
  }

  isCorrectionDone(): boolean {
    return this.getMeta(CORRECTION_MARKER) !== undefined;
  }

  /**
   * Sets the add-on of existing rows that still have none, then sets the marker, in one write
   * transaction. The marker is re-checked under the lock so concurrent processes apply it once;
   * returns whether any row changed.
   */
  applyCacheWriteCorrection(
    updates: ReadonlyArray<{ id: string; micros: number }>,
  ): boolean {
    const update = this.db.query(
      "UPDATE cost_entry SET cache_write_extra_micros = $micros WHERE id = $id AND cache_write_extra_micros = 0",
    );
    const apply = this.db.transaction((): boolean => {
      if (this.isCorrectionDone()) return false;
      let changed = 0;
      for (const { id, micros } of updates)
        changed += update.run({ $id: id, $micros: micros }).changes;
      this.setMeta(CORRECTION_MARKER, String(Date.now()));
      return changed > 0;
    });
    const changed = apply.immediate();
    if (changed) this.revisionCounter += 1;
    return changed;
  }

  /** Total and per-agent sums over `[from, to)`, largest agent first then by name. */
  summary(from: number, to: number): Summary {
    const agents = this.db
      .query(
        `SELECT agent, SUM(cost_micros + cache_write_extra_micros) AS micros FROM cost_entry
         WHERE created_at >= $from AND created_at < $to
         GROUP BY agent ORDER BY micros DESC, agent ASC`,
      )
      .all({ $from: from, $to: to }) as AgentTotal[];
    const totalMicros = agents.reduce((sum, entry) => sum + entry.micros, 0);
    return { revision: this.revisionCounter, totalMicros, agents };
  }

  /** Deletes rows older than `cutoff`; returns how many were removed. */
  prune(cutoff: number): number {
    const { changes } = this.db
      .query("DELETE FROM cost_entry WHERE created_at < $cutoff")
      .run({ $cutoff: cutoff });
    if (changes > 0) this.revisionCounter += 1;
    return changes;
  }

  private getMeta(key: string): string | undefined {
    const found = this.db
      .query("SELECT value FROM meta WHERE key = $key")
      .get({ $key: key }) as { value: string } | null;
    return found?.value;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .query(
        "INSERT INTO meta (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run({ $key: key, $value: value });
  }

  close(): void {
    this.db.close();
  }
}
