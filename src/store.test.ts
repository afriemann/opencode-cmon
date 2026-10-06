// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-recording/spec.md
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

  test("refuses a database written by a newer schema", () => {
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
