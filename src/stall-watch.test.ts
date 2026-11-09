// spec: openspec/specs/cost-display/spec.md
import { describe, expect, test } from "bun:test";
import {
  createStallWatch,
  ongoingStalls,
  STALL_IDLE_MS,
  type StallAlert,
} from "./stall-watch";
import type { CostRow } from "./types";

let n = 0;
const step = (cacheRead: number, input = 60_000): CostRow => ({
  id: `m${++n}`,
  sessionId: "s1",
  parentSessionId: null,
  agent: "build",
  providerId: "github-copilot",
  modelId: "gpt-6.1-sol",
  kind: "step",
  failed: false,
  costMicros: 1_000_000,
  tokens: { input, cacheRead, cacheWrite: 0 },
  outputTokens: 1,
  reasoningTokens: 0,
  finish: "stop",
  directory: null,
  createdAt: n * 1000,
});

function harness() {
  const rows: CostRow[] = [];
  const alerts: StallAlert[] = [];
  const watch = createStallWatch({
    sessionSteps: () => rows,
    catalog: () => new Map(),
    now: () => 1_000_000,
    announce: (a) => alerts.push(a),
  });
  const record = (row: CostRow) => {
    rows.push(row);
    watch.observe(row);
  };
  return { alerts, record };
}

describe("stall watch", () => {
  test("Stall announced once", () => {
    const { alerts, record } = harness();
    for (let i = 0; i < 7; i += 1) record(step(36_655));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ sessionId: "s1", steps: 5 });
  });

  test("Stall after recovery is announced again", () => {
    const { alerts, record } = harness();
    for (let i = 0; i < 5; i += 1) record(step(36_655));
    record(step(400_000, 30_000));
    for (let i = 0; i < 5; i += 1) record(step(36_655));
    expect(alerts).toHaveLength(2);
  });

  test("Healthy steps never announce", () => {
    const { alerts, record } = harness();
    for (let i = 0; i < 8; i += 1) record(step(100_000 + i * 50_000, 30_000));
    expect(alerts).toEqual([]);
  });
});

describe("ongoing stalls for the summary", () => {
  const session = (id: string, cacheRead: number[], input = 60_000) =>
    cacheRead.map((c) => ({ ...step(c, input), sessionId: id }));
  const last = (rows: CostRow[]) => rows[rows.length - 1]!.createdAt;

  test("Late-connecting TUI sees an ongoing stall", () => {
    const rows = session("a", [1, 2, 3, 4, 5].map(() => 36_655));
    expect(ongoingStalls(rows, new Map(), last(rows))).toMatchObject([
      { sessionId: "a", steps: 5 },
    ]);
  });

  test("Recovered stall is not listed", () => {
    const rows = [
      ...session("a", Array(5).fill(36_655)),
      ...session("a", [400_000], 30_000),
    ];
    expect(ongoingStalls(rows, new Map(), last(rows))).toEqual([]);
  });

  test("Idle stalls are not listed, and the list is capped by cost", () => {
    const rows = ["a", "b", "c", "d"].flatMap((id) =>
      session(id, Array(5).fill(36_655)),
    );
    expect(ongoingStalls(rows, new Map(), last(rows))).toHaveLength(3);
    expect(
      ongoingStalls(rows, new Map(), last(rows) + STALL_IDLE_MS + 1),
    ).toEqual([]);
  });
});
