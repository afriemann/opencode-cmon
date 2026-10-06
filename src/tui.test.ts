// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-display/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-display/spec.md
// spec: openspec/changes/refine-cost-display/specs/cost-display/spec.md
// spec: openspec/changes/add-model-breakdown/specs/cost-display/spec.md
// spec: openspec/changes/fix-missing-models-crash/specs/cost-display/spec.md
import { afterEach, describe, expect, jest, test } from "bun:test";
import { createRoot } from "solid-js";
import plugin, {
  breakdownLines,
  toggleSegments,
  createCostFeed,
  createOpenState,
  footerLine,
  amount,
  glyph,
  type CostRpcClient,
  type FeedState,
} from "./tui";
import type { Summary } from "./types";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

const SUMMARY: Summary = {
  revision: 1,
  totalMicros: 12_340_000,
  agents: [
    { agent: "build", micros: 8_100_000 },
    { agent: "explore", micros: 3_020_000 },
    { agent: "general", micros: 1_220_000 },
  ],
  models: [
    { model: "anthropic/claude-sonnet-4-5", micros: 9_000_000 },
    { model: "openai/gpt-5-mini", micros: 3_340_000 },
  ],
  complete: true,
};

function fakeClient(
  impl: (input: { from: number; to: number }) => Promise<Summary>,
) {
  const calls: Array<{ from: number; to: number }> = [];
  let handler: () => void = () => {};
  const client: CostRpcClient = {
    summary: async (input) => {
      calls.push(input);
      return impl(input);
    },
    events: { on: (_name, h) => ((handler = () => h({ data: {} })), () => {}) },
  };
  return { client, calls, emit: () => handler() };
}

afterEach(() => jest.useRealTimers());

describe("cost feed", () => {
  test("requests the local calendar month range", async () => {
    const { client, calls } = fakeClient(async () => SUMMARY);
    await createRoot(async (dispose) => {
      createCostFeed(client, () => new Date(2026, 2, 15, 12));
      await flush();
      dispose();
    });
    expect(calls[0]).toEqual({
      from: new Date(2026, 2, 1).getTime(),
      to: new Date(2026, 3, 1).getTime(),
    });
  });

  test("shows loading first, then the summary", async () => {
    const { client } = fakeClient(async () => SUMMARY);
    await createRoot(async (dispose) => {
      const feed = createCostFeed(client);
      expect(feed.state()).toEqual({ kind: "loading" });
      await flush();
      expect(feed.state()).toEqual({ kind: "ready", summary: SUMMARY });
      dispose();
    });
  });

  test("RPC failure", async () => {
    const { client } = fakeClient(async () => {
      throw new Error("down");
    });
    await createRoot(async (dispose) => {
      const feed = createCostFeed(client);
      await flush();
      expect(feed.state()).toEqual({ kind: "error" });
      expect(amount(feed.state())).toBe("Error");
      dispose();
    });
  });

  test("refreshes on changed and on the 60 second safety-net poll", async () => {
    jest.useFakeTimers();
    const { client, calls, emit } = fakeClient(async () => SUMMARY);
    await createRoot(async (dispose) => {
      createCostFeed(client);
      await flush();
      expect(calls.length).toBe(1);
      emit();
      await flush();
      expect(calls.length).toBe(2);
      jest.advanceTimersByTime(60_000);
      await flush();
      expect(calls.length).toBe(3);
      dispose();
    });
  });
});

describe("cost text", () => {
  test("Default wrapped sidebar", () => {
    expect(glyph(false)).toBe("▶");
    expect(amount({ kind: "ready", summary: SUMMARY })).toBe("$12.34");
  });

  test("opened header uses the open glyph", () => {
    expect(glyph(true)).toBe("▼");
  });

  test("Loading and error placeholders", () => {
    expect(amount({ kind: "loading" })).toBe("…");
    expect(amount({ kind: "error" })).toBe("Error");
  });

  test("empty month shows zero dollars", () => {
    expect(
      amount({
        kind: "ready",
        summary: {
          revision: 0,
          totalMicros: 0,
          agents: [],
          models: [],
          complete: true,
        },
      }),
    ).toBe("$0.00");
  });

  test("wrapped footer", () => {
    expect(footerLine({ kind: "ready", summary: SUMMARY }, false)).toBe(
      "▶ $12.34 this month",
    );
  });

  test("Opened footer stays one line", () => {
    expect(footerLine({ kind: "ready", summary: SUMMARY }, true)).toBe(
      "▼ $12.34 · build $8.10 · explore $3.02 · +1",
    );
  });

  test("opened footer without overflow has no +N", () => {
    const summary: Summary = {
      revision: 0,
      totalMicros: 100_000,
      agents: [{ agent: "build", micros: 100_000 }],
      models: [],
      complete: true,
    };
    expect(footerLine({ kind: "ready", summary }, true)).toBe(
      "▼ $0.10 · build $0.10",
    );
  });
});

describe("opened block", () => {
  test("Opened sidebar", () => {
    expect(
      breakdownLines({ kind: "ready", summary: SUMMARY }, "agent"),
    ).toEqual([
      { label: "build", amount: "$8.10" },
      { label: "explore", amount: "$3.02" },
      { label: "general", amount: "$1.22" },
    ]);
    expect(breakdownLines({ kind: "loading" }, "agent")).toEqual([]);
  });

  test("Clicking the toggle shows models", () => {
    expect(
      breakdownLines({ kind: "ready", summary: SUMMARY }, "model"),
    ).toEqual([
      { label: "anthropic/claude-sonnet-4-5", amount: "$9.00" },
      { label: "openai/gpt-5-mini", amount: "$3.34" },
    ]);
    expect(breakdownLines({ kind: "error" }, "model")).toEqual([]);
  });

  test("Summary from an older server", () => {
    const older = { ...SUMMARY, models: undefined };
    const state = { kind: "ready", summary: older } as unknown as FeedState;
    expect(breakdownLines(state, "model")).toEqual([]);
  });

  test("Default breakdown is by agent", () => {
    const text = (mode: "agent" | "model") =>
      toggleSegments(mode)
        .map((s) => s.text)
        .join("  ");
    expect(text("agent")).toBe("View  [Agents]  Models");
    expect(text("model")).toBe("View  Agents  [Models]");
    expect(
      toggleSegments("model")
        .filter((s) => s.bold)
        .map((s) => s.text),
    ).toEqual(["[Models]"]);
  });

  test("Toggle applies everywhere", async () => {
    const saved: Array<{ open: boolean }> = [];
    const view = { open: false };
    const storage = {
      store: () =>
        [
          view,
          async (mutate: (draft: { open: boolean }) => void) => {
            mutate(view);
            saved.push({ ...view });
          },
        ] as const,
    };
    const sidebar = createOpenState(storage);
    const footer = createOpenState(storage);
    sidebar.toggle();
    await flush();
    expect(footer.view.open).toBe(true);
    expect(saved).toEqual([{ open: true }]);
  });
});

describe("footer and placement", () => {
  test("Footer uses the same glyphs", () => {
    const ready: FeedState = { kind: "ready", summary: SUMMARY };
    expect(footerLine(ready, false).startsWith("▶")).toBe(true);
    expect(footerLine(ready, true).startsWith("▼")).toBe(true);
  });

  test("error is spelled out in the footer too", () => {
    expect(footerLine({ kind: "error" }, false)).toBe("▶ Error this month");
  });

  test("Sidebar claim is a prepend", () => {
    const claims: Array<Record<string, unknown>> = [];
    const context = {
      ui: {
        slot: (claim: Record<string, unknown>) => (
          claims.push(claim),
          async () => {}
        ),
      },
    };
    (plugin as unknown as { setup: (c: unknown) => unknown }).setup(context);
    const sidebar = claims.find((c) => c.prepend === "sidebar.content");
    expect(sidebar).toBeDefined();
    expect(claims.some((c) => c.append === "sidebar.content")).toBe(false);
  });

  describe("incomplete pricing", () => {
    const incomplete: FeedState = {
      kind: "ready",
      summary: { ...SUMMARY, complete: false },
    };

    test("Incomplete total is marked", () => {
      expect(amount(incomplete)).toBe("~$12.34");
      expect(footerLine(incomplete, false)).toBe("▶ ~$12.34 this month");
      expect(
        footerLine(incomplete, true).startsWith("▼ ~$12.34 · build $8.10"),
      ).toBe(true);
    });

    test("agent and model lines carry no marker", () => {
      for (const breakdown of ["agent", "model"] as const) {
        expect(
          breakdownLines(incomplete, breakdown).every(
            (line) => !line.amount.includes("~"),
          ),
        ).toBe(true);
      }
    });

    test("Complete total is unmarked", () => {
      expect(amount({ kind: "ready", summary: SUMMARY })).toBe("$12.34");
    });

    test("a summary without the field renders as before", () => {
      const older = { ...SUMMARY, complete: undefined } as unknown as Summary;
      expect(amount({ kind: "ready", summary: older })).toBe("$12.34");
    });
  });
});
