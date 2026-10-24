// TEST ONLY: adapter sanity, not live OpenCode host verification.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { server } from "./token-host";

test("TOK-00 adapter drives existing recording and disposes its isolated ledger", async () => {
  const host = await server();
  try {
    expect(host.subscribed()).toBe(true);
    expect((await host.summary()).totalMicros).toBe(0);
    host.push(
      {
        id: "s",
        type: "session.step.started",
        data: {
          sessionID: "child",
          assistantMessageID: "m",
          agent: "build",
          model: { providerID: "test", id: "model" },
          started: Date.now(),
        },
      },
      {
        id: "e",
        type: "session.step.ended",
        data: {
          sessionID: "child",
          assistantMessageID: "m",
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
    let total = 0;
    for (let i = 0; i < 50; i++) {
      total = (await host.summary()).totalMicros;
      if (total !== 0) break;
      await Bun.sleep(10);
    }
    expect(total).toBe(250_000);
    expect(
      host.db
        .query("SELECT tokens_output, tokens_reasoning FROM cost_entry")
        .all(),
    ).toEqual([{ tokens_output: 40, tokens_reasoning: 60 }]);
  } finally {
    await host.close();
  }
  expect(existsSync(host.dir)).toBe(false);
}, 5_000);
