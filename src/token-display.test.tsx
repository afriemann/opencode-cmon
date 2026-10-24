// spec: openspec/changes/archive/2026-10-24-toggle-token-display/specs/cost-display/spec.md
// UX: openspec/changes/archive/2026-10-24-toggle-token-display/ux.md
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { CostFooter, CostSidebar, type CostRpcClient } from "./tui";
import {
  server,
  storage,
  uiContext,
  type TokenReply,
} from "./test-support/token-host";

const reply: TokenReply = {
  revision: 1,
  totalMicros: 12_340_000,
  complete: false,
  agents: [
    { agent: "expensive", micros: 12_000_000 },
    { agent: "busy", micros: 300_000 },
    { agent: "third", micros: 40_000 },
  ],
  models: [{ model: "model", micros: 12_340_000 }],
  providers: [{ provider: "provider", micros: 12_340_000 }],
  tokens: {
    totalTokens: 1234,
    complete: true,
    agents: [
      { agent: "busy", totalTokens: 1000, complete: true },
      { agent: "third", totalTokens: 234, complete: true },
      { agent: "expensive", totalTokens: 0, complete: true },
    ],
    models: [{ model: "model", totalTokens: 1234, complete: true }],
    providers: [{ provider: "provider", totalTokens: 1234, complete: true }],
  },
};

function feed(initial = reply) {
  let current = initial;
  let failure = false;
  let calls = 0;
  const handlers = new Set<(event: { data: unknown }) => void>();
  const client: CostRpcClient = {
    summary: async () => {
      calls++;
      if (failure) throw new Error("test failure");
      return current;
    },
    events: {
      on: (_name, callback) => {
        handlers.add(callback);
        return () => {
          handlers.delete(callback);
        };
      },
    },
  };
  return {
    client,
    calls: () => calls,
    refresh: (next = current, fail = false) => {
      current = next;
      failure = fail;
      for (const handler of handlers)
        handler({ data: { revision: next.revision } });
    },
  };
}

async function render(
  client: CostRpcClient,
  width = 80,
  state = storage(),
  panelWidth = width,
) {
  const context = uiContext(client, state);
  const [sidebar, showSidebar] = createSignal(true);
  const [footer, showFooter] = createSignal(true);
  const [containerWidth, resizePanel] = createSignal(panelWidth);
  const [footerWidth, resizeFooter] = createSignal(width);
  let ancestorClicks = 0;
  const t = await testRender(
    () => (
      <box>
        <box
          id="test-sidebar-container"
          width={containerWidth()}
          flexShrink={0}
          onMouseDown={() => ancestorClicks++}
        >
          <Show when={sidebar()}>
            <CostSidebar context={context} />
          </Show>
        </box>
        <box width={footerWidth()} flexShrink={0}>
          <Show when={footer()}>
            <CostFooter context={context} />
          </Show>
        </box>
      </box>
    ),
    { width, height: 30 },
  );
  const frame = async () => {
    await Bun.sleep(20);
    await t.renderOnce();
    return t.captureCharFrame().split("\n");
  };
  const click = async (text: string) => {
    const rows = await frame();
    const y = rows.findIndex((row) => row.includes(text));
    expect(y, `Missing rendered control: ${text}`).toBeGreaterThanOrEqual(0);
    await t.mockMouse.click(rows[y]!.indexOf(text), y);
    return frame();
  };
  await frame();
  return {
    t,
    frame,
    click,
    state,
    showSidebar,
    showFooter,
    resizePanel,
    resizeFooter,
    ancestorClicks: () => ancestorClicks,
  };
}

describe("rendered unit selection", () => {
  test("TOK-21 footer compacts before one-line clipping at its own width; raw token order survives equal strings", async () => {
    const ranked: TokenReply = {
      ...reply,
      tokens: {
        totalTokens: 2467,
        complete: true,
        agents: [
          { agent: "z-higher", totalTokens: 1234, complete: true },
          { agent: "a-lower", totalTokens: 1233, complete: true },
        ],
        models: [],
        providers: [],
      },
    };
    const r = await render(feed(ranked).client, 120, storage(), 45);
    try {
      await r.click("Tokens");
      const rows = await r.frame();
      const z = rows.findIndex((row) => row.trimStart().startsWith("z-higher"));
      const a = rows.findIndex((row) => row.trimStart().startsWith("a-lower"));
      expect(z).toBeGreaterThan(0);
      expect(a).toBe(z + 1);
      expect(rows[z]).toContain("1.23k tokens");
      expect(rows[a]).toContain("1.23k tokens");
      expect(rows.join("\n")).not.toContain("Partial:");
      r.showSidebar(false);
      for (const size of [120, 45, 22]) {
        r.resizeFooter(size);
        const footer = (await r.frame()).filter((row) => row.trim() !== "");
        expect(footer).toHaveLength(1);
        expect(footer[0]!.trimEnd().length).toBeLessThanOrEqual(size);
        expect(footer[0]).toContain("▼ 2.47k tokens");
        if (size === 120)
          expect(footer[0]).toContain(
            "z-higher 1.23k tokens · a-lower 1.23k tokens",
          );
      }
    } finally {
      r.t.renderer.destroy();
    }
  });
  test.each([45, 40, 22])(
    "TOK-16 atomic controls at actual %i cells inside 120-cell terminal, six selections and resize",
    async (width) => {
      const f = feed();
      const r = await render(f.client, 120, storage(), width);
      // Sidebar-only frames ensure a readable footer cannot hide broken sidebar text.
      r.showFooter(false);
      const check = async (
        size: number,
        activeView: string,
        activeUnit: string,
      ) => {
        const rows = await r.frame();
        expect(r.t.renderer.width).toBe(120);
        const container = r.t.renderer.root.findDescendantById(
          "test-sidebar-container",
        );
        expect(container?.width).toBe(size);
        const viewY = rows.findIndex((row) => row.includes("View"));
        const unitY = rows.findIndex((row) => row.includes("Unit"));
        expect(viewY, rows.slice(0, 12).join("\n")).toBeGreaterThan(0);
        expect(unitY).toBe(viewY + (size === 22 ? 3 : 1));
        const expected =
          size === 22
            ? ([
                ["View", 0, 2],
                ["Agents", 0, 8],
                ["Models", 1, 2],
                ["Providers", 2, 2],
              ] as const)
            : ([
                ["View", 0, 2],
                ["Agents", 0, 8],
                ["Models", 0, 18],
                ["Providers", 0, 28],
              ] as const);
        for (const [label, dy, x] of expected) {
          const text = label === activeView ? `[${label}]` : label;
          expect(
            rows[viewY + dy]!.indexOf(text),
            `${label} is atomic with stable reserved width`,
          ).toBe(x);
        }
        for (const [label, x] of [
          ["Unit", 2],
          ["$", 8],
          ["Tokens", 13],
        ] as const) {
          const text = label === activeUnit ? `[${label}]` : label;
          expect(rows[unitY]!.indexOf(text)).toBe(x);
        }
        expect(rows.every((row) => row.trimEnd().length <= size)).toBe(true);
        return rows;
      };
      try {
        // Dollar-only check fails on old terminal-based packing independently of compact formatting.
        await check(width, "Agents", "$");
        const calls = f.calls();
        for (const unit of ["$", "Tokens"]) {
          await r.click(unit === "$" ? "[$]" : "Tokens");
          for (const view of ["Agents", "Models", "Providers"]) {
            await r.click(view);
            const rows = await check(width, view, unit);
            const expectedAmount = unit === "$" ? "~$12.34" : "1.23k tokens";
            expect(rows[unit === "Tokens" && width === 22 ? 1 : 0]).toContain(
              expectedAmount,
            );
            await r.click(`[${view}]`);
            await r.click(`[${unit}]`);
            await r.click("View");
            await r.click("Unit");
            const unitY = rows.findIndex((row) => row.includes("Unit"));
            // Reserved unused choice cells and gaps are never targets.
            for (const x of unit === "Tokens" ? [9, 10, 11] : [11, 19, 20])
              await r.t.mockMouse.click(x, unitY);
            await check(width, view, unit);
            expect(r.state.view.open).toBe(true);
          }
        }
        for (const resized of [22, 45, 40, width]) {
          r.resizePanel(resized);
          await check(resized, "Providers", "Tokens");
        }
        expect(f.calls()).toBe(calls);
        expect(r.state.durableWrites).toEqual([]);
        expect(r.ancestorClicks()).toBe(0);
      } finally {
        r.t.renderer.destroy();
      }
    },
  );

  test.each([45, 40, 22])(
    "TOK-17 compact billion header, long names and partial amounts stay intact at %i cells",
    async (width) => {
      const name = "readable-but-extremely-long-breakdown-name";
      const large: TokenReply = {
        ...reply,
        tokens: {
          totalTokens: 1_578_717_226,
          complete: false,
          agents: [
            { agent: name, totalTokens: 1_578_717_226, complete: false },
          ],
          models: [
            { model: name, totalTokens: 1_578_717_226, complete: false },
          ],
          providers: [
            { provider: name, totalTokens: 1_578_717_226, complete: false },
          ],
        },
      };
      const r = await render(feed(large).client, 120, storage(), width);
      r.showFooter(false);
      try {
        await r.click("Tokens");
        for (const view of ["Agents", "Models", "Providers"]) {
          await r.click(view);
          const rows = await r.frame();
          if (width === 22) {
            expect(rows[0]!.trimEnd()).toBe("▼ This month:");
            expect(rows[1]!.trimEnd()).toBe("  ~1.58B tokens");
          } else expect(rows[0]!.trimEnd()).toBe("▼ This month: ~1.58B tokens");
          const dataY = rows.findIndex((row) =>
            row.trimStart().startsWith("read"),
          );
          expect(dataY).toBeGreaterThan(
            rows.findIndex((row) => row.includes("Unit")),
          );
          const data = rows[dataY]!;
          expect(data).toContain("…");
          expect(data).toMatch(/read.*… +~1\.58B tokens\s*$/);
          expect(data.trimEnd().length).toBe(width); // amount right-aligned, name alone truncated
          expect(rows.every((row) => row.trimEnd().length <= width)).toBe(true);
        }
        await r.t.mockMouse.click(0, 0);
        const collapsed = await r.frame();
        expect(collapsed.join("\n")).not.toContain("Unit");
        expect(collapsed.some((row) => row.includes("~1.58B tokens"))).toBe(
          true,
        );
      } finally {
        r.t.renderer.destroy();
      }
    },
  );

  test("TOK-18 unavailable amounts stack below readable names when fewer than four name cells remain", async () => {
    const missing: TokenReply = {
      ...reply,
      tokens: {
        totalTokens: null,
        complete: false,
        agents: [
          {
            agent: "readable-long-agent-name",
            totalTokens: null,
            complete: false,
          },
        ],
        models: [],
        providers: [],
      },
    };
    const r = await render(feed(missing).client, 120, storage(), 22);
    r.showFooter(false);
    try {
      await r.click("Tokens");
      const rows = await r.frame();
      const y = rows.findIndex((row) => row.trimStart().startsWith("readable"));
      expect(y).toBeGreaterThan(0);
      expect(rows[y]!.trimEnd()).toMatch(/^ {2}readable.*…$/);
      expect(rows[y + 1]!.trimEnd()).toBe("  Tokens unavailable");
      expect(rows[0]!.trimEnd()).toBe("▼ This month:");
      expect(rows[1]!.trimEnd()).toBe("  Tokens unavailable");
      expect(rows.every((row) => row.trimEnd().length <= 22)).toBe(true);
    } finally {
      r.t.renderer.destroy();
    }
  });

  test("TOK-11 group-specific coverage and compact counts follow each breakdown", async () => {
    const mixed: TokenReply = {
      ...reply,
      tokens: {
        totalTokens: 1235,
        complete: false,
        agents: [
          { agent: "complete", totalTokens: 1234, complete: true },
          { agent: "partial", totalTokens: 1, complete: false },
          { agent: "missing", totalTokens: null, complete: false },
        ],
        models: [{ model: "model", totalTokens: 1235, complete: false }],
        providers: [
          { provider: "provider", totalTokens: 1235, complete: false },
        ],
      },
    };
    const r = await render(feed(mixed).client, 100);
    try {
      const rows = await r.click("Tokens");
      expect(rows[0]).toContain("~1.24k tokens");
      expect(
        rows.find((row) => row.trimStart().startsWith("complete")),
      ).toMatch(/[^~]1\.23k tokens/);
      expect(
        rows.find((row) => row.trimStart().startsWith("partial")),
      ).toContain("~1 token");
      expect(
        rows.find((row) => row.trimStart().startsWith("missing")),
      ).toContain("Tokens unavailable");
      expect((await r.click("Models")).join("\n")).toContain("~1.24k tokens");
      expect((await r.click("Providers")).join("\n")).toContain("provider");
      expect((await r.frame()).join("\n")).not.toContain("~1.23k tokens");
    } finally {
      r.t.renderer.destroy();
    }
  });
  test("TOK-04 switch both ways, preserve Models/open, no extra RPC or accounting preference write", async () => {
    const f = feed();
    const r = await render(f.client);
    try {
      await r.click("Models");
      const beforeCalls = f.calls();
      const tokens = (await r.click("Tokens")).join("\n");
      expect(tokens).toContain("[Tokens]");
      expect(tokens).toContain("[Models]");
      expect(tokens).toContain("1.23k tokens");
      expect(tokens).not.toContain("Partial:");
      expect(tokens).toContain("busy 1k tokens");
      expect(tokens).toContain("third 234 tokens");
      expect(tokens).toContain("+1");
      expect(tokens).not.toContain("expensive 0 tokens"); // footer top two, sidebar Models
      expect(r.state.view.open).toBe(true);
      expect(f.calls()).toBe(beforeCalls);
      expect(r.state.durableWrites).toEqual([]);
      const dollars = (await r.click("Unit  $")).join("\n");
      // Click the actual choice, not the label (see dedicated no-op test below).
      expect(dollars).toContain("[Tokens]");
      const rows = await r.frame();
      const y = rows.findIndex((row) => row.includes("Unit"));
      await r.t.mockMouse.click(rows[y]!.indexOf("$"), y);
      const restored = (await r.frame()).join("\n");
      expect(restored).toContain("~$12.34");
      expect(restored).toContain("[Models]");
      expect(restored).toContain("expensive $12.00");
      expect(restored).toContain("busy $0.30");
      expect(restored).not.toContain("Partial:");
    } finally {
      r.t.renderer.destroy();
    }
  });

  test.each([80, 45, 40, 22])(
    "TOK-05 active, label, gap clicks and drag at %i cells do not change unit or collapse",
    async (width) => {
      const r = await render(feed().client, 120, storage(), width);
      try {
        await r.click("Tokens");
        for (const text of ["[Tokens]", "Unit", "View"]) await r.click(text);
        const rows = await r.frame();
        const y = rows.findIndex((row) => row.includes("Unit"));
        await r.t.mockMouse.click(rows[y]!.indexOf("Unit") + 4, y);
        expect((await r.frame()).join("\n")).toContain("[Tokens]");
        expect(r.state.view.open).toBe(true);
        expect(r.ancestorClicks()).toBe(0);
        const dataY = (await r.frame()).findIndex(
          (row) =>
            row.includes("busy") &&
            !row.includes("this month") &&
            !row.includes("+1"),
        );
        await r.t.mockMouse.drag(8, dataY, 0, 0);
        await r.frame();
        const selected = r.t.renderer.getSelection()?.getSelectedText() ?? "";
        expect(selected).toContain("busy");
        expect(selected).not.toMatch(/Unit|Tokens\]|View|This month/);
        expect((await r.frame()).join("\n")).toContain("[Tokens]");
        expect(r.state.durableWrites).toEqual([]);
      } finally {
        r.t.renderer.destroy();
      }
    },
  );

  test("TOK-06 refresh/error/collapse and independent slot remount retain shared unit; restart resets", async () => {
    const f = feed();
    const state = storage();
    const r = await render(f.client, 100, state);
    try {
      await r.click("Tokens");
      r.showFooter(false);
      await r.frame();
      r.showFooter(true);
      expect((await r.frame()).join("\n")).toContain("busy 1k tokens");
      r.showSidebar(false);
      await r.frame();
      expect((await r.frame()).join("\n")).toContain("1.23k tokens");
      r.showSidebar(true);
      expect((await r.frame()).join("\n")).toContain("[Tokens]");
      await r.t.mockMouse.click(0, 0);
      expect((await r.frame()).join("\n")).not.toContain("Unit");
      expect((await r.frame()).join("\n")).toContain("1.23k tokens this month");
      await r.t.mockMouse.click(0, 0);
      f.refresh(reply, true);
      const failed = (await r.frame()).join("\n");
      expect(failed).toContain("Error");
      expect(failed).not.toContain("Unit");
      f.refresh();
      expect((await r.frame()).join("\n")).toContain("[Tokens]");
    } finally {
      r.t.renderer.destroy();
    }
    // New plugin mount, same session storage (hot reload) must retain tokens.
    const reload = await render(f.client, 100, state);
    try {
      expect((await reload.frame()).join("\n")).toContain("[Tokens]");
    } finally {
      reload.t.renderer.destroy();
    }
    const restart = await render(f.client, 100, storage(state.view.open));
    try {
      const text = (await restart.frame()).join("\n");
      expect(text).toContain("[$]");
      expect(text).toContain("~$12.34");
    } finally {
      restart.t.renderer.destroy();
    }
  });

  test.each([
    [
      "partial",
      {
        totalTokens: 0,
        complete: false,
        agents: [{ agent: "unknown", totalTokens: 0, complete: false }],
        models: [{ model: "unknown", totalTokens: 0, complete: false }],
        providers: [{ provider: "unknown", totalTokens: 0, complete: false }],
      },
      "~0 tokens",
      true,
    ],
    [
      "unavailable",
      {
        totalTokens: null,
        complete: false,
        agents: [{ agent: "unknown", totalTokens: null, complete: false }],
        models: [{ model: "unknown", totalTokens: null, complete: false }],
        providers: [
          { provider: "unknown", totalTokens: null, complete: false },
        ],
      },
      "Tokens unavailable",
      true,
    ],
    ["legacy", undefined, "Tokens unavailable", true],
    [
      "empty",
      { totalTokens: 0, complete: true, agents: [], models: [], providers: [] },
      "0 tokens",
      false,
    ],
  ] as const)(
    "TOK-07 %s history remains ready",
    async (_name, tokens, expected, partial) => {
      const input: TokenReply = { ...reply };
      if (tokens) input.tokens = tokens;
      else delete input.tokens;
      const r = await render(feed(input).client);
      try {
        const text = (await r.click("Tokens")).join("\n");
        expect(text).toContain(expected);
        expect(text.includes("Partial: some token counts unavailable")).toBe(
          partial,
        );
        expect(text).not.toContain("Error");
        expect(text).toContain("[Tokens]");
      } finally {
        r.t.renderer.destroy();
      }
    },
  );

  test("TOK-10 loading hides selectors; legacy missing lists never invent rows", async () => {
    const pending: CostRpcClient = {
      summary: () => new Promise(() => {}),
      events: { on: () => () => {} },
    };
    const loading = await render(pending);
    try {
      const text = (await loading.frame()).join("\n");
      expect(text).toContain("This month: …");
      expect(text).not.toMatch(/View|Unit|Tokens/);
    } finally {
      loading.t.renderer.destroy();
    }
    // Oldest supported wire reply: models/providers are optional in RPC schema.
    const legacy = {
      revision: 0,
      totalMicros: 0,
      agents: [],
      complete: true,
    } as unknown as TokenReply;
    const r = await render(feed(legacy).client);
    try {
      await r.click("Tokens");
      await r.click("Models");
      const text = (await r.frame()).join("\n");
      expect(text).toContain("Tokens unavailable");
      expect(text).toContain("[Models]");
      expect(text).not.toContain("0 tokens");
    } finally {
      r.t.renderer.destroy();
    }
  });

  test.each([45, 40, 22])(
    "TOK-08 intact compact values and reachable controls in %i-cell panel / 120-cell terminal",
    async (width) => {
      const large: TokenReply = {
        ...reply,
        tokens: {
          totalTokens: 1_234_567_890_123,
          complete: false,
          agents: [
            { agent: "busy", totalTokens: 1_234_567_890_123, complete: false },
          ],
          models: [],
          providers: [],
        },
      };
      const r = await render(feed(large).client, 120, storage(), width);
      r.showFooter(false);
      try {
        await r.click("Tokens");
        // Assert a whole amount on a sidebar line, not concatenated fragments or footer text.
        const sidebar = await r.frame();
        expect(sidebar.some((row) => row.includes("~1234.57B tokens"))).toBe(
          true,
        );
        expect(sidebar.every((row) => row.trimEnd().length <= width)).toBe(
          true,
        );
        await r.click("Providers");
        expect((await r.frame()).join("\n")).toContain("[Providers]");
      } finally {
        r.t.renderer.destroy();
      }
    },
  );

  test("TOK-09 first use: real recorder/store/changed/RPC reaches rendered zero then usage", async () => {
    const host = await server();
    const r = await render(host.client, 100);
    try {
      expect(host.subscribed()).toBe(true);
      const empty = (await r.click("Tokens")).join("\n");
      expect(empty).toContain("0 tokens");
      expect(empty).not.toContain("Partial:");
      host.push(
        {
          id: "start",
          type: "session.step.started",
          data: {
            sessionID: "child",
            assistantMessageID: "first",
            agent: "build",
            model: { providerID: "test", id: "model" },
            started: Date.now(),
          },
        },
        {
          id: "end",
          type: "session.step.ended",
          data: {
            sessionID: "child",
            assistantMessageID: "first",
            cost: 0.25,
            tokens: {
              input: 100,
              output: 40,
              reasoning: 60,
              cache: { read: 200, write: 300 },
            },
          },
        },
      );
      let text = "";
      for (let attempt = 0; attempt < 50; attempt++) {
        text = (await r.frame()).join("\n");
        if (text.includes("700 tokens")) break;
      }
      expect(text).toContain("700 tokens");
      expect(text).toContain("build 700 tokens");
      const before = host.db.query("SELECT * FROM cost_entry").all();
      expect(before).toHaveLength(1);
      const rows = await r.frame();
      const y = rows.findIndex((row) => row.includes("Unit"));
      await r.t.mockMouse.click(rows[y]!.indexOf("$"), y);
      expect((await r.frame()).join("\n")).toContain("$0.25");
      expect(host.db.query("SELECT * FROM cost_entry").all()).toEqual(before);
    } finally {
      r.t.renderer.destroy();
      try {
        expect(host.listeners()).toBe(0);
      } finally {
        await host.close();
      }
      expect(existsSync(host.dir)).toBe(false);
    }
  }, 10_000);
});
