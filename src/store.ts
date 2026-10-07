import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { COPILOT_PROVIDER, type TokenCounts } from "./pricing";
import type {
  AgentTotal,
  Candidate,
  CostRow,
  EntryKind,
  ModelTotal,
  ProviderTotal,
} from "./types";

/** Narrows the rows an analysis reads. `[from, to)` is half-open epoch milliseconds. */
export interface RowFilter {
  readonly from: number;
  readonly to: number;
  readonly agent?: string;
  readonly model?: string;
  readonly provider?: string;
  readonly kind?: EntryKind;
  /** A session id; its descendant sessions are included unless `includeSubagents` is false. */
  readonly session?: string;
  readonly includeSubagents?: boolean;
  /** An absolute directory; rows in it or below it (at a path boundary) match. */
  readonly project?: string;
}

export interface FilteredRows {
  readonly rows: CostRow[];
  /** Rows that match every filter except `project` but have no known directory; empty without a project filter. */
  readonly unknownDirectory: CostRow[];
}

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
/**
 * Nullable columns added without a schema version bump, so an older plugin process that opens the
 * file keeps working (it ignores them). `details_checked` marks a row the detail fill has handled.
 */
const DETAIL_COLUMNS = [
  ["tokens_output", "INTEGER"],
  ["tokens_reasoning", "INTEGER"],
  ["finish", "TEXT"],
  ["directory", "TEXT"],
  ["details_checked", "INTEGER"],
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

const INSERT_COLUMNS = `(id, session_id, parent_session_id, agent, provider_id, model_id, kind, failed, cost_micros, tokens_input, tokens_cache_read, tokens_cache_write, tokens_output, tokens_reasoning, finish, directory, details_checked, created_at, source)
VALUES ($id, $sessionId, $parentSessionId, $agent, $providerId, $modelId, $kind, $failed, $costMicros, $tokensInput, $tokensCacheRead, $tokensCacheWrite, $tokensOutput, $tokensReasoning, $finish, $directory, $detailsChecked, $createdAt, $source)`;

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
    $tokensOutput: row.outputTokens,
    $tokensReasoning: row.reasoningTokens,
    $finish: row.finish,
    $directory: row.directory,
    // A row with its details known needs no fill; otherwise the fill gets one attempt.
    $detailsChecked:
      row.outputTokens !== null && row.directory !== null ? 1 : null,
    $createdAt: row.createdAt,
    $source: source,
  };
}

/** Directory equals `$project` or lies below it at a path boundary (no LIKE, so no escaping). */
const PROJECT_MATCH = `(directory = $project OR substr(directory, 1, length($project) + 1) = $project || '/'
  OR ($project = '/' AND substr(directory, 1, 1) = '/'))`;

function normaliseProject(project: string): string {
  const trimmed = project.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

interface StoredRow {
  id: string;
  session_id: string;
  parent_session_id: string | null;
  agent: string;
  provider_id: string;
  model_id: string;
  kind: EntryKind;
  failed: number;
  cost_micros: number;
  tokens_input: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  tokens_output: number | null;
  tokens_reasoning: number | null;
  finish: string | null;
  directory: string | null;
  created_at: number;
}

function toCostRow(row: StoredRow): CostRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    parentSessionId: row.parent_session_id,
    agent: row.agent,
    providerId: row.provider_id,
    modelId: row.model_id,
    kind: row.kind,
    failed: row.failed === 1,
    costMicros: row.cost_micros,
    tokens:
      row.tokens_cache_write === null
        ? null
        : {
            input: row.tokens_input ?? 0,
            cacheRead: row.tokens_cache_read ?? 0,
            cacheWrite: row.tokens_cache_write,
          },
    outputTokens: row.tokens_output,
    reasoningTokens: row.tokens_reasoning,
    finish: row.finish,
    directory: row.directory,
    createdAt: row.created_at,
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
    if (this.schemaVersion() !== CURRENT_SCHEMA_VERSION) this.migrateVersion();
    this.ensureDetailColumns();
  }

  private columnNames(): Set<string> {
    return new Set(
      (
        this.db.query("PRAGMA table_info(cost_entry)").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
  }

  /** Adds missing detail columns; the column list is re-read under the write lock so each is added once. */
  private ensureDetailColumns(): void {
    const missing = (): (typeof DETAIL_COLUMNS)[number][] =>
      DETAIL_COLUMNS.filter(([name]) => !this.columnNames().has(name));
    if (missing().length === 0) return;
    this.db
      .transaction(() => {
        for (const [name, type] of missing())
          this.db.exec(`ALTER TABLE cost_entry ADD COLUMN ${name} ${type}`);
      })
      .immediate();
  }

  private migrateVersion(): void {
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
           tokens_output = COALESCE(excluded.tokens_output, cost_entry.tokens_output),
           tokens_reasoning = COALESCE(excluded.tokens_reasoning, cost_entry.tokens_reasoning),
           finish = COALESCE(excluded.finish, cost_entry.finish),
           directory = COALESCE(excluded.directory, cost_entry.directory),
           details_checked = COALESCE(excluded.details_checked, cost_entry.details_checked),
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

  /** Ids of rows in the retention window the detail fill has not handled yet. */
  idsMissingDetails(since: number): string[] {
    return (
      this.db
        .query(
          "SELECT id FROM cost_entry WHERE details_checked IS NULL AND created_at >= $since ORDER BY id",
        )
        .all({ $since: since }) as Array<{ id: string }>
    ).map((entry) => entry.id);
  }

  /**
   * Applies source details to rows not yet handled and marks them handled, in one short write
   * transaction so concurrent fills apply once. Values already stored are kept. `errored` marks an
   * imported step as failed (live rows are already correct). Returns how many rows were handled.
   */
  fillDetails(
    updates: ReadonlyArray<{
      id: string;
      outputTokens: number | null;
      reasoningTokens: number | null;
      finish: string | null;
      directory: string | null;
      errored: boolean;
    }>,
  ): number {
    const update = this.db.query(
      `UPDATE cost_entry SET
         tokens_output = COALESCE(tokens_output, $output),
         tokens_reasoning = COALESCE(tokens_reasoning, $reasoning),
         finish = COALESCE(finish, $finish),
         directory = COALESCE(directory, $directory),
         failed = CASE WHEN $errored = 1 AND source = 'backfill' AND kind = 'step' THEN 1 ELSE failed END,
         details_checked = 1
       WHERE id = $id AND details_checked IS NULL`,
    );
    const apply = this.db.transaction((): number => {
      let changed = 0;
      for (const entry of updates) {
        changed += update.run({
          $id: entry.id,
          $output: entry.outputTokens,
          $reasoning: entry.reasoningTokens,
          $finish: entry.finish,
          $directory: entry.directory,
          $errored: entry.errored ? 1 : 0,
        }).changes;
      }
      return changed;
    });
    const changed = apply.immediate();
    if (changed > 0) this.revisionCounter += 1;
    return changed;
  }

  /** Rows in the retention window matching `filter`, read in one snapshot. */
  filteredRows(filter: RowFilter): FilteredRows {
    const conditions = ["created_at >= $from", "created_at < $to"];
    const params: Record<string, string | number> = {
      $from: filter.from,
      $to: filter.to,
    };
    const equals: ReadonlyArray<[string, string, string | undefined]> = [
      ["agent", "$agent", filter.agent],
      ["model_id", "$model", filter.model],
      ["provider_id", "$provider", filter.provider],
      ["kind", "$kind", filter.kind],
    ];
    for (const [column, name, value] of equals) {
      if (value === undefined) continue;
      conditions.push(`${column} = ${name}`);
      params[name] = value;
    }
    let withTree = "";
    if (filter.session !== undefined) {
      params.$session = filter.session;
      if (filter.includeSubagents === false) {
        conditions.push("session_id = $session");
      } else {
        withTree = `WITH RECURSIVE tree(id) AS (
          SELECT $session
          UNION
          SELECT c.session_id FROM cost_entry c JOIN tree t ON c.parent_session_id = t.id
        )`;
        conditions.push("session_id IN (SELECT id FROM tree)");
      }
    }
    const where = conditions.join(" AND ");
    const select = `${withTree} SELECT id, session_id, parent_session_id, agent, provider_id, model_id, kind, failed,
        cost_micros, tokens_input, tokens_cache_read, tokens_cache_write, tokens_output, tokens_reasoning,
        finish, directory, created_at FROM cost_entry`;
    const read = this.db.transaction((): FilteredRows => {
      const query = (extra: string, bind: Record<string, string> = {}) =>
        (
          this.db
            .query(`${select} WHERE ${where}${extra} ORDER BY created_at, id`)
            .all({ ...params, ...bind }) as StoredRow[]
        ).map(toCostRow);
      if (filter.project === undefined)
        return { rows: query(""), unknownDirectory: [] };
      return {
        rows: query(` AND ${PROJECT_MATCH}`, {
          $project: normaliseProject(filter.project),
        }),
        unknownDirectory: query(" AND directory IS NULL"),
      };
    });
    return read.deferred();
  }

  /**
   * Milliseconds since the previous step of the same session for each row (null when none). The
   * predecessor is looked up among all of the session's steps, so filters never lengthen a gap.
   */
  stepGaps(rows: readonly CostRow[]): Map<string, number | null> {
    const gaps = new Map<string, number | null>();
    const sessions = [...new Set(rows.map((row) => row.sessionId))];
    const query = this.db.query(
      "SELECT created_at FROM cost_entry WHERE session_id = $session AND kind = 'step' ORDER BY created_at",
    );
    const stepTimes = new Map<string, number[]>();
    for (const session of sessions)
      stepTimes.set(
        session,
        (query.all({ $session: session }) as Array<{ created_at: number }>).map(
          (entry) => entry.created_at,
        ),
      );
    for (const row of rows) {
      const times = stepTimes.get(row.sessionId) ?? [];
      // Largest step time strictly before this row (times are ascending).
      let low = 0;
      let high = times.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if ((times[mid] ?? 0) < row.createdAt) low = mid + 1;
        else high = mid;
      }
      const earlier = times[low - 1];
      gaps.set(row.id, earlier === undefined ? null : row.createdAt - earlier);
    }
    return gaps;
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
