// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-retention/spec.md
// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-recording/spec.md
// spec: openspec/changes/account-for-cache-writes/specs/cost-retention/spec.md
// spec: openspec/changes/account-for-cache-writes/specs/cost-recording/spec.md
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "./index";
import { Database } from "bun:sqlite";
import { Store } from "./store";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKENS = {
  input: 1,
  output: 1,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};

let dir: string;
let dbPath: string;
let queue: Array<Record<string, unknown>>;
let cleanup: (() => Promise<void>) | undefined;

const SONNET_ENTRY = {
  id: "claude-sonnet-4.6",
  providerID: "github-copilot",
  family: "claude-sonnet",
  cost: [{ input: 2, output: 10, cache: { read: 0.2, write: 0 } }],
};
const WRITE_TOKENS = {
  input: 1,
  output: 1,
  reasoning: 0,
  cache: { read: 0, write: 1_000_000 },
};
const MODEL = { providerID: "github-copilot", id: "claude-sonnet-4.6" };

function fakeContext(
  options: { catalog?: unknown[]; sourceDbPath?: string } = {},
) {
  const emitted: unknown[] = [];
  const catalog = { data: options.catalog ?? [] };
  const pending: Array<Record<string, unknown>> = [];
  let wake: () => void = () => {};
  const ctx = {
    options: {
      dbPath,
      sourceDbPath: options.sourceDbPath ?? join(dir, "absent.db"),
    },
    rpc: {
      register: async () => ({
        events: {
          emit: async (_n: string, d: unknown) => void emitted.push(d),
        },
        dispose: async () => {},
      }),
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) =>
        sessionID === "ses_c" ? { parentID: "ses_p" } : {},
    },
    model: { list: async () => ({ location: {}, data: catalog.data }) },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          pending.push(...queue);
          while (!signal.aborted) {
            const next = pending.shift();
            if (next) {
              yield next;
              continue;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
              signal.addEventListener("abort", () => resolve());
            });
          }
        },
      }),
    },
  };
  return {
    ctx,
    emitted,
    setCatalog: (data: unknown[]) => void (catalog.data = data),
    push: (event: Record<string, unknown>) => {
      pending.push(event);
      wake();
    },
  };
}

function createSource(path: string): void {
  const db = new Database(path, { create: true });
  db.exec(`
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT);
    CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
      seq INTEGER NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);
  `);
  db.query(
    "INSERT INTO session_message VALUES ('m1','s','assistant',1,$t,$d)",
  ).run({
    $t: Date.now(),
    $d: JSON.stringify({
      agent: "build",
      model: MODEL,
      cost: 0.1,
      tokens: WRITE_TOKENS,
      time: { created: Date.now() },
    }),
  });
  db.close();
}

const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 30));

async function start(ctx: unknown): Promise<void> {
  const result = await (
    plugin as unknown as { setup: (c: unknown) => Promise<() => Promise<void>> }
  ).setup(ctx);
  cleanup = result;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cmon-index-"));
  dbPath = join(dir, "cmon.db");
  queue = [];
});

afterEach(async () => {
  jest.useRealTimers();
  await cleanup?.();
  cleanup = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("plugin", () => {
  test("records events end to end and notifies the TUI", async () => {
    queue = [
      {
        id: "e1",
        type: "session.step.started",
        data: {
          sessionID: "ses_c",
          assistantMessageID: "m1",
          agent: "explore",
          model: { providerID: "p", id: "m" },
          started: Date.now(),
        },
      },
      {
        id: "e2",
        type: "session.step.ended",
        data: {
          sessionID: "ses_c",
          assistantMessageID: "m1",
          cost: 0.5,
          tokens: TOKENS,
        },
      },
    ];
    const { ctx, emitted } = fakeContext();
    await start(ctx);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await cleanup?.();
    cleanup = undefined;
    const store = new Store({ dbPath });
    expect(store.summary(0, Date.now() + DAY_MS).agents).toEqual([
      { agent: "explore", micros: 500_000 },
    ]);
    store.close();
    expect(emitted.length).toBe(1);
  });

  test("Old rows are removed at startup", async () => {
    const seed = new Store({ dbPath });
    const old = {
      id: "old",
      sessionId: "s",
      parentSessionId: null,
      agent: "a",
      providerId: "p",
      modelId: "m",
      kind: "step" as const,
      failed: false,
      costMicros: 1,
      cacheWriteExtraMicros: 0,
    };
    seed.upsertLive({ ...old, createdAt: new Date(2000, 0, 1).getTime() });
    seed.upsertLive({ ...old, id: "new", createdAt: Date.now() });
    seed.close();
    await start(fakeContext().ctx);
    await cleanup?.();
    cleanup = undefined;
    const check = new Store({ dbPath });
    expect(check.summary(0, Date.now() + DAY_MS).agents).toEqual([
      { agent: "a", micros: 1 },
    ]);
    check.close();
  });

  test("Pruning repeats daily", async () => {
    jest.useFakeTimers();
    const { ctx } = fakeContext();
    await start(ctx);
    const seed = new Store({ dbPath });
    seed.upsertLive({
      id: "old",
      sessionId: "s",
      parentSessionId: null,
      agent: "a",
      providerId: "p",
      modelId: "m",
      kind: "step",
      failed: false,
      costMicros: 1,
      cacheWriteExtraMicros: 0,
      createdAt: new Date(2000, 0, 1).getTime(),
    });
    seed.close();
    jest.advanceTimersByTime(DAY_MS + 1);
    const check = new Store({ dbPath });
    expect(check.summary(0, Date.now() + DAY_MS).totalMicros).toBe(0);
    check.close();
  });

  test("Sonnet cache writes are priced for live events", async () => {
    queue = [
      {
        id: "e1",
        type: "session.step.started",
        data: {
          sessionID: "ses_c",
          assistantMessageID: "m1",
          agent: "build",
          model: MODEL,
          started: Date.now(),
        },
      },
      {
        id: "e2",
        type: "session.step.ended",
        data: {
          sessionID: "ses_c",
          assistantMessageID: "m1",
          cost: 0.5,
          tokens: WRITE_TOKENS,
        },
      },
    ];
    await start(fakeContext({ catalog: [SONNET_ENTRY] }).ctx);
    await settle();
    await cleanup?.();
    cleanup = undefined;
    const store = new Store({ dbPath });
    expect(store.summary(0, Date.now() + DAY_MS).totalMicros).toBe(
      500_000 + 2_500_000,
    );
    store.close();
  });

  test("Existing rows are corrected", async () => {
    const sourceDbPath = join(dir, "opencode.db");
    createSource(sourceDbPath);
    const seed = new Store({ dbPath });
    seed.completeBackfill([
      {
        id: "m1",
        sessionId: "s",
        parentSessionId: null,
        agent: "build",
        providerId: "github-copilot",
        modelId: "claude-sonnet-4.6",
        kind: "step",
        failed: false,
        costMicros: 100_000,
        cacheWriteExtraMicros: 0,
        createdAt: Date.now(),
      },
    ]);
    seed.close();
    await start(fakeContext({ catalog: [SONNET_ENTRY], sourceDbPath }).ctx);
    await cleanup?.();
    cleanup = undefined;
    const store = new Store({ dbPath });
    expect(store.summary(0, Date.now() + DAY_MS).totalMicros).toBe(
      100_000 + 2_500_000,
    );
    store.close();
  });

  test("Catalog refresh triggers a deferred correction", async () => {
    const sourceDbPath = join(dir, "opencode.db");
    createSource(sourceDbPath);
    const seed = new Store({ dbPath });
    seed.completeBackfill([
      {
        id: "m1",
        sessionId: "s",
        parentSessionId: null,
        agent: "build",
        providerId: "github-copilot",
        modelId: "claude-sonnet-4.6",
        kind: "step",
        failed: false,
        costMicros: 100_000,
        cacheWriteExtraMicros: 0,
        createdAt: Date.now(),
      },
    ]);
    seed.close();
    const { ctx, emitted, setCatalog, push } = fakeContext({ sourceDbPath });
    await start(ctx);
    await settle();
    expect(emitted).toHaveLength(0);
    setCatalog([SONNET_ENTRY]);
    push({ id: "e9", type: "model.updated", data: {} });
    await settle();
    expect(emitted).toHaveLength(1);
    const store = new Store({ dbPath });
    expect(store.summary(0, Date.now() + DAY_MS).totalMicros).toBe(
      100_000 + 2_500_000,
    );
    store.close();
  });

  test("Empty catalog records zero and later recovers", async () => {
    const sourceDbPath = join(dir, "opencode.db");
    createSource(sourceDbPath);
    const seed = new Store({ dbPath });
    seed.completeBackfill([]);
    seed.close();
    queue = [
      {
        id: "e1",
        type: "session.step.started",
        data: {
          sessionID: "ses_c",
          assistantMessageID: "m1",
          agent: "build",
          model: MODEL,
          started: Date.now(),
        },
      },
      {
        id: "e2",
        type: "session.step.ended",
        data: {
          sessionID: "ses_c",
          assistantMessageID: "m1",
          cost: 0.1,
          tokens: WRITE_TOKENS,
        },
      },
    ];
    const { ctx, setCatalog, push } = fakeContext({ sourceDbPath });
    await start(ctx);
    await settle();
    const early = new Store({ dbPath });
    expect(early.summary(0, Date.now() + DAY_MS).totalMicros).toBe(100_000);
    early.close();
    setCatalog([SONNET_ENTRY]);
    push({ id: "e9", type: "model.updated", data: {} });
    await settle();
    const later = new Store({ dbPath });
    expect(later.summary(0, Date.now() + DAY_MS).totalMicros).toBe(
      100_000 + 2_500_000,
    );
    later.close();
  });
});
