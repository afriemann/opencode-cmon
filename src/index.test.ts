// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-retention/spec.md
// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-recording/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-retention/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-recording/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-display/spec.md
// spec: openspec/changes/add-cost-analysis-tools/specs/cost-analysis/spec.md
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  spyOn,
  test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "./index";
import { Database } from "bun:sqlite";
import { Store } from "./store";
import { createAttributionDiagnostics } from "./backfill";

const MODEL = { providerID: "github-copilot", id: "claude-sonnet-4.6" };

// spec: openspec/changes/fix-unknown-attribution/specs/cost-recording/spec.md
describe("exact persisted attribution", () => {
  test("Failure diagnostics exclude source and identifying content", async () => {
    const path = join(dir, "sensitive-path.db");
    createSource(path);
    const source = new Database(path);
    source
      .query("UPDATE session_message SET data=?")
      .run("private-prompt credential-sentinel not-json");
    source.close();
    const ledger = new Store({ dbPath });
    ledger.completeBackfill([]);
    ledger.close();
    queue.push({
      id: "evt_sensitive",
      type: "session.step.ended",
      data: {
        sessionID: "s",
        assistantMessageID: "m1",
        cost: 0.23,
        tokens: TOKENS,
      },
    });
    const lines: string[] = [];
    const write = spyOn(process.stderr, "write").mockImplementation((line) => {
      lines.push(String(line));
      return true;
    });
    try {
      await start(fakeContext({ sourceDbPath: path }).ctx);
      await settle();
    } finally {
      write.mockRestore();
    }
    const entries = lines.map((line) => JSON.parse(line));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toContainEqual(
      expect.objectContaining({ reason: "source-invalid" }),
    );
    for (const entry of entries) {
      expect(
        Object.keys(entry).every((key) =>
          [
            "service",
            "level",
            "message",
            "correlation",
            "reason",
            "count",
            "counts",
            "repaired",
          ].includes(key),
        ),
      ).toBe(true);
    }
    expect(lines.join("")).not.toMatch(
      /private-prompt|credential-sentinel|sensitive-path|m1|evt_sensitive|sessionID|sourcePath/,
    );
  });

  test("Repeated failures do not flood diagnostics", async () => {
    const quiet: string[] = [];
    createAttributionDiagnostics((line) => quiet.push(line)).startupSummary(0);
    expect(quiet).toEqual([]);
    const path = join(dir, "source.db");
    createSource(path);
    const source = new Database(path);
    source.run("UPDATE session_message SET data='invalid'");
    source.close();
    const ledger = new Store({ dbPath });
    ledger.completeBackfill([
      seedRow("m1", {
        agent: "unknown",
        tokens: { input: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: 1,
        directory: "/work/synthetic",
      }),
    ]);
    ledger.close();
    for (let n = 0; n < 20; n += 1)
      queue.push({
        id: `evt_${n}`,
        type: "session.step.ended",
        data: {
          sessionID: "s",
          assistantMessageID: "m1",
          cost: 0.1,
          tokens: TOKENS,
        },
      });
    const entries: Array<Record<string, unknown>> = [];
    const ledgerErrors: string[] = [];
    const persist = spyOn(Store.prototype, "upsertLive").mockImplementationOnce(
      () => {
        throw new Error("synthetic ledger write failure");
      },
    );
    const write = spyOn(process.stderr, "write").mockImplementation((line) => {
      if (String(line).includes("failed to record session.step.ended")) {
        ledgerErrors.push(String(line));
        throw new Error("synthetic stderr failure");
      }
      const entry = JSON.parse(String(line));
      entries.push(entry);
      // A failing diagnostic sink must not stop startup or event recording.
      throw new Error("synthetic stderr failure");
    });
    try {
      const fake = fakeContext({ sourceDbPath: path });
      await start(fake.ctx);
      await settle();
      expect((await fake.summary()).totalMicros).toBe(100_000);
      expect(persist).toHaveBeenCalledTimes(20);
    } finally {
      write.mockRestore();
      persist.mockRestore();
    }
    expect(
      entries.filter((entry) => entry.reason === "source-invalid"),
    ).toHaveLength(1);
    expect(
      entries.filter((entry) => entry.reason === "ledger-write"),
    ).toHaveLength(1);
    expect(ledgerErrors).toHaveLength(1);
    expect(
      entries.filter((entry) => entry.message === "attribution startup repair"),
    ).toHaveLength(1);
  });
  test("Startup repairs missing fields without changing accounting", async () => {
    const path = join(dir, "source.db");
    createSource(path);
    const ledger = new Store({ dbPath });
    ledger.completeBackfill([
      seedRow("m1", {
        agent: "unknown",
        providerId: "unknown",
        modelId: "unknown",
        costMicros: 234_567,
        tokens: { input: 7, cacheRead: 8, cacheWrite: 0 },
      }),
    ]);
    const before = ledger.filteredRows({ from: 0, to: Date.now() + DAY_MS })
      .rows[0];
    ledger.close();
    if (!before) throw new Error("synthetic seed row missing");
    const fake = fakeContext({ sourceDbPath: path });
    await start(fake.ctx);
    const summary = await fake.summary();
    expect(summary.agents).toEqual([{ agent: "build", micros: 234_567 }]);
    const check = new Store({ dbPath });
    try {
      expect(
        check.filteredRows({ from: 0, to: Date.now() + DAY_MS }).rows[0],
      ).toEqual({
        ...before,
        agent: "build",
        providerId: MODEL.providerID,
        modelId: MODEL.id,
        // Existing independent token/detail fills still enrich their own missing fields.
        outputTokens: 1,
        reasoningTokens: 0,
      });
    } finally {
      check.close();
    }
  });
  test.each([
    [
      "Recovers a completed step without its start",
      "s",
      "assistant",
      { agent: "build", model: MODEL },
      "build",
      MODEL.providerID,
      MODEL.id,
      "m1",
    ],
    [
      "Rejects source identity or type mismatch",
      "other",
      "assistant",
      { agent: "build", model: MODEL },
      "unknown",
      "unknown",
      "unknown",
      "m1",
    ],
    [
      "Rejects source identity or type mismatch",
      "s",
      "compaction",
      { agent: "build", model: MODEL },
      "unknown",
      "unknown",
      "unknown",
      "m1",
    ],
    [
      "Rejects source identity or type mismatch",
      "s",
      "assistant",
      { agent: "build", model: MODEL },
      "unknown",
      "unknown",
      "unknown",
      "different",
    ],
    ...[undefined, 42, "   ", "unknown"].map(
      (invalid) =>
        [
          "Recovers only valid source fields",
          "s",
          "assistant",
          {
            agent: invalid,
            model: { providerID: MODEL.providerID, id: invalid },
          },
          "unknown",
          MODEL.providerID,
          "unknown",
          "m1",
        ] as const,
    ),
  ])(
    "%s",
    async (
      _title,
      session,
      type,
      data,
      agent,
      providerId,
      modelId,
      messageId,
    ) => {
      const path = join(dir, "source.db");
      createSource(path);
      const source = new Database(path);
      source
        .query("UPDATE session_message SET session_id=?, type=?, data=?")
        .run(session, type, JSON.stringify(data));
      source.close();
      const ledger = new Store({ dbPath });
      ledger.completeBackfill([]);
      ledger.close();
      queue.push({
        id: "evt_end",
        type: "session.step.ended",
        data: {
          sessionID: "s",
          assistantMessageID: messageId,
          cost: 0.23,
          tokens: TOKENS,
        },
      });
      const fake = fakeContext({ sourceDbPath: path });
      await start(fake.ctx);
      await settle();
      const check = new Store({ dbPath });
      try {
        expect(
          check.filteredRows({ from: 0, to: Date.now() + DAY_MS }).rows,
        ).toMatchObject([
          { id: messageId, agent, providerId, modelId, costMicros: 230_000 },
        ]);
      } finally {
        check.close();
      }
    },
  );
});

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

interface ToolLike {
  name: string;
  options: unknown;
  execute: (input: unknown, context: { sessionID: string }) => Promise<unknown>;
}

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
  const registeredTools = new Map<string, ToolLike>();
  let toolDisposals = 0;
  const toolEditor = {
    add: (tool: ToolLike) => void registeredTools.set(tool.name, tool),
  };
  const transforms: Array<(editor: typeof toolEditor) => void> = [];
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
        sessionID === "ses_c"
          ? { parentID: "ses_p", location: { directory: "/work/app" } }
          : {},
    },
    tool: {
      transform: async (callback: (editor: typeof toolEditor) => void) => {
        transforms.push(callback);
        callback(toolEditor);
        return { dispose: async () => void (toolDisposals += 1) };
      },
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
    registeredTools,
    transforms,
    toolDisposals: () => toolDisposals,
    toolEditor,
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
  db.run(`
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT);
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
  outputTokens: null,
  reasoningTokens: null,
  finish: null,
  directory: null,
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

  describe("cost tools", () => {
    test("Tools are registered", async () => {
      const f = fakeContext();
      await start(f.ctx);
      expect([...f.registeredTools.keys()].sort()).toEqual([
        "cost_hotspots",
        "cost_report",
      ]);
      for (const tool of f.registeredTools.values())
        expect(tool.options).toEqual({ namespace: "cmon", pinned: true });
    });

    test("No tools without a store", async () => {
      const f = fakeContext();
      (f.ctx.options as { dbPath: string }).dbPath = dir;
      await start(f.ctx);
      expect(f.registeredTools.size).toBe(0);
      expect(f.transforms).toHaveLength(0);
    });

    test("Registration is replay-safe", async () => {
      const f = fakeContext();
      await start(f.ctx);
      const [transform] = f.transforms;
      expect(() => {
        transform!(f.toolEditor);
        transform!(f.toolEditor);
      }).not.toThrow();
      expect(f.registeredTools.size).toBe(2);
    });

    test("a tool reads the recorded cost", async () => {
      const seed = new Store({ dbPath });
      seed.upsertLive(seedRow("m1", { costMicros: 2_000_000 }));
      seed.close();
      const f = fakeContext();
      await start(f.ctx);
      const result = (await f.registeredTools
        .get("cost_report")!
        .execute({}, { sessionID: "ses_c" })) as {
        output: { totalMicros: number };
      };
      expect(result.output.totalMicros).toBe(2_000_000);
    });

    test("current resolves through the session lookup", async () => {
      const seed = new Store({ dbPath });
      seed.upsertLive(seedRow("m1", { directory: "/work/app/x" }));
      seed.upsertLive(seedRow("m2", { directory: "/elsewhere" }));
      seed.close();
      const f = fakeContext();
      await start(f.ctx);
      const result = (await f.registeredTools
        .get("cost_report")!
        .execute({ project: "current" }, { sessionID: "ses_c" })) as {
        output: { totalMicros: number };
      };
      expect(result.output.totalMicros).toBe(100_000);
    });

    test("Calls after shutdown fail cleanly", async () => {
      const f = fakeContext();
      await start(f.ctx);
      const tool = f.registeredTools.get("cost_report")!;
      await cleanup?.();
      cleanup = undefined;
      expect(f.toolDisposals()).toBe(1);
      await expect(tool.execute({}, { sessionID: "ses_c" })).rejects.toThrow(
        "cost tracking stopped",
      );
    });
  });
});
