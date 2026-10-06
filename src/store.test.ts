// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-recording/spec.md
// spec: openspec/changes/account-for-cache-writes/specs/cost-recording/spec.md
// spec: openspec/changes/account-for-cache-writes/specs/cost-retention/spec.md
// spec: openspec/changes/account-for-cache-writes/specs/cost-display/spec.md
// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-retention/spec.md
// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-display/spec.md
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
    cacheWriteExtraMicros: 0,
    createdAt: 1_000,
    ...overrides,
  };
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
    expect(store.summary(0, 10_000).totalMicros).toBe(100_000);
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
    expect(a.summary(0, 10_000).totalMicros).toBe(100_000);
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
    expect(store.summary(100, 200).totalMicros).toBe(1);
  });

  test("summary groups per agent, largest first then by name", () => {
    const store = open();
    store.upsertLive(row({ id: "a", agent: "zeta", costMicros: 5 }));
    store.upsertLive(row({ id: "b", agent: "alpha", costMicros: 5 }));
    store.upsertLive(row({ id: "c", agent: "build", costMicros: 50 }));
    store.upsertLive(row({ id: "d", agent: "build", costMicros: 50 }));
    expect(store.summary(0, 10_000)).toMatchObject({
      totalMicros: 110,
      agents: [
        { agent: "build", micros: 100 },
        { agent: "alpha", micros: 5 },
        { agent: "zeta", micros: 5 },
      ],
    });
  });

  test("Old rows are removed at startup", () => {
    const store = open();
    store.upsertLive(row({ id: "old", createdAt: 10 }));
    store.upsertLive(row({ id: "new", createdAt: 1_000 }));
    expect(store.prune(500)).toBe(1);
    expect(store.summary(0, 10_000).totalMicros).toBe(100_000);
  });

  test("Live data wins over backfilled data", () => {
    const store = open();
    store.completeBackfill([row({ costMicros: 1 })]);
    store.upsertLive(row({ costMicros: 2 }));
    expect(store.summary(0, 10_000).totalMicros).toBe(2);
  });

  test("backfill never overwrites an existing live row", () => {
    const store = open();
    store.upsertLive(row({ costMicros: 2 }));
    store.completeBackfill([row({ costMicros: 1 })]);
    expect(store.summary(0, 10_000).totalMicros).toBe(2);
  });

  test("Simultaneous starts import once", () => {
    const a = open();
    const b = open();
    const rows = [row({ id: "x" }), row({ id: "y" })];
    expect(a.completeBackfill(rows)).toBe(true);
    expect(b.completeBackfill(rows)).toBe(false);
    expect(a.summary(0, 10_000).totalMicros).toBe(200_000);
    expect(b.isBackfillDone()).toBe(true);
  });

  test("Summary shows the corrected figure", () => {
    const store = open();
    store.upsertLive(
      row({ costMicros: 100_000, cacheWriteExtraMicros: 50_000 }),
    );
    expect(store.summary(0, 10_000)).toMatchObject({
      totalMicros: 150_000,
      agents: [{ agent: "build", micros: 150_000 }],
    });
  });

  test("A redelivery with zero add-on keeps the stored add-on", () => {
    const store = open();
    store.upsertLive(row({ agent: "unknown", cacheWriteExtraMicros: 7 }));
    store.upsertLive(row({ agent: "build", cacheWriteExtraMicros: 0 }));
    expect(store.summary(0, 10_000).totalMicros).toBe(100_007);
  });

  test("backfill stores the add-on", () => {
    const store = open();
    store.completeBackfill([row({ cacheWriteExtraMicros: 11 })]);
    expect(store.summary(0, 10_000).totalMicros).toBe(100_011);
  });

  describe("schema upgrade", () => {
    function createV1(): void {
      const raw = new Database(dbPath, { create: true });
      raw.exec(`
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
        PRAGMA user_version = 1;
      `);
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

    test("Version 1 database is upgraded", () => {
      createV1();
      const store = open();
      expect(store.summary(0, 1_000).totalMicros).toBe(5);
      expect(
        columns().filter((n) => n === "cache_write_extra_micros"),
      ).toHaveLength(1);
      const raw = new Database(dbPath, { readonly: true });
      expect(raw.query("PRAGMA user_version").get()).toEqual({
        user_version: 2,
      });
      raw.close();
    });

    test("a fresh database is created at version 2", () => {
      open();
      expect(columns()).toContain("cache_write_extra_micros");
    });

    test("Concurrent upgrades both succeed", () => {
      createV1();
      const a = open();
      const b = open();
      expect(a.summary(0, 1_000).totalMicros).toBe(5);
      expect(b.summary(0, 1_000).totalMicros).toBe(5);
      expect(
        columns().filter((n) => n === "cache_write_extra_micros"),
      ).toHaveLength(1);
    });
  });

  describe("cache-write correction", () => {
    test("Existing rows are corrected", () => {
      const store = open();
      store.upsertLive(row({ id: "a" }));
      store.completeBackfill([row({ id: "b" })]);
      const before = store.revision();
      expect(
        store.applyCacheWriteCorrection(
          [
            { id: "a", micros: 10 },
            { id: "b", micros: 20 },
          ],
          true,
        ),
      ).toBe(2);
      expect(store.summary(0, 10_000).totalMicros).toBe(200_030);
      expect(store.revision()).toBeGreaterThan(before);
      expect(store.isCorrectionDone()).toBe(true);
    });

    test("Correction is idempotent", () => {
      const store = open();
      store.upsertLive(row({ id: "a" }));
      store.applyCacheWriteCorrection([{ id: "a", micros: 10 }], true);
      expect(
        store.applyCacheWriteCorrection([{ id: "a", micros: 99 }], true),
      ).toBe(0);
      expect(store.summary(0, 10_000).totalMicros).toBe(100_010);
    });

    test("only zero add-ons are overwritten and unknown ids are ignored", () => {
      const store = open();
      store.upsertLive(row({ id: "a", cacheWriteExtraMicros: 5 }));
      store.applyCacheWriteCorrection(
        [
          { id: "a", micros: 10 },
          { id: "ghost", micros: 1 },
        ],
        true,
      );
      expect(store.summary(0, 10_000).totalMicros).toBe(100_005);
    });

    test("An incomplete correction applies rows but leaves the marker unset", () => {
      const store = open();
      store.upsertLive(row({ id: "a" }));
      expect(
        store.applyCacheWriteCorrection([{ id: "a", micros: 10 }], false),
      ).toBe(1);
      expect(store.isCorrectionDone()).toBe(false);
      expect(store.summary(0, 10_000).totalMicros).toBe(100_010);
    });

    test("Concurrent corrections apply once", () => {
      const a = open();
      const b = open();
      a.upsertLive(row({ id: "a" }));
      expect(a.applyCacheWriteCorrection([{ id: "a", micros: 10 }], true)).toBe(
        1,
      );
      expect(b.applyCacheWriteCorrection([{ id: "a", micros: 10 }], true)).toBe(
        0,
      );
      expect(b.summary(0, 10_000).totalMicros).toBe(100_010);
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
