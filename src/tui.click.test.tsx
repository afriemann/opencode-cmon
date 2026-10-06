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
};

function context(open: boolean) {
  const view = { open };
  const color = (base: string) => ({ base });
  return {
    client: {
      rpc: () => ({
        summary: async () => SUMMARY,
        events: { on: () => () => {} },
      }),
    },
    storage: { store: () => [view, async () => {}] },
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

async function render() {
  const t = await testRender(() => <CostSidebar context={context(true)} />, {
    width: 40,
    height: 8,
  });
  const frame = async (): Promise<string[]> => {
    await Bun.sleep(20);
    await t.renderOnce();
    return t.captureCharFrame().split("\n");
  };
  await frame();
  return { t, frame };
}

/** Column of the first character of `word` on the toggle row. */
const col = (rows: string[], word: string): number => rows[1]!.indexOf(word);

describe("sidebar tabs", () => {
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
    const { t, frame } = await render();
    const rows = await frame();
    await t.mockMouse.click(col(rows, "View"), 1);
    await t.mockMouse.click(col(rows, "[Agents]") + 3, 1);
    await t.mockMouse.click(38, 1);
    const after = await frame();
    expect(after[0]).toContain("▼");
    expect(after[1]!.trim()).toBe("View  [Agents]  Models  Providers");
    t.renderer.destroy();
  });
});
