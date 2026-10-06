import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { COPILOT_PROVIDER, type TokenCounts } from "./pricing";
import type {
  AgentTotal,
  Candidate,
  CostRow,
  ModelTotal,
  ProviderTotal,
} from "./types";

export interface StoreOptions {
  dbPath?: string;
  busyTimeoutMs?: number;
}

/** Bumped whenever the on-disk schema changes. */
export const CURRENT_SCHEMA_VERSION = 3;

const TOKEN_COLUMNS = [
  "tokens_input",
  "tokens_cache_read",
  "tokens_cache_write",
] as const;
const DEFAULT_BUSY_TIMEOUT_MS = 5000;
const BACKFILL_MARKER = "backfill_done";

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

// `cache_write_extra_micros` is unused since pricing moved to read time. It stays because dropping
// a column would break older plugin processes that are still running and need SQLite >= 3.35.
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
  tokens_input INTEGER,
  tokens_cache_read INTEGER,
  tokens_cache_write INTEGER,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live','backfill'))
);
CREATE INDEX IF NOT EXISTS cost_entry_created_at ON cost_entry(created_at);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const INSERT_COLUMNS = `(id, session_id, parent_session_id, agent, provider_id, model_id, kind, failed, cost_micros, tokens_input, tokens_cache_read, tokens_cache_write, created_at, source)
VALUES ($id, $sessionId, $parentSessionId, $agent, $providerId, $modelId, $kind, $failed, $costMicros, $tokensInput, $tokensCacheRead, $tokensCacheWrite, $createdAt, $source)`;

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
    $tokensInput: row.tokens?.input ?? null,
    $tokensCacheRead: row.tokens?.cacheRead ?? null,
    $tokensCacheWrite: row.tokens?.cacheWrite ?? null,
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
        else {
          if (version < 2) {
            this.db.exec(
              "ALTER TABLE cost_entry ADD COLUMN cache_write_extra_micros INTEGER NOT NULL DEFAULT 0",
            );
          }
          if (version < 3) {
            for (const column of TOKEN_COLUMNS) {
              this.db.exec(
                `ALTER TABLE cost_entry ADD COLUMN ${column} INTEGER`,
              );
            }
          }
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
           tokens_input = COALESCE(excluded.tokens_input, cost_entry.tokens_input),
           tokens_cache_read = COALESCE(excluded.tokens_cache_read, cost_entry.tokens_cache_read),
           tokens_cache_write = COALESCE(excluded.tokens_cache_write, cost_entry.tokens_cache_write),
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

  /** Ids of rows in the retention window whose token counts are unknown. */
  idsMissingTokens(since: number): string[] {
    return (
      this.db
        .query(
          "SELECT id FROM cost_entry WHERE tokens_cache_write IS NULL AND created_at >= $since ORDER BY id",
        )
        .all({ $since: since }) as Array<{ id: string }>
    ).map((entry) => entry.id);
  }

  /**
   * Sets token counts on rows that still have none, in one short write transaction, so concurrent
   * fills apply once. Returns how many rows changed.
   */
  fillTokens(
    updates: ReadonlyArray<{ id: string; tokens: TokenCounts }>,
  ): number {
    const update = this.db.query(
      `UPDATE cost_entry SET tokens_input = $input, tokens_cache_read = $read, tokens_cache_write = $write
       WHERE id = $id AND tokens_cache_write IS NULL`,
    );
    const apply = this.db.transaction((): number => {
      let changed = 0;
      for (const { id, tokens } of updates) {
        changed += update.run({
          $id: id,
          $input: tokens.input,
          $read: tokens.cacheRead,
          $write: tokens.cacheWrite,
        }).changes;
      }
      return changed;
    });
    const changed = apply.immediate();
    if (changed > 0) this.revisionCounter += 1;
    return changed;
  }

  private totalsBy<T>(
    column: string,
    alias: string,
    from: number,
    to: number,
  ): T[] {
    return this.db
      .query(
        `SELECT ${column} AS ${alias}, SUM(cost_micros) AS micros FROM cost_entry
         WHERE created_at >= $from AND created_at < $to GROUP BY ${alias}`,
      )
      .all({ $from: from, $to: to }) as T[];
  }

  /**
   * Per-agent, per-model-id and per-provider sums of opencode's own cost over `[from, to)` plus the rows
   * that may carry a cache-write cost, read in one snapshot so they agree. Ordering and the add-on
   * are applied in code (`buildSummary`).
   */
  summaryInputs(
    from: number,
    to: number,
  ): {
    revision: number;
    agents: AgentTotal[];
    models: ModelTotal[];
    providers: ProviderTotal[];
    candidates: Candidate[];
  } {
    const read = this.db.transaction(() => {
      const agents = this.totalsBy<AgentTotal>("agent", "agent", from, to);
      const models = this.totalsBy<ModelTotal>("model_id", "model", from, to);
      const providers = this.totalsBy<ProviderTotal>(
        "provider_id",
        "provider",
        from,
        to,
      );
      const rows = this.db
        .query(
          `SELECT agent, provider_id, model_id, tokens_input, tokens_cache_read, tokens_cache_write
           FROM cost_entry WHERE created_at >= $from AND created_at < $to
             AND provider_id = $provider
             AND (tokens_cache_write > 0 OR tokens_cache_write IS NULL)`,
        )
        .all({ $from: from, $to: to, $provider: COPILOT_PROVIDER }) as Array<{
        agent: string;
        provider_id: string;
        model_id: string;
        tokens_input: number | null;
        tokens_cache_read: number | null;
        tokens_cache_write: number | null;
      }>;
      const candidates = rows.map((row): Candidate => ({
        agent: row.agent,
        providerId: row.provider_id,
        modelId: row.model_id,
        tokens:
          row.tokens_cache_write === null
            ? null
            : {
                input: row.tokens_input ?? 0,
                cacheRead: row.tokens_cache_read ?? 0,
                cacheWrite: row.tokens_cache_write,
              },
      }));
      return { agents, models, providers, candidates };
    });
    return { revision: this.revisionCounter, ...read.deferred() };
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
