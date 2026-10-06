// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-display/spec.md
import { afterEach, describe, expect, jest, test } from "bun:test";
import { createRoot } from "solid-js";
import {
  agentLines,
  createCostFeed,
  createOpenState,
  footerLine,
  sidebarHeader,
  type CostRpcClient,
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
    expect(sidebarHeader({ kind: "ready", summary: SUMMARY }, false)).toBe(
      "▸ This month: $12.34",
    );
  });

  test("opened header uses the open glyph", () => {
    expect(sidebarHeader({ kind: "ready", summary: SUMMARY }, true)).toBe(
      "▾ This month: $12.34",
    );
  });

  test("Loading and error placeholders", () => {
    expect(sidebarHeader({ kind: "loading" }, false)).toBe("▸ This month: …");
    expect(sidebarHeader({ kind: "error" }, false)).toBe("▸ This month: —");
  });

  test("empty month shows zero dollars", () => {
    expect(
      sidebarHeader(
        { kind: "ready", summary: { revision: 0, totalMicros: 0, agents: [] } },
        false,
      ),
    ).toBe("▸ This month: $0.00");
  });

  test("wrapped footer", () => {
    expect(footerLine({ kind: "ready", summary: SUMMARY }, false)).toBe(
      "▸ $12.34 this month",
    );
  });

  test("Opened footer stays one line", () => {
    expect(footerLine({ kind: "ready", summary: SUMMARY }, true)).toBe(
      "▾ $12.34 · build $8.10 · explore $3.02 · +1",
    );
  });

  test("opened footer without overflow has no +N", () => {
    const summary: Summary = {
      revision: 0,
      totalMicros: 100_000,
      agents: [{ agent: "build", micros: 100_000 }],
    };
    expect(footerLine({ kind: "ready", summary }, true)).toBe(
      "▾ $0.10 · build $0.10",
    );
  });
});

describe("opened block", () => {
  test("Opened sidebar", () => {
    expect(agentLines({ kind: "ready", summary: SUMMARY })).toEqual([
      { agent: "build", amount: "$8.10" },
      { agent: "explore", amount: "$3.02" },
      { agent: "general", amount: "$1.22" },
    ]);
    expect(agentLines({ kind: "loading" })).toEqual([]);
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
