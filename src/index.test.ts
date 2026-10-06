// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-retention/spec.md
// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-recording/spec.md
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "./index";
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

function fakeContext() {
  const emitted: unknown[] = [];
  let release: () => void = () => {};
  const ctx = {
    options: { dbPath, sourceDbPath: join(dir, "absent.db") },
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
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          for (const event of queue) yield event;
          await new Promise<void>((resolve) => {
            release = resolve;
            signal.addEventListener("abort", () => resolve());
          });
        },
      }),
    },
  };
  return { ctx, emitted, release: () => release() };
}

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
      createdAt: new Date(2000, 0, 1).getTime(),
    });
    seed.close();
    jest.advanceTimersByTime(DAY_MS + 1);
    const check = new Store({ dbPath });
    expect(check.summary(0, Date.now() + DAY_MS).totalMicros).toBe(0);
    check.close();
  });
});
