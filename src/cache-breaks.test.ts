// spec: openspec/specs/cost-analysis/spec.md
import { describe, expect, test } from "bun:test";
import type { AnalysisInput } from "./analysis";
import { buildCacheBreaks, renderCacheBreaks } from "./cache-breaks";
import { parseCatalog } from "./pricing";
import type { CostRow } from "./types";

const CATALOG = parseCatalog([
  {
    id: "claude-sonnet-5.5",
    providerID: "github-copilot",
    family: "claude-sonnet",
    cost: [{ input: 2, output: 10, cache: { read: 0.2, write: 0 } }],
  },
]);
const NOW = new Date(2026, 9, 7, 12, 0, 0);
const BASE = new Date(2026, 9, 7, 9, 0, 0).getTime();
let counter = 0;

function step(
  at: number,
  cacheRead: number | null,
  input: number,
  overrides: Partial<CostRow> = {},
): CostRow {
  counter += 1;
  return {
    id: `r${String(counter).padStart(6, "0")}`,
    sessionId: "s1",
    parentSessionId: null,
    agent: "build",
    providerId: "openai",
    modelId: "gpt",
    kind: "step",
    failed: false,
    costMicros: 1_000_000,
    tokens: cacheRead === null ? null : { input, cacheRead, cacheWrite: 0 },
    outputTokens: 10,
    reasoningTokens: 0,
    finish: "stop",
    directory: "/work/app",
    createdAt: BASE + at * 1000,
    ...overrides,
  };
}

/** One step per index, with cache read and input derived from the index. */
function session(
  count: number,
  read: (i: number) => number,
  inputOf: (i: number) => number,
  overrides: Partial<CostRow> = {},
): CostRow[] {
  return Array.from({ length: count }, (_, i) =>
    step(i, read(i), inputOf(i), overrides),
  );
}

function run(rows: CostRow[], limit = 10, extra: Partial<AnalysisInput> = {}) {
  return buildCacheBreaks(
    {
      rows,
      unknownDirectory: [],
      gaps: new Map(),
      projectFiltered: false,
      catalog: CATALOG,
      range: { from: 0, to: 1e15 },
      now: NOW,
      ...extra,
    },
    limit,
  );
}

const healthy = (n: number, overrides: Partial<CostRow> = {}) =>
  session(
    n,
    (i) => 90_000 + i * 100,
    () => 5_000,
    overrides,
  );

describe("cache breaks examine long sessions", () => {
  test("Short sessions are ignored", () => {
    const result = run(
      session(
        19,
        () => 0,
        () => 50_000,
      ),
    );
    expect(result.sessionsExamined).toBe(0);
    expect(result.flagged).toEqual([]);
  });

  test("Healthy session is not flagged", () => {
    const result = run(healthy(30));
    expect(result.sessionsExamined).toBe(1);
    expect(result.flagged).toEqual([]);
  });

  test("Steps without token counts are skipped and counted", () => {
    const rows = [
      ...healthy(30),
      ...Array.from({ length: 3 }, (_, i) => step(100 + i, null, 0)),
    ];
    const result = run(rows);
    expect(result.notes.join("\n")).toMatch(/3 step\(s\) without token counts/);
  });

  test("Compactions are not steps", () => {
    const rows = [
      ...session(
        19,
        (i) => 90_000 + i * 100,
        () => 5_000,
      ),
      step(19, 0, 0, { kind: "compaction", tokens: null }),
    ];
    expect(run(rows).sessionsExamined).toBe(0);
  });
});

describe("cache breaks report frozen cache runs", () => {
  test("Frozen cache is flagged", () => {
    const rows = session(
      30,
      () => 45_274,
      (i) => 10_000 + i * 1_000,
    );
    const [found] = run(rows).flagged;
    expect(found?.frozen).toMatchObject({
      steps: 30,
      cacheRead: 45_274,
      startStep: 1,
      startAt: BASE,
      inputAtStart: 10_000,
      inputAtEnd: 39_000,
    });
  });

  test("Short frozen run is not a frozen finding", () => {
    const rows = session(
      30,
      (i) => (i >= 5 && i < 19 ? 45_274 : 90_000 + i * 100),
      () => 5_000,
    );
    expect(run(rows).flagged).toEqual([]);
  });

  test("The longest run is reported with its start step", () => {
    const rows = session(
      40,
      (i) => (i >= 10 ? 45_274 : i >= 2 && i < 8 ? 20_000 : 60_000 + i * 100),
      () => 5_000,
    );
    expect(run(rows).flagged[0]?.frozen).toMatchObject({
      steps: 30,
      startStep: 11,
    });
  });

  test("A run needs uncached input", () => {
    const rows = session(
      30,
      () => 45_274,
      () => 0,
    );
    expect(run(rows).flagged).toEqual([]);
  });
});

describe("cache breaks report full misses", () => {
  const alternating = (offset = 0) =>
    session(
      30,
      (i) => ((i + offset) % 2 === 0 ? 100_000 : 0),
      () => 7_000,
    );

  test("Alternating cache reads", () => {
    const [found] = run(alternating()).flagged;
    expect(found?.fullMisses.count).toBe(15);
    expect(found?.fullMisses.entries).toHaveLength(10);
    expect(found?.fullMisses.entries[0]).toEqual({
      step: 2,
      at: BASE + 1000,
      input: 7_000,
    });
  });

  test("First and post-compaction steps are excluded", () => {
    const rows = [
      step(0, 0, 9_000),
      ...session(
        24,
        (i) => 80_000 + i * 100,
        () => 5_000,
      ).map((r, i) => ({
        ...r,
        createdAt: BASE + (i + 1) * 1000,
      })),
    ];
    rows.push(
      step(30, 0, 9_000, { kind: "compaction", tokens: null }),
      step(31, 0, 9_000),
      step(32, 80_000, 5_000),
    );
    const result = run(rows);
    expect(result.sessionsExamined).toBe(1);
    expect(result.flagged).toEqual([]);
  });

  test("A miss after a miss is not a full miss", () => {
    const rows = session(
      30,
      (i) => (i === 10 || i === 11 ? 0 : 90_000 + i * 100),
      () => 5_000,
    );
    expect(run(rows).flagged[0]?.fullMisses.count).toBe(1);
  });
});

describe("cache breaks report ratio change-points", () => {
  test("Fall and recovery", () => {
    const rows = session(
      45,
      (i) => (i >= 15 && i < 30 ? 3_000 + i : 90_000 + i * 100),
      (i) => (i >= 15 && i < 30 ? 7_000 : 10_000),
    );
    const [found] = run(rows).flagged;
    expect(found?.changePoints.entries.map((c) => c.direction)).toEqual([
      "down",
      "up",
    ]);
    expect(found?.changePoints.count).toBe(2);
  });
});

describe("cache breaks estimate the waste", () => {
  const priced = { providerId: "github-copilot", modelId: "claude-sonnet-5.5" };

  test("Waste is estimated", () => {
    const rows = session(
      30,
      () => 45_274,
      () => 10_000,
      priced,
    );
    const [found] = run(rows).flagged;
    // 30 steps x 10000 input x (2 - 0.2) micro-USD per token
    expect(found?.estimatedWasteMicros).toBe(540_000);
  });

  test("Unknown price omits the estimate", () => {
    const rows = session(
      30,
      () => 45_274,
      () => 10_000,
    );
    const result = run(rows);
    expect(result.flagged[0]?.estimatedWasteMicros).toBeUndefined();
    expect(result.flagged[0]?.wasteOmitted).toMatch(/price/);
    expect(renderCacheBreaks(result)).toMatch(/waste omitted/);
  });
});

describe("cache breaks list flagged sessions and a model summary", () => {
  const frozen = (id: string, cost: number, overrides = {}) =>
    session(
      30,
      () => 45_274,
      (i) => 10_000 + i,
      {
        sessionId: id,
        costMicros: cost,
        ...overrides,
      },
    );

  test("Flagged sessions are sorted by cost", () => {
    const result = run([...frozen("cheap", 1), ...frozen("dear", 9)]);
    expect(result.flagged.map((f) => f.sessionId)).toEqual(["dear", "cheap"]);
    expect(result.flagged[0]).toMatchObject({
      agent: "build",
      provider: "openai",
      model: "gpt",
      steps: 30,
      totalMicros: 270,
    });
    expect(result.flagged[0]?.cacheRatio).toBeCloseTo(
      45_274 / (45_274 + 10_014.5),
      3,
    );
  });

  test("Model summary shows a provider-wide regression", () => {
    const result = run(
      [
        ...frozen("a", 1),
        ...frozen("b", 2),
        ...healthy(30, { sessionId: "c" }),
      ],
      1,
    );
    expect(result.flagged).toHaveLength(1);
    expect(result.models).toEqual([
      { provider: "openai", model: "gpt", examined: 3, flagged: 2 },
    ]);
  });

  test("The output carries no message content", () => {
    const text = JSON.stringify(run(frozen("a", 1)));
    expect(Object.keys(JSON.parse(text).flagged[0]).sort()).not.toContain(
      "prompt",
    );
    expect(renderCacheBreaks(run(frozen("a", 1)))).toContain("frozen");
  });
});
