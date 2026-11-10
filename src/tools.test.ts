// spec: openspec/specs/cost-analysis/spec.md
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCatalog } from "./pricing";
import { Store } from "./store";
import { createCostTools, type CostTool } from "./tools";
import type { CostRow } from "./types";

const NOW = new Date(2026, 9, 7, 12);
let dir: string;
let store: Store;
let closed: boolean;
let sessionDirectory: string | null;

function row(overrides: Partial<CostRow> = {}): CostRow {
  return {
    id: "m1",
    sessionId: "s1",
    parentSessionId: null,
    agent: "build",
    providerId: "anthropic",
    modelId: "m-a",
    kind: "step",
    failed: false,
    costMicros: 1_000_000,
    tokens: { input: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: 1,
    reasoningTokens: 0,
    finish: "stop",
    directory: "/work/app",
    createdAt: new Date(2026, 9, 2).getTime(),
    ...overrides,
  };
}

function tools(): Record<string, CostTool> {
  return Object.fromEntries(
    createCostTools({
      store: () => {
        if (closed) throw new Error("cost tracking stopped");
        return store;
      },
      catalog: () => parseCatalog([]),
      onIncomplete: () => {},
      sessionDirectory: async () => sessionDirectory,
      now: () => NOW,
    }).map((tool) => [tool.name, tool]),
  );
}

const keys = (result: { output: unknown }) =>
  (result.output as { groups: Array<{ key: string }> }).groups.map(
    (g) => g.key,
  );

const call = (name: string, input: unknown = {}) =>
  tools()[name]!.execute(input, { sessionID: "ses_caller" });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cmon-tools-"));
  store = new Store({ dbPath: join(dir, "cmon.db") });
  closed = false;
  sessionDirectory = "/work/app";
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("cost tools", () => {
  test("Tools are registered", () => {
    const list = createCostTools({
      store: () => store,
      catalog: () => parseCatalog([]),
      onIncomplete: () => {},
      sessionDirectory: async () => null,
      now: () => NOW,
    });
    expect(list.map((t) => t.name).sort()).toEqual([
      "cache_breaks",
      "cost_hotspots",
      "cost_report",
    ]);
    for (const tool of list)
      expect(tool.options).toEqual({ namespace: "cmon", pinned: true });
  });

  test("descriptions state currency, period grammar, project rule and the title caveat", () => {
    for (const tool of Object.values(tools())) {
      expect(tool.description).toMatch(/USD/);
      expect(tool.description).toMatch(/YYYY-MM/);
      expect(tool.description).toMatch(/current/);
      expect(tool.description).toMatch(/title-generation/i);
    }
  });

  test("the report returns structured output and matching text", async () => {
    store.upsertLive(row());
    const result = await call("cost_report", { period: "2026-10" });
    expect(result.output).toMatchObject({
      totalMicros: 1_000_000,
      groupBy: "agent",
    });
    expect(result.content).toContain("$1.00");
  });

  test("hotspots return findings", async () => {
    store.upsertLive(row({ failed: true }));
    const result = await call("cost_hotspots", { period: "2026-10" });
    expect(
      (result.output as { findings: Array<{ type: string }> }).findings.map(
        (f) => f.type,
      ),
    ).toContain("failed_steps");
  });

  test("filters narrow the rows", async () => {
    store.upsertLive(row({ id: "a", agent: "build" }));
    store.upsertLive(row({ id: "b", agent: "explore" }));
    const result = await call("cost_report", {
      period: "2026-10",
      agent: "explore",
    });
    expect(result.output).toMatchObject({ totalMicros: 1_000_000 });
  });

  test("groupBy and sort are applied", async () => {
    store.upsertLive(row({ id: "a", modelId: "x" }));
    const result = await call("cost_report", {
      period: "2026-10",
      groupBy: "model",
      sort: "steps",
    });
    expect(result.output).toMatchObject({
      groupBy: "model",
      groups: [{ key: "x" }],
    });
  });

  test("Invalid period is rejected", async () => {
    await expect(call("cost_report", { period: "banana" })).rejects.toThrow(
      /Accepted/,
    );
  });

  test("Limit above the maximum is rejected", async () => {
    await expect(call("cost_report", { limit: 51 })).rejects.toThrow(/50/);
    await expect(call("cost_hotspots", { limit: 31 })).rejects.toThrow(/30/);
  });

  const day2 = new Date(2026, 9, 2).getTime();

  test("Gaps ignore filters", async () => {
    store.upsertLive(row({ id: "a", agent: "x", createdAt: day2 }));
    store.upsertLive(row({ id: "b", agent: "y", createdAt: day2 + 60_000 }));
    store.upsertLive(row({ id: "c", agent: "x", createdAt: day2 + 120_000 }));
    const result = await call("cost_report", {
      period: "2026-10",
      agent: "x",
      groupBy: "gap",
    });
    expect(keys(result)).toEqual(["first", "1-5m"]);
  });

  test("Compactions do not reset the gap", async () => {
    store.upsertLive(row({ id: "a", createdAt: day2 }));
    store.upsertLive(
      row({ id: "k", kind: "compaction", createdAt: day2 + 300_000 }),
    );
    store.upsertLive(row({ id: "b", createdAt: day2 + 600_000 }));
    const result = await call("cost_report", {
      period: "2026-10",
      kind: "step",
      groupBy: "gap",
    });
    expect(keys(result)).toEqual(["first", ">5m"]);
  });

  test("a groupBy pair returns one row per combination", async () => {
    store.upsertLive(row({ id: "a", modelId: "x" }));
    store.upsertLive(row({ id: "b", modelId: "y" }));
    const result = await call("cost_report", {
      period: "2026-10",
      groupBy: ["agent", "model"],
    });
    expect(result.output).toMatchObject({
      groupBy: ["agent", "model"],
      groups: [{ key: "build / x" }, { key: "build / y" }],
    });
  });

  test("a groupBy pair with gap loads the gaps", async () => {
    store.upsertLive(row({ id: "a" }));
    const result = await call("cost_report", {
      period: "2026-10",
      groupBy: ["gap", "agent"],
    });
    expect(result.output).toMatchObject({ groups: [{ key: "first / build" }] });
  });

  test("duplicate groupBy dimensions are rejected", async () => {
    await expect(
      call("cost_report", { groupBy: ["day", "day"] }),
    ).rejects.toThrow(/differ/);
  });

  test("three groupBy dimensions are rejected", async () => {
    await expect(
      call("cost_report", { groupBy: ["day", "model", "agent"] }),
    ).rejects.toThrow(/exactly two/);
  });

  test("an unknown dimension inside a groupBy pair is rejected", async () => {
    await expect(
      call("cost_report", { groupBy: ["day", "nope"] }),
    ).rejects.toThrow(/groupBy/);
  });

  test("an unknown groupBy is rejected", async () => {
    await expect(call("cost_report", { groupBy: "nope" })).rejects.toThrow(
      /groupBy/,
    );
  });

  test.each(["", "relative/dir"])(
    "a non-absolute project is rejected: %p",
    async (project) => {
      await expect(call("cost_report", { project })).rejects.toThrow(
        /absolute/,
      );
    },
  );

  test("Current resolves from the calling session", async () => {
    store.upsertLive(row({ id: "a", directory: "/work/app/.worktrees/x" }));
    store.upsertLive(row({ id: "b", directory: "/other" }));
    const result = await call("cost_report", {
      period: "2026-10",
      project: "current",
    });
    expect(result.output).toMatchObject({ totalMicros: 1_000_000 });
  });

  test("current without a known directory is an error", async () => {
    sessionDirectory = null;
    await expect(call("cost_report", { project: "current" })).rejects.toThrow(
      /current/,
    );
  });

  test("Unknown directories are excluded and counted", async () => {
    store.upsertLive(row({ id: "a" }));
    store.upsertLive(row({ id: "b", directory: null }));
    const result = await call("cost_report", {
      period: "2026-10",
      project: "/work/app",
    });
    expect(result.output).toMatchObject({
      excluded: { rows: 1, micros: 1_000_000 },
    });
  });

  test("Default is all projects", async () => {
    store.upsertLive(row({ id: "a" }));
    store.upsertLive(row({ id: "b", directory: null }));
    const result = await call("cost_report", { period: "2026-10" });
    expect(result.output).toMatchObject({ totalMicros: 2_000_000 });
  });

  test("Calls after shutdown fail cleanly", async () => {
    closed = true;
    await expect(call("cost_report")).rejects.toThrow("cost tracking stopped");
  });

  test("an incomplete result asks for a catalog reload", async () => {
    let reloads = 0;
    const list = createCostTools({
      store: () => store,
      catalog: () => parseCatalog([]),
      onIncomplete: () => (reloads += 1),
      sessionDirectory: async () => null,
      now: () => NOW,
    });
    store.upsertLive(
      row({
        providerId: "github-copilot",
        modelId: "claude-sonnet-5.5",
        tokens: { input: 0, cacheRead: 0, cacheWrite: 5 },
      }),
    );
    await list[0]!.execute({ period: "2026-10" }, { sessionID: "s" });
    expect(reloads).toBe(1);
  });
});

describe("cache stall findings through the tool", () => {
  test("cost_hotspots reports a cache stall with its evidence", async () => {
    const base = new Date(2026, 9, 2).getTime();
    for (let i = 0; i < 6; i += 1)
      store.upsertLive(
        row({
          id: `st${i}`,
          createdAt: base + i * 60_000,
          tokens: {
            input: 60_000 + i * 10_000,
            cacheRead: 36_655,
            cacheWrite: 0,
          },
        }),
      );
    const result = await call("cost_hotspots");
    expect(result.content).toContain("cache_stall [s1]");
    expect(result.content).toContain("6 steps");
    expect(result.content).toContain("ongoing");
  });
});

describe("cache_breaks tool", () => {
  test("it returns structured output and matching text", async () => {
    for (let i = 0; i < 25; i += 1)
      store.upsertLive(
        row({
          id: `f${i}`,
          createdAt: NOW.getTime() - (30 - i) * 1000,
          tokens: { input: 1000 + i, cacheRead: 45_274, cacheWrite: 0 },
        }),
      );
    const result = await call("cache_breaks", { period: "2026-10" });
    expect(result.output).toMatchObject({
      sessionsExamined: 1,
      flagged: [{ frozen: { steps: 25, cacheRead: 45_274 } }],
    });
    expect(result.content).toContain("frozen: 25 steps");
  });

  test("a limit above 30 is rejected", async () => {
    await expect(call("cache_breaks", { limit: 31 })).rejects.toThrow(/30/);
  });
});
