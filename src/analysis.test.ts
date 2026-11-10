// spec: openspec/specs/cost-display/spec.md
// spec: openspec/specs/cost-analysis/spec.md
import { describe, expect, test } from "bun:test";
import {
  buildHotspots,
  buildReport,
  capText,
  parsePeriod,
  renderHotspots,
  renderReport,
  validateLimit,
  type AnalysisInput,
} from "./analysis";
import { parseCatalog } from "./pricing";
import { buildSummary } from "./summary";
import type { Candidate, CostRow } from "./types";

const EMPTY = parseCatalog([]);
const CATALOG = parseCatalog([
  {
    id: "claude-sonnet-5.5",
    providerID: "github-copilot",
    family: "claude-sonnet",
    cost: [{ input: 2, output: 10, cache: { read: 0.2, write: 0 } }],
  },
]);
const NOW = new Date(2026, 9, 7, 12, 0, 0);
const RANGE = { from: 0, to: 1e15 } as const;
let counter = 0;

function row(overrides: Partial<CostRow> = {}): CostRow {
  counter += 1;
  return {
    id: `m${counter}`,
    sessionId: "s1",
    parentSessionId: null,
    agent: "build",
    providerId: "anthropic",
    modelId: "m-a",
    kind: "step",
    failed: false,
    costMicros: 1_000_000,
    tokens: { input: 100, cacheRead: 0, cacheWrite: 0 },
    outputTokens: 10,
    reasoningTokens: 0,
    finish: "stop",
    directory: "/work/app",
    createdAt: counter,
    ...overrides,
  };
}

function input(
  rows: CostRow[],
  overrides: Partial<AnalysisInput> = {},
): AnalysisInput {
  return {
    rows,
    unknownDirectory: [],
    gaps: new Map(),
    projectFiltered: false,
    catalog: EMPTY,
    range: RANGE,
    now: NOW,
    ...overrides,
  };
}

const report = (
  rows: CostRow[],
  options: Partial<Parameters<typeof buildReport>[1]> = {},
  extra: Partial<AnalysisInput> = {},
) =>
  buildReport(input(rows, extra), {
    groupBy: "agent",
    sort: "cost",
    limit: 10,
    ...options,
  });

describe("parsePeriod", () => {
  test("Default is the current month", () => {
    expect(parsePeriod(undefined, NOW)).toEqual({
      from: new Date(2026, 9, 1).getTime(),
      to: new Date(2026, 10, 1).getTime(),
    });
  });

  test("a YYYY-MM period is that local month", () => {
    expect(parsePeriod("2026-02", NOW)).toEqual({
      from: new Date(2026, 1, 1).getTime(),
      to: new Date(2026, 2, 1).getTime(),
    });
  });

  test("an <N>d period ends now", () => {
    const range = parsePeriod("7d", NOW);
    expect(range.to).toBeGreaterThan(NOW.getTime());
    expect(range.to - range.from).toBe(7 * 86_400_000 + 1);
  });

  test("Day range is inclusive", () => {
    expect(parsePeriod("2026-10-01..2026-10-03", NOW)).toEqual({
      from: new Date(2026, 9, 1).getTime(),
      to: new Date(2026, 9, 4).getTime(),
    });
  });

  test.each([
    "0d",
    "185d",
    "banana",
    "2026-13",
    "2026-02-30..2026-03-01",
    "2026-10-03..2026-10-01",
  ])("Invalid period is rejected: %s", (spec) => {
    expect(() => parsePeriod(spec, NOW)).toThrow(/month.*YYYY-MM.*<N>d/s);
  });
});

describe("validateLimit", () => {
  test("defaults to 10 and accepts the maximum", () => {
    expect(validateLimit(undefined, 50)).toBe(10);
    expect(validateLimit(50, 50)).toBe(50);
  });

  test("Limit above the maximum is rejected", () => {
    expect(() => validateLimit(51, 50)).toThrow(/50/);
    expect(() => validateLimit(0, 50)).toThrow();
  });
});

describe("buildReport", () => {
  test("Group by model", () => {
    const result = report(
      [
        row({ modelId: "a", costMicros: 3_000_000, outputTokens: 5 }),
        row({ modelId: "a", costMicros: 1_000_000, outputTokens: 7 }),
        row({ modelId: "b", costMicros: 1_000_000 }),
      ],
      { groupBy: "model" },
    );
    const [a, b] = result.groups;
    expect(a).toMatchObject({
      key: "a",
      micros: 4_000_000,
      steps: 2,
      avgMicros: 2_000_000,
      tokens: { input: 200, output: 12, reasoning: 0 },
    });
    expect(a?.share).toBeCloseTo(0.8);
    expect(b?.key).toBe("b");
    expect(result.groups.reduce((s, g) => s + g.share, 0)).toBeCloseTo(1);
  });

  test("Group by day uses local dates", () => {
    const late = new Date(2026, 9, 1, 23, 30).getTime();
    const early = new Date(2026, 9, 2, 0, 30).getTime();
    const result = report(
      [row({ createdAt: late }), row({ createdAt: early })],
      { groupBy: "day" },
    );
    expect(result.groups.map((g) => g.key).sort()).toEqual([
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  test("groups by session and provider", () => {
    const rows = [
      row({ sessionId: "s1" }),
      row({ sessionId: "s2", providerId: "x" }),
    ];
    expect(report(rows, { groupBy: "session" }).groups).toHaveLength(2);
    expect(
      report(rows, { groupBy: "provider" })
        .groups.map((g) => g.key)
        .sort(),
    ).toEqual(["anthropic", "x"]);
  });

  test("Cache-read ratio is unknown without cache data", () => {
    expect(report([row()]).groups[0]?.cacheReadRatio).toBeNull();
  });

  test("cache-read ratio is cacheRead over all input-side tokens", () => {
    const result = report([
      row({ tokens: { input: 100, cacheRead: 700, cacheWrite: 200 } }),
    ]);
    expect(result.groups[0]?.cacheReadRatio).toBeCloseTo(0.7);
  });

  test("Failed cost is separate", () => {
    const result = report([
      row({ failed: true, costMicros: 500_000 }),
      row({ costMicros: 1_000_000 }),
    ]);
    expect(result.groups[0]).toMatchObject({
      micros: 1_500_000,
      failedMicros: 500_000,
    });
  });

  test("Rows with unknown token details", () => {
    const result = report([
      row({ outputTokens: null, reasoningTokens: null, tokens: null }),
    ]);
    expect(result.groups[0]).toMatchObject({
      micros: 1_000_000,
      steps: 1,
      tokens: { output: 0, input: 0 },
    });
  });

  test("compactions add cost but are not steps", () => {
    const result = report([row(), row({ kind: "compaction" })]);
    expect(result.groups[0]).toMatchObject({ micros: 2_000_000, steps: 1 });
  });

  test("Sort by average cost", () => {
    const result = report(
      [
        row({ agent: "many", costMicros: 3_000_000 }),
        row({ agent: "many", costMicros: 3_000_000 }),
        row({ agent: "many", costMicros: 3_000_000 }),
        row({ agent: "one", costMicros: 5_000_000 }),
      ],
      { sort: "avgCost" },
    );
    expect(result.groups.map((g) => g.key)).toEqual(["one", "many"]);
  });

  test("sort by steps", () => {
    const result = report(
      [
        row({ agent: "a", costMicros: 9_000_000 }),
        row({ agent: "b" }),
        row({ agent: "b" }),
      ],
      { sort: "steps" },
    );
    expect(result.groups.map((g) => g.key)).toEqual(["b", "a"]);
  });

  test("Remaining groups fold into others", () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      row({
        agent: `a${String(i).padStart(2, "0")}`,
        costMicros: (20 - i) * 1_000_000,
      }),
    );
    const result = report(rows, { limit: 10 });
    expect(result.groups).toHaveLength(11);
    expect(result.groups[10]).toMatchObject({ key: "others", steps: 5 });
    expect(result.groups.reduce((s, g) => s + g.share, 0)).toBeCloseTo(1);
    expect(result.groups.reduce((s, g) => s + g.micros, 0)).toBe(
      result.totalMicros,
    );
  });

  test("an empty period has no groups and a zero total", () => {
    expect(report([])).toMatchObject({
      groups: [],
      totalMicros: 0,
      complete: true,
    });
  });

  test("Sidebar and cost report agree", () => {
    const rows = [
      row({
        providerId: "github-copilot",
        modelId: "claude-sonnet-5.5",
        costMicros: 100,
        tokens: { input: 0, cacheRead: 0, cacheWrite: 20_000 },
      }),
      row({ costMicros: 250_000 }),
    ];
    const candidates: Candidate[] = rows
      .filter((r) => r.providerId === "github-copilot")
      .map((r) => ({
        agent: r.agent,
        providerId: r.providerId,
        modelId: r.modelId,
        tokens: r.tokens,
        costMicros: r.costMicros,
        outputTokens: r.outputTokens,
        reasoningTokens: r.reasoningTokens,
      }));
    const summary = buildSummary(
      {
        agents: [{ agent: "build", micros: 250_100 }],
        models: [],
        providers: [],
      },
      candidates,
      CATALOG,
    );
    const result = report(rows, {}, { catalog: CATALOG });
    expect(result.totalMicros).toBe(summary.totalMicros);
    expect(result.totalMicros).toBe(300_100);
  });

  test("Incomplete pricing is flagged", () => {
    const result = report(
      [
        row({
          providerId: "github-copilot",
          modelId: "claude-sonnet-5.5",
          tokens: { input: 0, cacheRead: 0, cacheWrite: 5 },
        }),
      ],
      {},
      { catalog: EMPTY },
    );
    expect(result.complete).toBe(false);
    expect(result.notes.join("\n")).toMatch(/1 row/);
  });

  test("Notes always include the title-generation caveat", () => {
    expect(report([]).notes.join("\n")).toMatch(
      /title-generation cost is not tracked/,
    );
  });

  test("Retention truncation is stated", () => {
    const result = report([], {}, { range: { from: 0, to: NOW.getTime() } });
    expect(result.notes.join("\n")).toMatch(/pruned/);
  });

  test("Unknown directories are excluded and counted", () => {
    const result = report(
      [row()],
      {},
      {
        projectFiltered: true,
        unknownDirectory: [row({ directory: null, costMicros: 2_000_000 })],
      },
    );
    expect(result.excluded).toEqual({ rows: 1, micros: 2_000_000 });
    expect(result.notes.join("\n")).toMatch(/1 row.*unknown directory/s);
  });

  test("no exclusion note without a project filter", () => {
    expect(report([row()]).excluded).toBeUndefined();
  });
});

const MIN = 60_000;
const gapsOf = (entries: Array<[CostRow, number | null]>) =>
  new Map(entries.map(([r, g]) => [r.id, g]));

describe("two-dimension grouping", () => {
  const day1 = new Date(2026, 9, 1, 12).getTime();
  const day2 = new Date(2026, 9, 2, 12).getTime();

  test("Group by day and model", () => {
    const rows = [
      row({ modelId: "a", createdAt: day1, costMicros: 1_000_000 }),
      row({ modelId: "b", createdAt: day1, costMicros: 2_000_000 }),
      row({ modelId: "a", createdAt: day2, costMicros: 3_000_000 }),
      row({ modelId: "a", createdAt: day2, costMicros: 1_000_000 }),
    ];
    const result = report(rows, { groupBy: ["day", "model"] });
    expect(result.groupBy).toEqual(["day", "model"]);
    expect(
      result.groups.map((g) => [g.key, "keys" in g ? g.keys : undefined]),
    ).toEqual([
      ["2026-10-02 / a", ["2026-10-02", "a"]],
      ["2026-10-01 / b", ["2026-10-01", "b"]],
      ["2026-10-01 / a", ["2026-10-01", "a"]],
    ]);
    expect(result.groups[0]).toMatchObject({ micros: 4_000_000, steps: 2 });
    expect(result.groups.reduce((s, g) => s + g.share, 0)).toBeCloseTo(1);
  });

  test("Group by day and model keeps the cache-read ratio", () => {
    const rows = [
      row({
        modelId: "a",
        tokens: { input: 100, cacheRead: 300, cacheWrite: 0 },
      }),
    ];
    expect(report(rows, { groupBy: ["model", "day"] }).groups[0]).toMatchObject(
      { cacheReadRatio: 0.75 },
    );
  });

  test("A single dimension is unchanged", () => {
    const rows = [
      row({ modelId: "a", createdAt: day1 }),
      row({ modelId: "b", createdAt: day2, costMicros: 2_000_000 }),
    ];
    const single = report(rows, { groupBy: "model" });
    expect(single.groupBy).toBe("model");
    expect(single.groups.every((g) => !("keys" in g))).toBe(true);
    expect(JSON.stringify(single)).not.toContain("keys");
    expect(renderReport(single)).toContain("Grouped by model:");
  });

  test("Limit applies to combinations", () => {
    const rows = [
      row({ modelId: "a", createdAt: day1, costMicros: 3_000_000 }),
      row({ modelId: "b", createdAt: day1, costMicros: 2_000_000 }),
      row({ modelId: "a", createdAt: day2, costMicros: 1_000_000 }),
    ];
    const result = report(rows, { groupBy: ["day", "model"], limit: 2 });
    expect(result.groups.map((g) => g.key)).toEqual([
      "2026-10-01 / a",
      "2026-10-01 / b",
      "others",
    ]);
    expect(result.groups[2]?.micros).toBe(1_000_000);
    expect(result.groups.reduce((s, g) => s + g.share, 0)).toBeCloseTo(1);
  });

  test("gap combined with another dimension uses cost order", () => {
    const rows = [row({ modelId: "a" })];
    const result = report(rows, { groupBy: ["gap", "model"] });
    expect(result.groups.map((g) => g.key)).toEqual(["first / a"]);
  });

  test("the rendering names both dimensions", () => {
    const text = renderReport(
      report([row({ modelId: "a" })], { groupBy: ["agent", "model"] }),
    );
    expect(text).toContain("Grouped by agent, model:");
    expect(text).toContain("build / a |");
  });
});

describe("gap analysis", () => {
  test("Group by gap uses fixed ordered buckets", () => {
    const rows = [row(), row(), row(), row()];
    const gaps = gapsOf([
      [rows[0]!, null],
      [rows[1]!, 30_000],
      [rows[2]!, 3 * MIN],
      [rows[3]!, 10 * MIN],
    ]);
    const result = report(rows, { groupBy: "gap" }, { gaps });
    expect(result.groups.map((g) => [g.key, g.steps])).toEqual([
      ["first", 1],
      ["<1m", 1],
      ["1-5m", 1],
      [">5m", 1],
    ]);
  });

  test("A step without a known predecessor is first", () => {
    expect(report([row()], { groupBy: "gap" }).groups[0]?.key).toBe("first");
  });

  const idleRow = (overrides: Partial<CostRow> = {}) =>
    row({
      tokens: { input: 100, cacheRead: 100, cacheWrite: 200_000 },
      ...overrides,
    });
  const idle = (rows: CostRow[], gap: number) =>
    buildHotspots(
      input(rows, { gaps: gapsOf(rows.map((r) => [r, gap])) }),
      30,
    ).findings.filter((f) => f.type === "idle_cache_rewrite");

  test("Idle rewrite is reported", () => {
    const found = idle([idleRow({ costMicros: 3_000_000 })], 10 * MIN);
    expect(found[0]).toMatchObject({ attributableMicros: 3_000_000 });
    expect(String(found[0]?.evidence.value)).toMatch(/1 step.*200000/s);
  });

  test("Short gaps are not reported", () => {
    expect(idle([idleRow()], MIN)).toEqual([]);
  });

  test("Warm steps after a long gap are not reported", () => {
    const warm = row({
      tokens: { input: 100, cacheRead: 150_000, cacheWrite: 1_000 },
    });
    expect(idle([warm], 10 * MIN)).toEqual([]);
  });
});

describe("buildHotspots", () => {
  const hot = (
    rows: CostRow[],
    extra: Partial<AnalysisInput> = {},
    limit = 30,
  ) => buildHotspots(input(rows, extra), limit);
  const ofType = (
    rows: CostRow[],
    type: string,
    extra: Partial<AnalysisInput> = {},
  ) => hot(rows, extra).findings.filter((f) => f.type === type);

  test("Findings are ranked", () => {
    const result = hot([
      row({ sessionId: "cheap", costMicros: 1_000_000 }),
      row({ sessionId: "dear", costMicros: 9_000_000 }),
    ]);
    const costs = result.findings
      .filter((f) => f.suggestion !== null)
      .map((f) => f.attributableMicros);
    expect(costs).toEqual([...costs].sort((a, b) => b - a));
  });

  test("Overlap is stated", () => {
    expect(hot([row()]).notes.join("\n")).toMatch(/overlap/);
  });

  test("No data gives no findings", () => {
    expect(hot([])).toMatchObject({ findings: [], totalMicros: 0 });
  });

  test("Top session includes its sub-agents", () => {
    const found = ofType(
      [
        row({ sessionId: "root", costMicros: 1_000_000 }),
        row({
          sessionId: "kid",
          parentSessionId: "root",
          costMicros: 2_000_000,
        }),
      ],
      "top_session",
    );
    expect(found[0]).toMatchObject({
      scope: "root",
      attributableMicros: 3_000_000,
    });
    expect(found).toHaveLength(1);
  });

  test("Top step", () => {
    const found = ofType(
      [row({ id: "cheap" }), row({ id: "dear", costMicros: 5_000_000 })],
      "top_step",
    );
    expect(found[0]).toMatchObject({ attributableMicros: 5_000_000 });
    expect(found[0]?.scope).toContain("dear");
  });

  describe("cache", () => {
    const reporting = row({
      sessionId: "good",
      tokens: { input: 10, cacheRead: 500_000, cacheWrite: 0 },
    });
    const lowRow = row({
      sessionId: "bad",
      tokens: { input: 300_000, cacheRead: 10_000, cacheWrite: 0 },
      costMicros: 4_000_000,
    });

    test("Low cache reads are reported", () => {
      const found = ofType([reporting, lowRow], "low_cache_read");
      expect(found.map((f) => f.scope)).toEqual(["bad"]);
      expect(found[0]?.attributableMicros).toBe(4_000_000);
    });

    test("Providers without cache reporting are skipped", () => {
      const silent = row({
        sessionId: "silent",
        providerId: "other",
        tokens: { input: 900_000, cacheRead: 0, cacheWrite: 0 },
      });
      expect(ofType([reporting, silent], "low_cache_read")).toEqual([]);
    });

    test("Cache-write spend", () => {
      const writer = row({
        providerId: "github-copilot",
        modelId: "claude-sonnet-5.5",
        costMicros: 100,
        tokens: { input: 0, cacheRead: 0, cacheWrite: 20_000 },
      });
      const found = ofType([writer], "cache_write_spend", { catalog: CATALOG });
      expect(found[0]).toMatchObject({ attributableMicros: 50_000 });
      expect(found[0]?.evidence.value).toBe(20_000);
    });

    test("no cache-write finding without writes", () => {
      expect(ofType([row()], "cache_write_spend")).toEqual([]);
    });
  });

  test("Failed steps", () => {
    const found = ofType(
      [
        row({ failed: true, costMicros: 1_000_000 }),
        row({ failed: true, costMicros: 1_000_000 }),
        row(),
      ],
      "failed_steps",
    );
    expect(found[0]).toMatchObject({ attributableMicros: 2_000_000 });
  });

  test("Truncated steps", () => {
    const found = ofType(
      [row({ finish: "length", costMicros: 3_000_000 }), row()],
      "truncated_steps",
    );
    expect(found[0]).toMatchObject({ attributableMicros: 3_000_000 });
  });

  test("Compaction spend", () => {
    const found = ofType(
      [row({ kind: "compaction", costMicros: 2_000_000 }), row()],
      "compaction_spend",
    );
    expect(found[0]).toMatchObject({ attributableMicros: 2_000_000 });
  });

  test("Sub-agent fan-out", () => {
    const kids = Array.from({ length: 5 }, (_, i) =>
      row({
        sessionId: `k${i}`,
        parentSessionId: i === 4 ? "k0" : "root",
        costMicros: 1_000_000,
      }),
    );
    const found = ofType(
      [row({ sessionId: "root" }), ...kids],
      "subagent_fanout",
    );
    expect(found[0]).toMatchObject({
      scope: "root",
      attributableMicros: 5_000_000,
    });
  });

  test("small fan-out is not reported", () => {
    const kids = [row({ sessionId: "k", parentSessionId: "root" })];
    expect(
      ofType([row({ sessionId: "root" }), ...kids], "subagent_fanout"),
    ).toEqual([]);
  });

  test("Growing context is reported", () => {
    const steps = [10_000, 20_000, 40_000, 70_000, 100_000].map((n, i) =>
      row({
        sessionId: "grow",
        createdAt: 1_000 + i,
        tokens: { input: n, cacheRead: 0, cacheWrite: 0 },
      }),
    );
    const found = ofType(steps, "input_growth");
    expect(found[0]).toMatchObject({
      scope: "grow",
      attributableMicros: 5_000_000,
    });
    expect(found[0]?.evidence.value).toBe(10);
  });

  test("a tiny first step does not inflate the growth ratio", () => {
    const steps = [10, 2_000, 4_000, 8_000, 12_000].map((n, i) =>
      row({
        sessionId: "tiny",
        createdAt: 1_000 + i,
        tokens: { input: n, cacheRead: 0, cacheWrite: 0 },
      }),
    );
    expect(ofType(steps, "input_growth")).toEqual([]);
  });

  test("Facts rank after recommendations", () => {
    const result = hot([
      row({ failed: true, costMicros: 1_000_000 }),
      row({ agent: "other", costMicros: 9_000_000 }),
    ]);
    const types = result.findings.map((f) => f.type);
    expect(types.indexOf("failed_steps")).toBeLessThan(
      types.indexOf("agent_model_mix"),
    );
  });

  test("Short sessions are ignored", () => {
    const steps = [10_000, 100_000].map((n, i) =>
      row({
        sessionId: "short",
        createdAt: 1_000 + i,
        tokens: { input: n, cacheRead: 0, cacheWrite: 0 },
      }),
    );
    expect(ofType(steps, "input_growth")).toEqual([]);
  });

  test("Agent model mix", () => {
    const found = ofType(
      [
        row({
          agent: "build",
          modelId: "big",
          costMicros: 3_000_000,
          outputTokens: 100,
        }),
        row({
          agent: "build",
          modelId: "small",
          costMicros: 1_000_000,
          outputTokens: 300,
        }),
      ],
      "agent_model_mix",
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.suggestion).toBeNull();
    expect(String(found[0]?.evidence.value)).toMatch(
      /big 75%.*small 25%.*200/s,
    );
  });

  test("limit caps the findings", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row({ sessionId: `s${i}`, failed: true }),
    );
    expect(hot(rows, {}, 2).findings).toHaveLength(2);
  });

  test("shares are relative to the period total", () => {
    const found = ofType(
      [
        row({ failed: true, costMicros: 1_000_000 }),
        row({ costMicros: 3_000_000 }),
      ],
      "failed_steps",
    );
    expect(found[0]?.share).toBeCloseTo(0.25);
  });
});

describe("rendering", () => {
  test("Output and text agree", () => {
    const result = report([row({ costMicros: 12_340_000 })]);
    expect(renderReport(result)).toContain("$12.34");
  });

  test("renders hotspots with their basis", () => {
    const text = renderHotspots(
      buildHotspots(input([row({ failed: true })]), 10),
    );
    expect(text).toMatch(/failed_steps/);
  });

  test("Text is capped", () => {
    const text = capText(
      Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n"),
    );
    expect(text.split("\n").length).toBeLessThanOrEqual(120);
    expect(text.endsWith("… truncated")).toBe(true);
  });

  test("text over the byte cap is truncated", () => {
    const text = capText("x".repeat(20_000));
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(8_192);
    expect(text.endsWith("… truncated")).toBe(true);
  });

  test("short text is untouched", () => {
    expect(capText("a\nb")).toBe("a\nb");
  });
});

describe("cache stalls", () => {
  const MIN = 60_000;
  const PREFIX = 36_655;
  let at = 1_000_000;

  function step(
    sessionId: string,
    input: number,
    cacheRead: number,
    overrides: Partial<CostRow> = {},
  ): CostRow {
    at += MIN;
    return row({
      sessionId,
      createdAt: at,
      costMicros: 500_000,
      tokens: { input, cacheRead, cacheWrite: 0 },
      ...overrides,
    });
  }

  const stalled = (sessionId: string, n: number, first = 60_000) =>
    Array.from({ length: n }, (_, i) =>
      step(sessionId, first + i * 10_000, PREFIX),
    );
  const healthy = (sessionId: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      step(sessionId, 30_000, 50_000 + i * 20_000),
    );
  const stalls = (rows: CostRow[], extra: Partial<AnalysisInput> = {}) =>
    buildHotspots(input(rows, extra), 30).findings.filter(
      (f) => f.type === "cache_stall",
    );

  test("Healthy cache is not reported", () => {
    expect(stalls(healthy("s1", 12))).toEqual([]);
  });

  test("Stall from the first step is ongoing", () => {
    const [finding] = stalls(stalled("s1", 6));
    expect(finding?.stall).toMatchObject({
      sessionId: "s1",
      steps: 6,
      ongoing: true,
      cacheRead: PREFIX,
      healthyBefore: false,
    });
  });

  test("Healthy then stalled", () => {
    const rows = [...healthy("s1", 10), ...stalled("s1", 8)];
    const [finding] = stalls(rows);
    expect(finding?.stall).toMatchObject({
      startedAt: rows[10]!.createdAt,
      steps: 8,
      ongoing: true,
      healthyBefore: true,
      stalledCostMicros: 4_000_000,
    });
    expect(finding?.attributableMicros).toBe(4_000_000);
  });

  test("A cache miss below the constant read does not end the stall", () => {
    const rows = stalled("s1", 6);
    rows.splice(3, 0, step("s1", 268_637, 0));
    expect(stalls(rows)[0]?.stall).toMatchObject({ steps: 7, ongoing: true });
  });

  test("A model that never caches is not a stall", () => {
    const rows = Array.from({ length: 6 }, () => step("s1", 100_000, 0));
    expect(stalls(rows)).toEqual([]);
  });

  test("Short run is not reported", () => {
    expect(stalls(stalled("s1", 4))).toEqual([]);
  });

  test("Recovered stall is not ongoing", () => {
    const rows = [...stalled("s1", 6), step("s1", 30_000, 200_000)];
    expect(stalls(rows)[0]?.stall).toMatchObject({
      steps: 6,
      ongoing: false,
    });
  });

  test("Unknown tokens are skipped and sessions are independent", () => {
    const rows = stalled("s1", 6);
    rows.splice(3, 0, step("s1", 0, 0, { tokens: null }));
    rows.push(...healthy("s2", 8));
    const found = stalls(rows);
    expect(found.map((f) => f.scope)).toEqual(["s1"]);
    expect(found[0]?.stall?.steps).toBe(6);
  });

  test("Small cache-read growth within tolerance stays a stall", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      step("s1", 100_000, PREFIX + i * 100),
    );
    expect(stalls(rows)).toHaveLength(1);
  });

  test("Savings are omitted without a cache-read price", () => {
    expect(stalls(stalled("s1", 6))[0]?.stall).not.toHaveProperty(
      "estimatedSavingsMicros",
    );
  });

  test("Savings use the catalog cache-read price", () => {
    const rows = Array.from({ length: 5 }, () =>
      step("s1", 1_000_000, PREFIX, {
        providerId: "github-copilot",
        modelId: "claude-sonnet-5.5",
      }),
    );
    // (2 - 0.2) USD per million over 1M input tokens, five steps.
    expect(
      stalls(rows, { catalog: CATALOG })[0]?.stall?.estimatedSavingsMicros,
    ).toBe(9_000_000);
  });

  test("Report counts stalled steps per model", () => {
    const rows = [
      ...stalled("s1", 6).map((r) => ({ ...r, modelId: "m-stall" })),
      ...healthy("s2", 3),
    ];
    const grouped = report(rows, { groupBy: "model" }).groups;
    expect(grouped.find((g) => g.key === "m-stall")?.stalledSteps).toBe(6);
    expect(grouped.find((g) => g.key === "m-a")?.stalledSteps).toBe(0);
    expect(renderReport(report(rows, { groupBy: "model" }))).toContain(
      "stalled 6",
    );
  });
});
