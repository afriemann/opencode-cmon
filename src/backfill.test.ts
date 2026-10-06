// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-retention/spec.md
// spec: openspec/changes/account-for-cache-writes/specs/cost-retention/spec.md
// spec: openspec/changes/fix-correction-marker/specs/cost-retention/spec.md
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { runBackfill, runCacheWriteCorrection } from "./backfill";
import { parseCatalog, type PriceTable } from "./pricing";
import { Store } from "./store";

const TOKENS = {
  input: 1,
  output: 1,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};
const MODEL = { providerID: "github-copilot", id: "claude-sonnet-4.6" };
const NOW = 2_000_000;
const CUTOFF = 1_000_000;

let dir: string;
let sourcePath: string;
let store: Store;
const logs: string[] = [];
const log = (message: string) => logs.push(message);
const NO_PRICES: PriceTable = new Map();
const PRICES = parseCatalog([
  {
    id: "claude-sonnet-4.6",
    providerID: "github-copilot",
    family: "claude-sonnet",
    cost: [{ input: 2, output: 10, cache: { read: 0.2, write: 0 } }],
  },
]);
const WRITE_TOKENS = {
  input: 1,
  output: 1,
  reasoning: 0,
  cache: { read: 0, write: 1_000_000 },
};

function createSource(): Database {
  const db = new Database(sourcePath, { create: true });
  db.exec(`
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT);
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
      seq INTEGER NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL
    );
  `);
  return db;
}

let seq = 0;
function addMessage(
  db: Database,
  id: string,
  session: string,
  type: string,
  time: number,
  data: object,
): void {
  db.query("INSERT INTO session_message VALUES ($id,$s,$t,$q,$c,$d)").run({
    $id: id,
    $s: session,
    $t: type,
    $q: (seq += 1),
    $c: time,
    $d: JSON.stringify(data),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cmon-backfill-"));
  sourcePath = join(dir, "opencode.db");
  store = new Store({ dbPath: join(dir, "cmon.db") });
  logs.length = 0;
  seq = 0;
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("backfill", () => {
  test("First start imports history", () => {
    const db = createSource();
    db.query(
      "INSERT INTO session_v2 VALUES ('ses_p', NULL), ('ses_c', 'ses_p')",
    ).run();
    addMessage(db, "msg_a", "ses_p", "assistant", NOW, {
      agent: "build",
      model: MODEL,
      cost: 0.5,
      tokens: TOKENS,
      time: { created: NOW },
    });
    addMessage(db, "msg_b", "ses_c", "assistant", NOW, {
      agent: "explore",
      model: MODEL,
      cost: 0.25,
      tokens: TOKENS,
      time: { created: NOW },
    });
    addMessage(db, "msg_comp", "ses_p", "compaction", NOW + 1, {
      status: "completed",
      model: MODEL,
      cost: 0.1,
      tokens: TOKENS,
      time: { created: NOW + 1 },
    });
    db.close();

    runBackfill(store, { sourcePath, cutoff: CUTOFF, prices: NO_PRICES, log });

    expect(store.isBackfillDone()).toBe(true);
    expect(store.summary(0, 3_000_000)).toMatchObject({
      totalMicros: 850_000,
      agents: [
        { agent: "build", micros: 600_000 },
        { agent: "explore", micros: 250_000 },
      ],
    });
    const check = new Database(join(dir, "cmon.db"), { readonly: true });
    expect(
      check
        .query(
          "SELECT parent_session_id p, kind FROM cost_entry WHERE id='msg_b'",
        )
        .get(),
    ).toEqual({
      p: "ses_p",
      kind: "step",
    });
    check.close();
  });

  test("skips rows outside the window and rows without cost or tokens", () => {
    const db = createSource();
    addMessage(db, "old", "s", "assistant", CUTOFF - 1, {
      agent: "a",
      model: MODEL,
      cost: 1,
      tokens: TOKENS,
      time: { created: CUTOFF - 1 },
    });
    addMessage(db, "nocost", "s", "assistant", NOW, {
      agent: "a",
      model: MODEL,
      tokens: TOKENS,
      time: { created: NOW },
    });
    addMessage(db, "nocomp", "s", "compaction", NOW, {
      status: "completed",
      time: { created: NOW },
    });
    db.close();
    runBackfill(store, { sourcePath, cutoff: CUTOFF, prices: NO_PRICES, log });
    expect(store.summary(0, 3_000_000).totalMicros).toBe(0);
    expect(store.isBackfillDone()).toBe(true);
  });

  test("a compaction takes the agent of the preceding step in its session", () => {
    const db = createSource();
    addMessage(db, "m1", "s", "assistant", NOW, {
      agent: "build",
      model: MODEL,
      cost: 0.1,
      tokens: TOKENS,
      time: { created: NOW },
    });
    addMessage(db, "c1", "s", "compaction", NOW + 1, {
      status: "completed",
      model: MODEL,
      cost: 0.2,
      tokens: TOKENS,
      time: { created: NOW + 1 },
    });
    addMessage(db, "c2", "lonely", "compaction", NOW + 1, {
      status: "completed",
      model: MODEL,
      cost: 0.2,
      tokens: TOKENS,
      time: { created: NOW + 1 },
    });
    db.close();
    runBackfill(store, { sourcePath, cutoff: CUTOFF, prices: NO_PRICES, log });
    expect(store.summary(0, 3_000_000).agents).toEqual([
      { agent: "build", micros: 300_000 },
      { agent: "compaction", micros: 200_000 },
    ]);
  });

  test("Second start does not re-import", () => {
    runBackfill(store, {
      sourcePath: join(dir, "missing.db"),
      cutoff: CUTOFF,
      prices: NO_PRICES,
      log,
    });
    store.completeBackfill([]);
    logs.length = 0;
    runBackfill(store, {
      sourcePath: join(dir, "missing.db"),
      cutoff: CUTOFF,
      prices: NO_PRICES,
      log,
    });
    expect(logs).toEqual([]);
  });

  test("Schema mismatch fails soft", () => {
    const db = new Database(sourcePath, { create: true });
    db.exec("CREATE TABLE unrelated (x INTEGER)");
    db.close();
    expect(() =>
      runBackfill(store, {
        sourcePath,
        cutoff: CUTOFF,
        prices: NO_PRICES,
        log,
      }),
    ).not.toThrow();
    expect(store.isBackfillDone()).toBe(false);
    expect(logs.length).toBe(1);
  });

  test("a missing source database fails soft", () => {
    runBackfill(store, {
      sourcePath: join(dir, "nope.db"),
      cutoff: CUTOFF,
      prices: NO_PRICES,
      log,
    });
    expect(store.isBackfillDone()).toBe(false);
    expect(existsSync(join(dir, "nope.db"))).toBe(false);
  });

  test("Source opened read-only", () => {
    const db = createSource();
    addMessage(db, "m", "s", "assistant", NOW, {
      agent: "a",
      model: MODEL,
      cost: 1,
      tokens: TOKENS,
      time: { created: NOW },
    });
    db.close();
    const before = statSync(sourcePath).mtimeMs;
    runBackfill(store, { sourcePath, cutoff: CUTOFF, prices: NO_PRICES, log });
    expect(statSync(sourcePath).mtimeMs).toBe(before);
  });

  describe("cache-write add-on", () => {
    function sourceWithWrites(): void {
      const db = createSource();
      addMessage(db, "m1", "s", "assistant", NOW, {
        agent: "build",
        model: MODEL,
        cost: 0.1,
        tokens: WRITE_TOKENS,
        time: { created: NOW },
      });
      addMessage(db, "m2", "s", "compaction", NOW + 1, {
        status: "completed",
        model: MODEL,
        cost: 0.2,
        tokens: WRITE_TOKENS,
        time: { created: NOW + 1 },
      });
      db.close();
    }

    test("Backfill computes the add-on", () => {
      sourceWithWrites();
      runBackfill(store, { sourcePath, cutoff: CUTOFF, prices: PRICES, log });
      expect(store.summary(0, 3_000_000).totalMicros).toBe(
        300_000 + 2 * 2_500_000,
      );
    });

    test("Existing rows are corrected", () => {
      sourceWithWrites();
      runBackfill(store, {
        sourcePath,
        cutoff: CUTOFF,
        prices: NO_PRICES,
        log,
      });
      expect(store.summary(0, 3_000_000).totalMicros).toBe(300_000);
      expect(
        runCacheWriteCorrection(store, {
          sourcePath,
          cutoff: CUTOFF,
          prices: PRICES,
          log,
        }),
      ).toBe(true);
      expect(store.summary(0, 3_000_000).totalMicros).toBe(
        300_000 + 2 * 2_500_000,
      );
      expect(store.isCorrectionDone()).toBe(true);
    });

    test("Correction is idempotent", () => {
      sourceWithWrites();
      runBackfill(store, {
        sourcePath,
        cutoff: CUTOFF,
        prices: NO_PRICES,
        log,
      });
      runCacheWriteCorrection(store, {
        sourcePath,
        cutoff: CUTOFF,
        prices: PRICES,
        log,
      });
      expect(
        runCacheWriteCorrection(store, {
          sourcePath,
          cutoff: CUTOFF,
          prices: PRICES,
          log,
        }),
      ).toBe(false);
      expect(store.summary(0, 3_000_000).totalMicros).toBe(
        300_000 + 2 * 2_500_000,
      );
    });

    test("Empty catalog defers the correction", () => {
      sourceWithWrites();
      runBackfill(store, {
        sourcePath,
        cutoff: CUTOFF,
        prices: NO_PRICES,
        log,
      });
      expect(
        runCacheWriteCorrection(store, {
          sourcePath,
          cutoff: CUTOFF,
          prices: NO_PRICES,
          log,
        }),
      ).toBe(false);
      expect(store.isCorrectionDone()).toBe(false);
    });

    test("a catalog without Copilot prices defers the correction", () => {
      sourceWithWrites();
      runBackfill(store, {
        sourcePath,
        cutoff: CUTOFF,
        prices: NO_PRICES,
        log,
      });
      const partial = parseCatalog([
        {
          id: "x",
          providerID: "openrouter",
          cost: [{ input: 1, cache: { read: 0, write: 0 } }],
        },
      ]);
      expect(
        runCacheWriteCorrection(store, {
          sourcePath,
          cutoff: CUTOFF,
          prices: partial,
          log,
        }),
      ).toBe(false);
      expect(store.isCorrectionDone()).toBe(false);
    });

    test("A catalog with Copilot but no Claude prices defers the correction", () => {
      sourceWithWrites();
      runBackfill(store, {
        sourcePath,
        cutoff: CUTOFF,
        prices: NO_PRICES,
        log,
      });
      const partial = parseCatalog([
        {
          id: "gpt-5.3-codex",
          providerID: "github-copilot",
          family: "gpt-codex",
          cost: [{ input: 1, cache: { read: 0, write: 0 } }],
        },
      ]);
      expect(
        runCacheWriteCorrection(store, {
          sourcePath,
          cutoff: CUTOFF,
          prices: partial,
          log,
        }),
      ).toBe(false);
      expect(store.isCorrectionDone()).toBe(false);
    });

    test("A premature earlier marker does not suppress the correction", () => {
      sourceWithWrites();
      runBackfill(store, {
        sourcePath,
        cutoff: CUTOFF,
        prices: NO_PRICES,
        log,
      });
      store.close();
      const raw = new Database(join(dir, "cmon.db"));
      raw
        .query(
          "INSERT INTO meta (key, value) VALUES ('cache_write_correction_done', '1')",
        )
        .run();
      raw.close();
      store = new Store({ dbPath: join(dir, "cmon.db") });
      expect(store.isCorrectionDone()).toBe(false);
      expect(
        runCacheWriteCorrection(store, {
          sourcePath,
          cutoff: CUTOFF,
          prices: PRICES,
          log,
        }),
      ).toBe(true);
      expect(store.summary(0, 3_000_000).totalMicros).toBe(
        300_000 + 2 * 2_500_000,
      );
    });

    test("Missing source fails soft for the correction", () => {
      logs.length = 0;
      expect(
        runCacheWriteCorrection(store, {
          sourcePath: join(dir, "nope.db"),
          cutoff: CUTOFF,
          prices: PRICES,
          log,
        }),
      ).toBe(false);
      expect(store.isCorrectionDone()).toBe(false);
      expect(logs).toHaveLength(1);
    });

    test("Rows without a source message keep zero", () => {
      sourceWithWrites();
      runBackfill(store, {
        sourcePath,
        cutoff: CUTOFF,
        prices: NO_PRICES,
        log,
      });
      store.upsertLive({
        id: "live-only",
        sessionId: "s",
        parentSessionId: null,
        agent: "build",
        providerId: "github-copilot",
        modelId: "claude-sonnet-4.6",
        kind: "step",
        failed: false,
        costMicros: 10,
        cacheWriteExtraMicros: 0,
        createdAt: NOW,
      });
      runCacheWriteCorrection(store, {
        sourcePath,
        cutoff: CUTOFF,
        prices: PRICES,
        log,
      });
      expect(store.summary(0, 3_000_000).totalMicros).toBe(
        10 + 300_000 + 2 * 2_500_000,
      );
    });

    test("a live row stored as unknown is corrected from the source model", () => {
      sourceWithWrites();
      store.upsertLive({
        id: "m1",
        sessionId: "s",
        parentSessionId: null,
        agent: "unknown",
        providerId: "unknown",
        modelId: "unknown",
        kind: "step",
        failed: false,
        costMicros: 100_000,
        cacheWriteExtraMicros: 0,
        createdAt: NOW,
      });
      runCacheWriteCorrection(store, {
        sourcePath,
        cutoff: CUTOFF,
        prices: PRICES,
        log,
      });
      expect(store.summary(0, 3_000_000).totalMicros).toBe(100_000 + 2_500_000);
    });
  });
});
