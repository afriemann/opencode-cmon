// spec: openspec/changes/archive/2026-10-24-toggle-token-display/specs/cost-display/spec.md
// contract: design.md, Footer available-space invariant
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { CostFooter, CostSidebar } from "./tui";
import { storage, uiContext, type TokenReply } from "./test-support/token-host";

// Test-only host composition: the slot is a direct flex child, not a sized wrapper.
test.each([0, 1_580_000_000])(
  "TOK-22 host footer retains %i tokens through switching, allocation and remount",
  async (totalTokens) => {
    const summary: TokenReply = {
      revision: 1,
      totalMicros: 0,
      complete: true,
      agents: [],
      models: [],
      providers: [],
      tokens: {
        totalTokens,
        complete: true,
        agents: [],
        models: [],
        providers: [],
      },
    };
    let calls = 0;
    const context = uiContext(
      {
        summary: async () => {
          calls++;
          return summary;
        },
        events: { on: () => () => {} },
      },
      storage(),
    );
    const [rowWidth, resize] = createSignal(120);
    const [plugins, setPlugins] = createSignal("Plugins");
    const [mounted, mount] = createSignal(true);
    const t = await testRender(
      () => (
        <box>
          <box width={45} flexShrink={0}>
            <CostSidebar context={context} />
          </box>
          <box width={rowWidth()} flexShrink={0}>
            <box
              id="host-footer-row"
              width="100%"
              flexDirection="row"
              paddingLeft={2}
              paddingRight={2}
              gap={1}
            >
              <text flexShrink={0}>MCP</text>
              <text flexShrink={0}>{plugins()}</text>
              <Show when={mounted()}>
                <CostFooter context={context} />
              </Show>
              <box flexGrow={1} />
              <text flexShrink={0}>v2.0.24</text>
            </box>
          </box>
        </box>
      ),
      { width: 120, height: 24 },
    );
    const frame = async () => {
      await Bun.sleep(20);
      await t.renderOnce();
      return t.captureCharFrame().split("\n");
    };
    const click = async (label: string) => {
      const rows = await frame();
      const y = rows.findIndex((row) => row.includes(label));
      expect(y).toBeGreaterThanOrEqual(0);
      await t.mockMouse.click(rows[y]!.indexOf(label), y);
    };
    const amount = totalTokens === 0 ? "0 tokens" : "1.58B tokens";
    const check = async (expected?: string) => {
      // Multiple settled frames expose feedback that progressively clips its own input.
      let previous = "";
      for (let pass = 0; pass < 4; pass++) {
        const rows = await frame();
        const row = t.renderer.root.findDescendantById("host-footer-row")!;
        expect(t.renderer.width).toBe(120);
        expect(row.width).toBe(rowWidth());
        expect(row.height).toBe(1);
        const text = rows[row.y]!;
        expect(text).toContain("MCP");
        expect(text).toContain(plugins());
        expect(text).toContain("v2.0.24");
        expect(text.indexOf("v2.0.24") + 7).toBeLessThanOrEqual(rowWidth() - 2);
        expect(rows[row.y + 1]!.trim()).toBe("");
        const contribution = text
          .slice(
            text.indexOf(plugins()) + plugins().length,
            text.indexOf("v2.0.24"),
          )
          .trim();
        if (expected) expect(contribution).toBe(`▼ ${expected}`);
        else {
          expect(contribution).toStartWith("▼");
          expect(`▼ ${amount}`.startsWith(contribution)).toBe(true);
          expect(contribution.length).toBeLessThan(`▼ ${amount}`.length);
        }
        if (pass > 0) expect(text).toBe(previous);
        previous = text;
      }
    };
    try {
      await check("$0.00");
      await click("Tokens");
      await check(amount);
      const before = calls;
      for (const width of [48, 120, 32, 120]) {
        resize(width);
        await check(width === 32 ? undefined : amount);
      }
      // Sibling occupancy changes independently of terminal and row width.
      resize(48);
      setPlugins("Plugins extra status data");
      await check();
      setPlugins("Plugins");
      await check(amount);
      resize(120);
      await check(amount);
      await click("$");
      await check("$0.00");
      await click("Tokens");
      await check(amount);
      expect(calls).toBe(before);
      mount(false);
      await frame();
      mount(true);
      await check(amount);
    } finally {
      t.renderer.destroy();
    }
  },
);
