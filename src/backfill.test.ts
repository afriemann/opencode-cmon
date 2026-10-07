// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-retention/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-retention/spec.md
// spec: openspec/changes/add-cost-analysis-tools/specs/cost-retention/spec.md
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { runBackfill, runDetailFill, runTokenFill } from "./backfill";
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
const WRITE_TOKENS = {
  input: 1,
  output: 1,
  reasoning: 0,
  cache: { read: 0, write: 1_000_000 },
};

function createSource(): Database {
  const db = new Database(sourcePath, { create: true });
  db.exec(`
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT);
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
      "INSERT INTO session_v2 (id, parent_id) VALUES ('ses_p', NULL), ('ses_c', 'ses_p')",
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

    runBackfill(store, { sourcePath, cutoff: CUTOFF, log });

    expect(store.isBackfillDone()).toBe(true);
    expect(
      store
        .summaryInputs(0, 3_000_000)
        .agents.slice()
        .sort((a, b) => b.micros - a.micros),
    ).toEqual([
      { agent: "build", micros: 600_000 },
      { agent: "explore", micros: 250_000 },
    ]);
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
    runBackfill(store, { sourcePath, cutoff: CUTOFF, log });
    expect(
      store
        .summaryInputs(0, 3_000_000)
        .agents.reduce((t, a) => t + a.micros, 0),
    ).toBe(0);
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
    runBackfill(store, { sourcePath, cutoff: CUTOFF, log });
    expect(
      store
        .summaryInputs(0, 3_000_000)
        .agents.slice()
        .sort((a, b) => b.micros - a.micros),
    ).toEqual([
      { agent: "build", micros: 300_000 },
      { agent: "compaction", micros: 200_000 },
    ]);
  });

  test("Second start does not re-import", () => {
    runBackfill(store, {
      sourcePath: join(dir, "missing.db"),
      cutoff: CUTOFF,
      log,
    });
    store.completeBackfill([]);
    logs.length = 0;
    runBackfill(store, {
      sourcePath: join(dir, "missing.db"),
      cutoff: CUTOFF,
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
    runBackfill(store, { sourcePath, cutoff: CUTOFF, log });
    expect(statSync(sourcePath).mtimeMs).toBe(before);
  });

  describe("token fill", () => {
    const raw = () => new Database(join(dir, "cmon.db"), { readonly: true });
    const tokensOf = (id: string) =>
      raw()
        .query(
          "SELECT tokens_input i, tokens_cache_read r, tokens_cache_write w FROM cost_entry WHERE id = $id",
        )
        .get({ $id: id });
    const row = (id: string, createdAt = NOW) => ({
      id,
      sessionId: "s",
      parentSessionId: null,
      agent: "build",
      providerId: "github-copilot",
      modelId: "claude-sonnet-4.6",
      kind: "step" as const,
      failed: false,
      costMicros: 10,
      tokens: null,
      outputTokens: null,
      reasoningTokens: null,
      finish: null,
      directory: null,
      createdAt,
    });
    const options = () => ({ sourcePath, cutoff: CUTOFF, log });

    test("Backfill stores tokens", () => {
      const db = createSource();
      addMessage(db, "m1", "s", "assistant", NOW, {
        agent: "build",
        model: MODEL,
        cost: 0.1,
        tokens: WRITE_TOKENS,
        time: { created: NOW },
      });
      db.close();
      runBackfill(store, options());
      expect(tokensOf("m1")).toEqual({ i: 1, r: 0, w: 1_000_000 });
    });

    test("Fill sets tokens", () => {
      const db = createSource();
      addMessage(db, "m1", "s", "assistant", NOW, {
        agent: "build",
        model: MODEL,
        cost: 0.1,
        tokens: WRITE_TOKENS,
        time: { created: NOW },
      });
      db.close();
      store.upsertLive(row("m1"));
      expect(runTokenFill(store, options())).toBe(1);
      expect(tokensOf("m1")).toEqual({ i: 1, r: 0, w: 1_000_000 });
    });

    test("Fill is idempotent without a marker", () => {
      const db = createSource();
      addMessage(db, "m1", "s", "assistant", NOW, {
        agent: "build",
        model: MODEL,
        cost: 0.1,
        tokens: WRITE_TOKENS,
        time: { created: NOW },
      });
      db.close();
      store.upsertLive(row("m1"));
      runTokenFill(store, options());
      expect(runTokenFill(store, options())).toBe(0);
      expect(
        runTokenFill(store, {
          sourcePath: join(dir, "missing.db"),
          cutoff: CUTOFF,
          log,
        }),
      ).toBe(0);
      expect(logs).toEqual([]);
    });

    test("Unavailable source writes nothing", () => {
      store.upsertLive(row("m1"));
      expect(
        runTokenFill(store, {
          sourcePath: join(dir, "nope.db"),
          cutoff: CUTOFF,
          log,
        }),
      ).toBe(0);
      expect(tokensOf("m1")).toEqual({ i: null, r: null, w: null });
      expect(logs).toHaveLength(1);
      const bad = new Database(sourcePath, { create: true });
      bad.exec("CREATE TABLE unrelated (x INTEGER)");
      bad.close();
      expect(runTokenFill(store, options())).toBe(0);
      expect(tokensOf("m1")).toEqual({ i: null, r: null, w: null });
    });

    test("A confirmed-absent message gets zero tokens", () => {
      createSource().close();
      store.upsertLive(row("ghost"));
      expect(runTokenFill(store, options())).toBe(1);
      expect(tokensOf("ghost")).toEqual({ i: 0, r: 0, w: 0 });
    });

    test("a message without token data gets zero tokens and sub-fields default to 0", () => {
      const db = createSource();
      addMessage(db, "a", "s", "compaction", NOW, {
        status: "completed",
        time: { created: NOW },
      });
      addMessage(db, "b", "s", "assistant", NOW, {
        agent: "x",
        model: MODEL,
        cost: 1,
        tokens: { input: 7 },
        time: { created: NOW },
      });
      db.close();
      store.upsertLive(row("a"));
      store.upsertLive(row("b"));
      runTokenFill(store, options());
      expect(tokensOf("a")).toEqual({ i: 0, r: 0, w: 0 });
      expect(tokensOf("b")).toEqual({ i: 7, r: 0, w: 0 });
    });

    test("fills in chunks across many ids", () => {
      const db = createSource();
      for (let n = 0; n < 1_200; n += 1) {
        addMessage(db, `m${n}`, "s", "assistant", NOW, {
          agent: "x",
          model: MODEL,
          cost: 1,
          tokens: { input: n },
          time: { created: NOW },
        });
        store.upsertLive(row(`m${n}`));
      }
      db.close();
      expect(runTokenFill(store, options())).toBe(1_200);
      expect(store.idsMissingTokens(0)).toEqual([]);
    });

    test("a failing cmon.db read is a soft failure", () => {
      const closed = new Store({ dbPath: join(dir, "other.db") });
      closed.close();
      expect(() => runTokenFill(closed, options())).not.toThrow();
      expect(runTokenFill(closed, options())).toBe(0);
      expect(logs.length).toBeGreaterThan(0);
    });

    test("Concurrent fills apply once", () => {
      const db = createSource();
      addMessage(db, "m1", "s", "assistant", NOW, {
        agent: "x",
        model: MODEL,
        cost: 1,
        tokens: WRITE_TOKENS,
        time: { created: NOW },
      });
      db.close();
      store.upsertLive(row("m1"));
      const other = new Store({ dbPath: join(dir, "cmon.db") });
      expect([
        runTokenFill(store, options()),
        runTokenFill(other, options()),
      ]).toEqual([1, 0]);
      other.close();
    });
  });

  describe("details", () => {
    const raw = () => new Database(join(dir, "cmon.db"), { readonly: true });
    const detailsOf = (id: string) =>
      raw()
        .query(
          "SELECT tokens_output o, tokens_reasoning r, finish f, directory d, failed x, details_checked c FROM cost_entry WHERE id = $id",
        )
        .get({ $id: id });
    const options = () => ({ sourcePath, cutoff: CUTOFF, log });
    const live = (id: string, overrides: object = {}) => ({
      id,
      sessionId: "s",
      parentSessionId: null,
      agent: "build",
      providerId: "github-copilot",
      modelId: "claude-sonnet-4.6",
      kind: "step" as const,
      failed: false,
      costMicros: 10,
      tokens: { input: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: null,
      reasoningTokens: null,
      finish: null,
      directory: null,
      createdAt: NOW,
      ...overrides,
    });
    const step = (extra: object = {}) => ({
      agent: "build",
      model: MODEL,
      cost: 0.1,
      tokens: { ...TOKENS, output: 225, reasoning: 25 },
      finish: "stop",
      time: { created: NOW },
      ...extra,
    });
    const sessionDir = (db: Database) =>
      db
        .query("INSERT INTO session_v2 (id, directory) VALUES ('s', '/work/a')")
        .run();

    test("Imported step carries details", () => {
      const db = createSource();
      sessionDir(db);
      addMessage(db, "m1", "s", "assistant", NOW, step());
      db.close();
      runBackfill(store, options());
      expect(detailsOf("m1")).toEqual({
        o: 225,
        r: 25,
        f: "stop",
        d: "/work/a",
        x: 0,
        c: 1,
      });
    });

    test("Errored source step is imported as failed", () => {
      const db = createSource();
      sessionDir(db);
      addMessage(
        db,
        "m1",
        "s",
        "assistant",
        NOW,
        step({ error: { type: "aborted", message: "Aborted" } }),
      );
      db.close();
      runBackfill(store, options());
      expect(detailsOf("m1")).toMatchObject({ x: 1, f: null });
    });

    test("Fill sets details", () => {
      const db = createSource();
      sessionDir(db);
      addMessage(db, "m1", "s", "assistant", NOW, step());
      db.close();
      store.upsertLive(live("m1"));
      expect(runDetailFill(store, options())).toBe(1);
      expect(detailsOf("m1")).toEqual({
        o: 225,
        r: 25,
        f: "stop",
        d: "/work/a",
        x: 0,
        c: 1,
      });
    });

    test("An absent source message is not queried again", () => {
      createSource().close();
      store.upsertLive(live("m1"));
      expect(runDetailFill(store, options())).toBe(1);
      expect(detailsOf("m1")).toEqual({
        o: null,
        r: null,
        f: null,
        d: null,
        x: 0,
        c: 1,
      });
      expect(runDetailFill(store, options())).toBe(0);
      expect(store.idsMissingDetails(CUTOFF)).toEqual([]);
    });

    test("Fill corrects the failed flag of imported steps", () => {
      const db = createSource();
      sessionDir(db);
      addMessage(
        db,
        "m1",
        "s",
        "assistant",
        NOW,
        step({ error: { type: "aborted" } }),
      );
      db.close();
      store.completeBackfill([live("m1")]);
      runDetailFill(store, options());
      expect(detailsOf("m1")).toMatchObject({ x: 1 });
    });

    test("Fill does not fail a live step", () => {
      const db = createSource();
      sessionDir(db);
      addMessage(
        db,
        "m1",
        "s",
        "assistant",
        NOW,
        step({ error: { type: "aborted" } }),
      );
      db.close();
      store.upsertLive(live("m1"));
      runDetailFill(store, options());
      expect(detailsOf("m1")).toMatchObject({ x: 0 });
    });

    test("Unavailable source writes nothing", () => {
      store.upsertLive(live("m1"));
      expect(runDetailFill(store, options())).toBe(0);
      expect(detailsOf("m1")).toMatchObject({ o: null, c: null });
      expect(logs.length).toBeGreaterThan(0);
    });

    test("Concurrent fills apply once", () => {
      const db = createSource();
      sessionDir(db);
      addMessage(db, "m1", "s", "assistant", NOW, step());
      db.close();
      store.upsertLive(live("m1"));
      const other = new Store({ dbPath: join(dir, "cmon.db") });
      expect([
        runDetailFill(store, options()),
        runDetailFill(other, options()),
      ]).toEqual([1, 0]);
      other.close();
    });

    test("a live row with known details is not queried", () => {
      store.upsertLive(live("m1", { outputTokens: 1, directory: "/x" }));
      expect(store.idsMissingDetails(CUTOFF)).toEqual([]);
    });
  });
});
