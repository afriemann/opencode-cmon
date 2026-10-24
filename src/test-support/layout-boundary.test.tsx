// Test-only locked-renderer probe, not a required production implementation strategy.
// Contract: openspec/changes/archive/2026-10-24-toggle-token-display/design.md#container-layout-contract
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { type BoxRenderable } from "@opentui/core";
import { createSignal } from "solid-js";

test("TOK-20 locked box ref/size callback observes parent resize without terminal resize", async () => {
  const [width, resize] = createSignal(45);
  let panel: BoxRenderable | undefined;
  const observed: number[] = [];
  const t = await testRender(
    () => (
      <box width={width()} flexShrink={0}>
        <box
          ref={(node) => {
            panel = node;
          }}
          onSizeChange={function () {
            observed.push(this.width);
          }}
        >
          <text>container probe</text>
        </box>
      </box>
    ),
    { width: 120, height: 10 },
  );
  try {
    for (const size of [45, 22, 40, 45]) {
      resize(size);
      await t.renderOnce();
      expect(t.renderer.width).toBe(120);
      expect(panel?.width).toBe(size);
      expect(observed.at(-1)).toBe(size);
      expect(t.captureCharFrame()).toContain("container probe");
    }
  } finally {
    t.renderer.destroy();
  }
});
