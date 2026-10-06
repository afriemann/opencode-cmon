// spec: openspec/changes/add-provider-breakdown/specs/cost-display/spec.md
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
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
  readonly summary?: () => Promise<Summary>;
}

function context({ open = true, summary }: Setup, saves: unknown[]) {
  const view = { open };
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
          mutate(view);
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
  const saves: unknown[] = [];
  const t = await testRender(
    () => <CostSidebar context={context(setup, saves)} />,
    { width: 40, height: 8 },
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
