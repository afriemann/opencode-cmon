// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-recording/spec.md
// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-retention/spec.md
// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-display/spec.md
// spec: openspec/changes/add-model-breakdown/specs/cost-display/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-recording/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-retention/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-display/spec.md
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Store } from "./store";
import type { CostRow } from "./types";

let dir: string;
let dbPath: string;
const opened: Store[] = [];

function open(): Store {
  const store = new Store({ dbPath });
  opened.push(store);
  return store;
}

function row(overrides: Partial<CostRow> = {}): CostRow {
  return {
    id: "msg_1",
    sessionId: "ses_1",
    parentSessionId: null,
    agent: "build",
    providerId: "github-copilot",
    modelId: "claude-sonnet-4.6",
    kind: "step",
    failed: false,
    costMicros: 100_000,
    tokens: { input: 1, cacheRead: 2, cacheWrite: 3 },
    createdAt: 1_000,
    ...overrides,
  };
}

/** Total cost over a range from the SQL aggregates (add-on excluded). */
function total(store: Store, from = 0, to = 10_000): number {
  return store
    .summaryInputs(from, to)
    .agents.reduce((sum, a) => sum + a.micros, 0);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cmon-store-"));
  dbPath = join(dir, "cmon.db");
});

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("store", () => {
  test("Redelivered event does not double count", () => {
    const store = open();
    store.upsertLive(row());
    store.upsertLive(row());
    expect(total(store)).toBe(100_000);
  });

  test("a redelivered ended event without its start does not clobber a good live row", () => {
    const store = open();
    store.upsertLive(row({ agent: "build", createdAt: 500 }));
    store.upsertLive(row({ agent: "unknown", createdAt: 9_000 }));
    const stored = new Database(dbPath, { readonly: true })
      .query("SELECT agent, created_at AS t FROM cost_entry WHERE id = 'msg_1'")
      .get();
    expect(stored).toEqual({ agent: "build", t: 500 });
  });

  test("Two processes record the same event", () => {
    const a = open();
    const b = open();
    a.upsertLive(row());
    b.upsertLive(row());
    expect(total(a)).toBe(100_000);
  });

  test("Sub-agent cost is attributed to the sub-agent", () => {
    const store = open();
    store.upsertLive(
      row({
        id: "m1",
        agent: "explore",
        sessionId: "ses_child",
        parentSessionId: "ses_parent",
      }),
    );
    const stored = new Database(dbPath, { readonly: true })
      .query(
        "SELECT agent, parent_session_id AS p FROM cost_entry WHERE id = 'm1'",
      )
      .get();
    expect(stored).toEqual({ agent: "explore", p: "ses_parent" });
  });

  test("Range bounds are half-open", () => {
    const store = open();
    store.upsertLive(row({ id: "a", createdAt: 100, costMicros: 1 }));
    store.upsertLive(row({ id: "b", createdAt: 200, costMicros: 10 }));
    expect(total(store, 100, 200)).toBe(1);
  });

  test("summary groups per agent, largest first then by name", () => {
    const store = open();
    store.upsertLive(row({ id: "a", agent: "zeta", costMicros: 5 }));
    store.upsertLive(row({ id: "b", agent: "alpha", costMicros: 5 }));
    store.upsertLive(row({ id: "c", agent: "build", costMicros: 50 }));
    store.upsertLive(row({ id: "d", agent: "build", costMicros: 50 }));
    const { agents } = store.summaryInputs(0, 10_000);
    expect(
      agents
        .slice()
        .sort((a, b) => b.micros - a.micros || a.agent.localeCompare(b.agent)),
    ).toEqual([
      { agent: "build", micros: 100 },
      { agent: "alpha", micros: 5 },
      { agent: "zeta", micros: 5 },
    ]);
  });

  test("Models are grouped by provider and model", () => {
    const store = open();
    const m = (
      id: string,
      providerId: string,
      modelId: string,
      costMicros: number,
    ) => row({ id, providerId, modelId, costMicros });
    store.upsertLive(m("a", "p", "m1", 10));
    store.upsertLive(m("b", "p", "m1", 15));
    store.upsertLive(m("c", "p", "m2", 25));
    store.upsertLive(m("d", "q", "m1", 25));
    const { models } = store.summaryInputs(0, 10_000);
    expect(
      models.slice().sort((x, y) => x.model.localeCompare(y.model)),
    ).toEqual([
      { model: "p/m1", micros: 25 },
      { model: "p/m2", micros: 25 },
      { model: "q/m1", micros: 25 },
    ]);
  });

  test("Old rows are removed at startup", () => {
    const store = open();
    store.upsertLive(row({ id: "old", createdAt: 10 }));
    store.upsertLive(row({ id: "new", createdAt: 1_000 }));
    expect(store.prune(500)).toBe(1);
    expect(total(store)).toBe(100_000);
  });

  test("Live data wins over backfilled data", () => {
    const store = open();
    store.completeBackfill([row({ costMicros: 1 })]);
    store.upsertLive(row({ costMicros: 2 }));
    expect(total(store)).toBe(2);
  });

  test("backfill never overwrites an existing live row", () => {
    const store = open();
    store.upsertLive(row({ costMicros: 2 }));
    store.completeBackfill([row({ costMicros: 1 })]);
    expect(total(store)).toBe(2);
  });

  test("Simultaneous starts import once", () => {
    const a = open();
    const b = open();
    const rows = [row({ id: "x" }), row({ id: "y" })];
    expect(a.completeBackfill(rows)).toBe(true);
    expect(b.completeBackfill(rows)).toBe(false);
    expect(total(a)).toBe(200_000);
    expect(b.isBackfillDone()).toBe(true);
  });

  describe("tokens", () => {
    const stored = (id = "msg_1") =>
      new Database(dbPath, { readonly: true })
        .query(
          "SELECT tokens_input i, tokens_cache_read r, tokens_cache_write w FROM cost_entry WHERE id = $id",
        )
        .get({ $id: id });

    test("Step tokens are stored", () => {
      open().upsertLive(row());
      expect(stored()).toEqual({ i: 1, r: 2, w: 3 });
    });

    test("Compaction without tokens stores NULL", () => {
      open().upsertLive(row({ tokens: null }));
      expect(stored()).toEqual({ i: null, r: null, w: null });
    });

    test("A redelivery keeps stored tokens", () => {
      const store = open();
      store.upsertLive(row({ agent: "unknown" }));
      store.upsertLive(row({ agent: "build", tokens: null }));
      expect(stored()).toEqual({ i: 1, r: 2, w: 3 });
    });

    test("Backfill stores tokens", () => {
      open().completeBackfill([
        row({ tokens: { input: 7, cacheRead: 8, cacheWrite: 9 } }),
      ]);
      expect(stored()).toEqual({ i: 7, r: 8, w: 9 });
    });

    test("candidates are Copilot rows in range with cache writes or unknown tokens", () => {
      const store = open();
      store.upsertLive(
        row({ id: "a", tokens: { input: 1, cacheRead: 1, cacheWrite: 0 } }),
      );
      store.upsertLive(row({ id: "b" }));
      store.upsertLive(row({ id: "c", tokens: null }));
      store.upsertLive(row({ id: "d", providerId: "openrouter" }));
      store.upsertLive(row({ id: "e", createdAt: 99_999 }));
      const { candidates } = store.summaryInputs(0, 10_000);
      expect(candidates.map((c) => c.modelId)).toHaveLength(2);
      expect(candidates.some((c) => c.tokens === null)).toBe(true);
      expect(candidates.some((c) => c.tokens?.cacheWrite === 3)).toBe(true);
    });
  });

  describe("token fill", () => {
    test("idsMissingTokens lists NULL-token rows since a cutoff", () => {
      const store = open();
      store.upsertLive(row({ id: "a", tokens: null, createdAt: 50 }));
      store.upsertLive(row({ id: "b", tokens: null, createdAt: 500 }));
      store.upsertLive(row({ id: "c" }));
      expect(store.idsMissingTokens(100)).toEqual(["b"]);
    });

    test("Fill sets tokens only where still NULL and bumps the revision", () => {
      const store = open();
      store.upsertLive(row({ id: "a", tokens: null }));
      store.upsertLive(row({ id: "b" }));
      const before = store.revision();
      const changed = store.fillTokens([
        { id: "a", tokens: { input: 4, cacheRead: 5, cacheWrite: 6 } },
        { id: "b", tokens: { input: 9, cacheRead: 9, cacheWrite: 9 } },
      ]);
      expect(changed).toBe(1);
      expect(store.revision()).toBeGreaterThan(before);
      expect(store.idsMissingTokens(0)).toEqual([]);
      expect(
        store.fillTokens([
          { id: "a", tokens: { input: 0, cacheRead: 0, cacheWrite: 0 } },
        ]),
      ).toBe(0);
    });

    test("Concurrent fills apply once", () => {
      const a = open();
      const b = open();
      a.upsertLive(row({ id: "a", tokens: null }));
      const update = [
        { id: "a", tokens: { input: 1, cacheRead: 1, cacheWrite: 1 } },
      ];
      expect([a.fillTokens(update), b.fillTokens(update)]).toEqual([1, 0]);
    });
  });

  describe("schema upgrade", () => {
    const V1 = `
      CREATE TABLE cost_entry (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, parent_session_id TEXT, agent TEXT NOT NULL,
        provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('step','compaction')), failed INTEGER NOT NULL DEFAULT 0,
        cost_micros INTEGER NOT NULL, created_at INTEGER NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('live','backfill'))
      );
      CREATE INDEX cost_entry_created_at ON cost_entry(created_at);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO cost_entry VALUES ('old','s',NULL,'build','p','m','step',0,5,100,'live');
    `;

    function createOld(version: 1 | 2): void {
      const raw = new Database(dbPath, { create: true });
      raw.exec(V1);
      if (version === 2) {
        raw.exec(
          "ALTER TABLE cost_entry ADD COLUMN cache_write_extra_micros INTEGER NOT NULL DEFAULT 0",
        );
      }
      raw.exec(`PRAGMA user_version = ${version}`);
      raw.close();
    }

    const columns = (): string[] => {
      const raw = new Database(dbPath, { readonly: true });
      const names = (
        raw.query("PRAGMA table_info(cost_entry)").all() as Array<{
          name: string;
        }>
      ).map((c) => c.name);
      raw.close();
      return names;
    };
    const version = (): unknown => {
      const raw = new Database(dbPath, { readonly: true });
      const v = raw.query("PRAGMA user_version").get();
      raw.close();
      return v;
    };

    test("Version 1 database is upgraded", () => {
      createOld(1);
      const store = open();
      expect(total(store, 0, 1_000)).toBe(5);
      expect(store.idsMissingTokens(0)).toEqual(["old"]);
      expect(version()).toEqual({ user_version: 3 });
      expect(columns().filter((n) => n === "tokens_cache_write")).toHaveLength(
        1,
      );
    });

    test("Version 2 database is upgraded", () => {
      createOld(2);
      const store = open();
      expect(total(store, 0, 1_000)).toBe(5);
      expect(store.idsMissingTokens(0)).toEqual(["old"]);
      expect(columns()).toContain("cache_write_extra_micros");
      expect(version()).toEqual({ user_version: 3 });
    });

    test("a fresh database is created at version 3", () => {
      open();
      expect(columns()).toEqual(
        expect.arrayContaining([
          "tokens_input",
          "tokens_cache_read",
          "tokens_cache_write",
        ]),
      );
      expect(version()).toEqual({ user_version: 3 });
    });

    test("Concurrent upgrades both succeed", () => {
      createOld(2);
      const a = open();
      const b = open();
      expect(total(a, 0, 1_000)).toBe(5);
      expect(total(b, 0, 1_000)).toBe(5);
      expect(columns().filter((n) => n === "tokens_input")).toHaveLength(1);
    });
  });

  test("Newer schema is refused", () => {
    open().close();
    const raw = new Database(dbPath);
    raw.exec("PRAGMA user_version = 99");
    raw.close();
    expect(() => new Store({ dbPath })).toThrow();
  });

  test("revision increases on every write and prune that deletes", () => {
    const store = open();
    const r0 = store.revision();
    store.upsertLive(row());
    const r1 = store.revision();
    store.prune(1_000_000);
    expect(r1).toBeGreaterThan(r0);
    expect(store.revision()).toBeGreaterThan(r1);
  });
});
