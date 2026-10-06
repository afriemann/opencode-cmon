// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-display/spec.md
import { describe, expect, test } from "bun:test";
import { parseCatalog } from "./pricing";
import { buildSummary } from "./summary";
import type { Candidate } from "./types";

const CATALOG = parseCatalog([
  {
    id: "claude-sonnet-5.5",
    providerID: "github-copilot",
    family: "claude-sonnet",
    cost: [{ input: 2, output: 10, cache: { read: 0.2, write: 0 } }],
  },
]);
const EMPTY = parseCatalog([]);

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  agent: "build",
  providerId: "github-copilot",
  modelId: "claude-sonnet-5.5",
  tokens: { input: 0, cacheRead: 0, cacheWrite: 1_725_111 },
  ...overrides,
});

const aggregate = (micros = 100_000) => ({
  agents: [{ agent: "build", micros }],
  models: [{ model: "github-copilot/claude-sonnet-5.5", micros }],
});

describe("buildSummary", () => {
  test("Summary shows the corrected figure", () => {
    const result = buildSummary(
      aggregate(),
      [candidate({ tokens: { input: 0, cacheRead: 0, cacheWrite: 20_000 } })],
      CATALOG,
    );
    expect(result.totalMicros).toBe(100_000 + 50_000);
    expect(result.agents).toEqual([{ agent: "build", micros: 150_000 }]);
    expect(result.models).toEqual([
      { model: "github-copilot/claude-sonnet-5.5", micros: 150_000 },
    ]);
    expect(result.complete).toBe(true);
  });

  test("Sonnet cache writes are priced", () => {
    const result = buildSummary(aggregate(0), [candidate()], CATALOG);
    expect(result.totalMicros).toBe(4_312_778);
  });

  test("No add-on outside the rule", () => {
    const gpt = candidate({ modelId: "gpt-5.3-codex" });
    const noWrites = candidate({
      tokens: { input: 5, cacheRead: 5, cacheWrite: 0 },
    });
    const result = buildSummary(aggregate(), [gpt, noWrites], CATALOG);
    expect(result.totalMicros).toBe(100_000);
    expect(result.complete).toBe(true);
  });

  test("NULL tokens mark the summary incomplete", () => {
    const result = buildSummary(
      aggregate(),
      [candidate({ tokens: null })],
      CATALOG,
    );
    expect(result.totalMicros).toBe(100_000);
    expect(result.complete).toBe(false);
  });

  test("An unpriced model marks the summary incomplete", () => {
    const result = buildSummary(aggregate(), [candidate()], EMPTY);
    expect(result.totalMicros).toBe(100_000);
    expect(result.complete).toBe(false);
    expect(result.unpriced).toEqual(["github-copilot/claude-sonnet-5.5"]);
  });

  test("a retired Claude model without a catalog entry is unpriced, a non-Claude one is ignored", () => {
    const retired = candidate({ modelId: "claude-sonnet-4.6" });
    const result = buildSummary(
      aggregate(),
      [retired, candidate({ modelId: "gpt-5" })],
      CATALOG,
    );
    expect(result.unpriced).toEqual(["github-copilot/claude-sonnet-4.6"]);
  });

  test("The add-on follows the catalog", () => {
    const rows = [candidate()];
    const empty = buildSummary(aggregate(0), rows, EMPTY);
    const priced = buildSummary(aggregate(0), rows, CATALOG);
    expect(empty.totalMicros).toBe(0);
    expect(priced.totalMicros).toBe(4_312_778);
  });

  test("lists are sorted by amount then name after the add-on and totals match both lists", () => {
    const result = buildSummary(
      {
        agents: [
          { agent: "zeta", micros: 10 },
          { agent: "alpha", micros: 10 },
          { agent: "build", micros: 1 },
        ],
        models: [
          { model: "github-copilot/claude-sonnet-5.5", micros: 1 },
          { model: "p/m", micros: 20 },
        ],
      },
      [candidate({ tokens: { input: 0, cacheRead: 0, cacheWrite: 100 } })],
      CATALOG,
    );
    expect(result.agents.map((a) => a.agent)).toEqual([
      "build",
      "alpha",
      "zeta",
    ]);
    expect(result.models.map((m) => m.model)).toEqual([
      "github-copilot/claude-sonnet-5.5",
      "p/m",
    ]);
    const sum = (list: ReadonlyArray<{ micros: number }>) =>
      list.reduce((t, e) => t + e.micros, 0);
    expect(sum(result.agents)).toBe(result.totalMicros);
    expect(sum(result.models)).toBe(result.totalMicros);
  });

  test("a candidate missing from the aggregates gets its own buckets", () => {
    const result = buildSummary(
      { agents: [], models: [] },
      [candidate()],
      CATALOG,
    );
    expect(result.agents).toEqual([{ agent: "build", micros: 4_312_778 }]);
    expect(result.models).toHaveLength(1);
  });
});
