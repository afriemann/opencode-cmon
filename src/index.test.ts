// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-retention/spec.md
// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-recording/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-retention/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-recording/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-display/spec.md
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

interface Reply {
  totalMicros: number;
  agents: Array<{ agent: string; micros: number }>;
  models: Array<{ model: string; micros: number }>;
  complete: boolean;
}

function fakeContext(
  options: {
    catalog?: unknown[];
    sourceDbPath?: string;
    hangCatalog?: boolean;
    gatedCatalog?: boolean;
  } = {},
) {
  const emitted: unknown[] = [];
  let summaryHandler: (input: unknown) => Promise<Reply> = async () => {
    throw new Error("rpc not registered");
  };
  let listCalls = 0;
  let openGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => (openGate = resolve));
  const catalog = { data: options.catalog ?? [] };
  const pending: Array<Record<string, unknown>> = [];
  let wake: () => void = () => {};
  const ctx = {
    options: {
      dbPath,
      sourceDbPath: options.sourceDbPath ?? join(dir, "absent.db"),
      notifyDebounceMs: 20,
    },
    rpc: {
      register: async (
        _rpc: unknown,
        handlers: { summary: (input: unknown) => Promise<Reply> },
      ) => {
        summaryHandler = handlers.summary;
        return {
          events: {
            emit: async (_n: string, d: unknown) => void emitted.push(d),
          },
          dispose: async () => {},
        };
      },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) =>
        sessionID === "ses_c" ? { parentID: "ses_p" } : {},
    },
    model: {
      list: () => {
        listCalls += 1;
        if (options.gatedCatalog)
          return gate.then(() => ({ location: {}, data: catalog.data }));
        return options.hangCatalog
          ? new Promise(() => {})
          : Promise.resolve({ location: {}, data: catalog.data });
      },
    },
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
    summary: (from = 0, to = Date.now() + DAY_MS) =>
      summaryHandler({ from, to }),
    listCalls: () => listCalls,
    openGate: () => openGate(),
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

const step = (id: string, tokens: unknown, cost = 0.5) => [
  {
    id: `s_${id}`,
    type: "session.step.started",
    data: {
      sessionID: "ses_c",
      assistantMessageID: id,
      agent: "explore",
      model: MODEL,
      started: Date.now(),
    },
  },
  {
    id: `e_${id}`,
    type: "session.step.ended",
    data: { sessionID: "ses_c", assistantMessageID: id, cost, tokens },
  },
];

const seedRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  sessionId: "s",
  parentSessionId: null,
  agent: "build",
  providerId: "github-copilot",
  modelId: "claude-sonnet-4.6",
  kind: "step" as const,
  failed: false,
  costMicros: 100_000,
  tokens: null,
  createdAt: Date.now(),
  ...overrides,
});

const total = (store: Store): number =>
  store
    .summaryInputs(0, Date.now() + DAY_MS)
    .agents.reduce((sum, a) => sum + a.micros, 0);

describe("plugin", () => {
  test("records events end to end and notifies the TUI", async () => {
    queue = step("m1", TOKENS);
    const { ctx, emitted } = fakeContext();
    await start(ctx);
    await settle();
    await cleanup?.();
    cleanup = undefined;
    const store = new Store({ dbPath });
    expect(store.summaryInputs(0, Date.now() + DAY_MS).agents).toEqual([
      { agent: "explore", micros: 500_000 },
    ]);
    store.close();
    expect(emitted.length).toBe(1);
  });

  test("Old rows are removed at startup", async () => {
    const seed = new Store({ dbPath });
    seed.upsertLive(
      seedRow("old", {
        createdAt: new Date(2000, 0, 1).getTime(),
        tokens: { input: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    );
    seed.upsertLive(
      seedRow("new", { tokens: { input: 0, cacheRead: 0, cacheWrite: 0 } }),
    );
    seed.close();
    await start(fakeContext().ctx);
    await cleanup?.();
    cleanup = undefined;
    const check = new Store({ dbPath });
    expect(total(check)).toBe(100_000);
    check.close();
  });

  test("Pruning repeats daily", async () => {
    jest.useFakeTimers();
    await start(fakeContext().ctx);
    const seed = new Store({ dbPath });
    seed.upsertLive(
      seedRow("old", {
        createdAt: new Date(2000, 0, 1).getTime(),
        tokens: { input: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    );
    seed.close();
    jest.advanceTimersByTime(DAY_MS + 1);
    const check = new Store({ dbPath });
    expect(total(check)).toBe(0);
    check.close();
  });

  test("Sonnet cache writes are priced for live events", async () => {
    queue = step("m1", WRITE_TOKENS);
    const { ctx, summary } = fakeContext({ catalog: [SONNET_ENTRY] });
    await start(ctx);
    await settle();
    const reply = await summary();
    expect(reply.totalMicros).toBe(500_000 + 2_500_000);
    expect(reply.agents).toEqual([{ agent: "explore", micros: 3_000_000 }]);
    expect(reply.models).toHaveLength(1);
    expect(reply.complete).toBe(true);
  });

  test("Fill sets tokens at startup", async () => {
    const sourceDbPath = join(dir, "opencode.db");
    createSource(sourceDbPath);
    const seed = new Store({ dbPath });
    seed.completeBackfill([seedRow("m1")]);
    seed.close();
    const { ctx, summary } = fakeContext({
      catalog: [SONNET_ENTRY],
      sourceDbPath,
    });
    await start(ctx);
    await settle();
    expect((await summary()).totalMicros).toBe(100_000 + 2_500_000);
  });

  test("The add-on follows the catalog", async () => {
    const seed = new Store({ dbPath });
    seed.completeBackfill([
      seedRow("m1", {
        tokens: { input: 0, cacheRead: 0, cacheWrite: 1_000_000 },
      }),
    ]);
    seed.close();
    const { ctx, summary, setCatalog, push, emitted } = fakeContext();
    await start(ctx);
    await settle();
    const early = await summary();
    expect(early.totalMicros).toBe(100_000);
    expect(early.complete).toBe(false);
    setCatalog([SONNET_ENTRY]);
    push({ id: "e9", type: "model.updated", data: {} });
    await settle();
    expect(emitted.length).toBeGreaterThan(0);
    const later = await summary();
    expect(later.totalMicros).toBe(100_000 + 2_500_000);
    expect(later.complete).toBe(true);
  });

  test("A hanging catalog never stalls the summary", async () => {
    const seed = new Store({ dbPath });
    seed.completeBackfill([
      seedRow("m1", {
        tokens: { input: 0, cacheRead: 0, cacheWrite: 1_000_000 },
      }),
    ]);
    seed.close();
    const { ctx, summary } = fakeContext({ hangCatalog: true });
    await start(ctx);
    const started = Date.now();
    const reply = await summary();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(reply).toMatchObject({ totalMicros: 100_000, complete: false });
  });

  test("An unpriced model marks the summary incomplete and requests a reload", async () => {
    const seed = new Store({ dbPath });
    seed.completeBackfill([
      seedRow("m1", { tokens: { input: 0, cacheRead: 0, cacheWrite: 5 } }),
    ]);
    seed.close();
    const { ctx, summary, listCalls } = fakeContext({ catalog: [] });
    await start(ctx);
    await settle();
    const before = listCalls();
    expect((await summary()).complete).toBe(false);
    await settle();
    expect(listCalls()).toBe(before + 1);
  });

  test("Change notifications are debounced", async () => {
    queue = [...step("a", TOKENS), ...step("b", TOKENS), ...step("c", TOKENS)];
    const { ctx, emitted } = fakeContext();
    await start(ctx);
    await settle();
    expect(emitted).toHaveLength(1);
  });

  test("A late catalog change after dispose does not notify", async () => {
    const { ctx, emitted, openGate } = fakeContext({
      catalog: [SONNET_ENTRY],
      gatedCatalog: true,
    });
    await start(ctx);
    await cleanup?.();
    cleanup = undefined;
    openGate();
    await settle();
    expect(emitted).toHaveLength(0);
  });
});
