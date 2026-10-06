// spec: openspec/changes/add-provider-breakdown/specs/cost-display/spec.md
// spec: openspec/changes/unselectable-controls/specs/cost-display/spec.md
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createStore, produce } from "solid-js/store";
import { CostSidebar } from "./tui";
import type { Summary } from "./types";

const SUMMARY: Summary = {
  revision: 1,
  totalMicros: 12_340_000,
  agents: [{ agent: "build", micros: 12_340_000 }],
  models: [{ model: "claude-sonnet-4-5", micros: 12_340_000 }],
  providers: [{ provider: "anthropic", micros: 12_340_000 }],
  complete: true,
};

interface Setup {
  readonly open?: boolean;
  readonly width?: number;
  readonly summary?: () => Promise<Summary>;
}

function context({ open = true, summary }: Setup, saves: unknown[]) {
  const [view, setView] = createStore({ open });
  const color = (base: string) => ({ base });
  return {
    client: {
      rpc: () => ({
        summary: summary ?? (async () => SUMMARY),
        events: { on: () => () => {} },
      }),
    },
    storage: {
      store: () => [
        view,
        async (mutate: (draft: { open: boolean }) => void) => {
          setView(produce(mutate));
          saves.push({ ...view });
        },
      ],
    },
    theme: {
      text: {
        base: "#ffffff",
        muted: "#888888",
        feedback: { error: color("#ff0000") },
        action: { primary: color("#00aaff") },
      },
    },
  } as never;
}

async function render(setup: Setup = {}) {
  const { width = 40 } = setup;
  const saves: unknown[] = [];
  const t = await testRender(
    () => <CostSidebar context={context(setup, saves)} />,
    { width, height: 8 },
  );
  const frame = async (): Promise<string[]> => {
    await Bun.sleep(20);
    await t.renderOnce();
    return t.captureCharFrame().split("\n");
  };
  await frame();
  return { t, frame, saves };
}

/** Column of the first character of `word` on the toggle row. */
const col = (rows: string[], word: string): number => rows[1]!.indexOf(word);

describe("sidebar tabs", () => {
  test("Clicking the toggle shows models", async () => {
    const { t, frame } = await render();
    const rows = await frame();
    await t.mockMouse.click(col(rows, "Models"), 1);
    const after = await frame();
    expect(after[1]!.trim()).toBe("View  Agents  [Models]  Providers");
    expect(after[2]).toContain("claude-sonnet-4-5");
    t.renderer.destroy();
  });

  test("Breakdown choice does not leak into other state", async () => {
    const { t, frame, saves } = await render();
    const rows = await frame();
    await t.mockMouse.click(col(rows, "Models"), 1);
    expect((await frame())[0]).toContain("▼");
    expect(saves).toEqual([]);
    t.renderer.destroy();
  });

  test("Clicking the Providers tab shows providers", async () => {
    const { t, frame } = await render();
    const rows = await frame();
    await t.mockMouse.click(col(rows, "Providers"), 1);
    const after = await frame();
    expect(after[1]!.trim()).toBe("View  Agents  Models  [Providers]");
    expect(after[2]).toContain("anthropic");
    t.renderer.destroy();
  });

  test("Clicks outside the tabs do nothing", async () => {
    const { t, frame, saves } = await render();
    const rows = await frame();
    const agents = col(rows, "[Agents]");
    await t.mockMouse.click(col(rows, "View"), 1);
    await t.mockMouse.click(agents + 3, 1);
    await t.mockMouse.click(agents + "[Agents]".length, 1);
    await t.mockMouse.click(38, 1);
    const after = await frame();
    expect(after[0]).toContain("▼");
    expect(after[1]!.trim()).toBe("View  [Agents]  Models  Providers");
    expect(saves).toEqual([]);
    t.renderer.destroy();
  });

  test("Toggle is absent when not ready or wrapped", async () => {
    const pending = () => new Promise<Summary>(() => {});
    const failing = () => Promise.reject(new Error("rpc down"));
    for (const setup of [
      { summary: pending },
      { summary: failing },
      { open: false },
    ]) {
      const { t, frame } = await render(setup);
      expect((await frame()).join("\n")).not.toContain("View");
      t.renderer.destroy();
    }
  });
});

interface Walkable {
  getChildren?(): Walkable[];
  plainText?: string;
  selectable?: boolean;
}

/** Selectable flag of every text renderable, keyed by its plain text. */
function selectableByText(root: Walkable): Map<string, boolean> {
  const found = new Map<string, boolean>();
  const visit = (node: Walkable): void => {
    if (typeof node.plainText === "string" && node.plainText !== "")
      found.set(node.plainText, node.selectable ?? true);
    for (const child of node.getChildren?.() ?? []) visit(child);
  };
  visit(root);
  return found;
}

describe("sidebar chrome", () => {
  test("Chrome is not selectable", async () => {
    const { t, frame } = await render();
    const rows = await frame();
    const flags = selectableByText(t.renderer.root as unknown as Walkable);
    for (const chrome of [
      "▼",
      "This month: ",
      "View",
      "[Agents]",
      "Models",
      "Providers",
    ])
      expect([chrome, flags.get(chrome)]).toEqual([chrome, false]);
    for (const content of ["$12.34", "build"])
      expect([content, flags.get(content)]).toEqual([content, true]);
    expect(rows[0]!.trimEnd()).toBe("▼ This month: $12.34");
    t.renderer.destroy();
  });

  test("Header layout holds in a narrow sidebar", async () => {
    const { t, frame } = await render({ width: 22 });
    expect((await frame())[0]!.trimEnd()).toBe("▼ This month: $12.34");
    t.renderer.destroy();
  });

  test("Controls still work", async () => {
    const { t, frame } = await render();
    const rows = await frame();
    await t.mockMouse.click(col(rows, "Providers"), 1);
    expect((await frame())[1]!.trim()).toBe(
      "View  Agents  Models  [Providers]",
    );
    await t.mockMouse.click(0, 0);
    expect((await frame())[1] ?? "").not.toContain("View");
    t.renderer.destroy();
  });
});

describe("sidebar selection", () => {
  test("A drag across the block selects only the content", async () => {
    const { t, frame } = await render();
    await frame();
    await t.mockMouse.drag(6, 2, 0, 0);
    await frame();
    const selected = t.renderer.getSelection()?.getSelectedText() ?? "";
    expect(selected).toContain("build");
    expect(selected).not.toContain("This month");
    expect(selected).not.toContain("View");
    expect(selected).not.toContain("▼");
    t.renderer.destroy();
  });
});
