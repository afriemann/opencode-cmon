// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-recording/spec.md
// spec: openspec/changes/account-for-cache-writes/specs/cost-recording/spec.md
import { describe, expect, test } from "bun:test";
import { createRecorder, type CostEvent } from "./recorder";
import { parseCatalog, type PriceTable } from "./pricing";

const TOKENS = {
  input: 1,
  output: 1,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};
const MODEL = { providerID: "github-copilot", id: "claude-sonnet-4.6" };

const CATALOG = parseCatalog([
  {
    id: "claude-sonnet-4.6",
    providerID: "github-copilot",
    family: "claude-sonnet",
    cost: [{ input: 2, output: 10, cache: { read: 0.2, write: 0 } }],
  },
]);
const WRITE_TOKENS = {
  input: 1,
  output: 1,
  reasoning: 0,
  cache: { read: 0, write: 1_000_000 },
};

function recorder(
  parents: Record<string, string | null> = {},
  table: PriceTable = CATALOG,
) {
  return createRecorder({
    resolveParent: async (sessionID) => parents[sessionID] ?? null,
    prices: async () => table,
    now: () => 9_999,
  });
}

const started = (
  sessionID: string,
  assistantMessageID: string,
  agent: string,
): CostEvent => ({
  id: `evt_s_${assistantMessageID}`,
  type: "session.step.started",
  data: { sessionID, assistantMessageID, agent, model: MODEL, started: 5_000 },
});

const ended = (
  sessionID: string,
  assistantMessageID: string,
  cost: number,
): CostEvent => ({
  id: `evt_e_${assistantMessageID}`,
  type: "session.step.ended",
  data: { sessionID, assistantMessageID, cost, tokens: TOKENS },
});

describe("recorder", () => {
  test("Records a completed step", async () => {
    const r = recorder();
    expect(await r.handle(started("ses_1", "msg_1", "build"))).toBeNull();
    expect(await r.handle(ended("ses_1", "msg_1", 0.0123))).toEqual({
      id: "msg_1",
      sessionId: "ses_1",
      parentSessionId: null,
      agent: "build",
      providerId: "github-copilot",
      modelId: "claude-sonnet-4.6",
      kind: "step",
      failed: false,
      costMicros: 12_300,
      cacheWriteExtraMicros: 0,
      createdAt: 5_000,
    });
  });

  test("Sub-agent cost is attributed to the sub-agent", async () => {
    const r = recorder({ ses_child: "ses_parent" });
    await r.handle(started("ses_child", "msg_c", "explore"));
    expect(await r.handle(ended("ses_child", "msg_c", 0.01))).toMatchObject({
      agent: "explore",
      parentSessionId: "ses_parent",
    });
  });

  test("Missing step start falls back to the last known agent, then unknown", async () => {
    const r = recorder();
    expect(await r.handle(ended("ses_1", "msg_x", 0.01))).toMatchObject({
      agent: "unknown",
      createdAt: 9_999,
    });
    await r.handle(started("ses_1", "msg_a", "build"));
    await r.handle(ended("ses_1", "msg_a", 0.01));
    expect(await r.handle(ended("ses_1", "msg_y", 0.01))).toMatchObject({
      agent: "build",
    });
  });

  test("Failed step with cost and tokens is recorded", async () => {
    const r = recorder();
    await r.handle(started("ses_1", "msg_1", "build"));
    const result = await r.handle({
      id: "evt_f",
      type: "session.step.failed",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_1",
        cost: 0.5,
        tokens: TOKENS,
      },
    });
    expect(result).toMatchObject({ failed: true, costMicros: 500_000 });
  });

  test("Failed step without cost is ignored", async () => {
    const r = recorder();
    const noCost = await r.handle({
      id: "evt_f1",
      type: "session.step.failed",
      data: { sessionID: "ses_1", assistantMessageID: "m1", tokens: TOKENS },
    });
    const noTokens = await r.handle({
      id: "evt_f2",
      type: "session.step.failed",
      data: { sessionID: "ses_1", assistantMessageID: "m2", cost: 1 },
    });
    expect([noCost, noTokens]).toEqual([null, null]);
  });

  test("Records a completed compaction", async () => {
    const r = recorder();
    await r.handle(started("ses_1", "msg_1", "build"));
    await r.handle({
      id: "evt_cs",
      type: "session.compaction.started",
      data: {
        sessionID: "ses_1",
        reason: "auto",
        recent: "",
        inputID: "msg_c1",
      },
    });
    const result = await r.handle({
      id: "evt_ce",
      type: "session.compaction.ended",
      data: { sessionID: "ses_1", model: MODEL, cost: 0.2, tokens: TOKENS },
    });
    expect(result).toMatchObject({
      id: "msg_c1",
      kind: "compaction",
      agent: "build",
      costMicros: 200_000,
    });
  });

  test("compaction without inputID derives its id from the started event id", async () => {
    const r = recorder();
    await r.handle({
      id: "evt_abc",
      type: "session.compaction.started",
      data: { sessionID: "ses_1", reason: "manual", recent: "" },
    });
    const result = await r.handle({
      id: "evt_def",
      type: "session.compaction.ended",
      data: { sessionID: "ses_1", cost: 0.1, tokens: TOKENS },
    });
    expect(result).toMatchObject({ id: "msg_abc", agent: "compaction" });
  });

  test("ignores unrelated and malformed events", async () => {
    const r = recorder();
    expect(
      await r.handle({
        id: "evt_1",
        type: "session.idle",
        data: { sessionID: "ses_1" },
      }),
    ).toBeNull();
    expect(
      await r.handle({ id: "evt_2", type: "session.step.ended", data: {} }),
    ).toBeNull();
  });

  test("a failed parent lookup still records the row", async () => {
    const r = createRecorder({
      resolveParent: async () => {
        throw new Error("boom");
      },
      prices: async () => CATALOG,
      now: () => 1,
    });
    expect(await r.handle(ended("ses_1", "m", 0.01))).toMatchObject({
      parentSessionId: null,
    });
  });

  describe("cache-write add-on", () => {
    const endedWithWrites = (
      id: string,
      type = "session.step.ended",
    ): CostEvent => ({
      id: `evt_${id}`,
      type,
      data: {
        sessionID: "ses_1",
        assistantMessageID: id,
        cost: 0.01,
        tokens: WRITE_TOKENS,
      },
    });

    test("Sonnet cache writes are priced", async () => {
      const r = recorder();
      await r.handle(started("ses_1", "m1", "build"));
      expect(await r.handle(endedWithWrites("m1"))).toMatchObject({
        costMicros: 10_000,
        cacheWriteExtraMicros: 2_500_000,
      });
    });

    test("Failed steps get the add-on", async () => {
      const r = recorder();
      await r.handle(started("ses_1", "m1", "build"));
      expect(
        await r.handle(endedWithWrites("m1", "session.step.failed")),
      ).toMatchObject({
        failed: true,
        cacheWriteExtraMicros: 2_500_000,
      });
    });

    test("a compaction gets the add-on from the event model", async () => {
      const r = recorder();
      await r.handle(started("ses_1", "m0", "build"));
      const result = await r.handle({
        id: "evt_c",
        type: "session.compaction.ended",
        data: {
          sessionID: "ses_1",
          model: MODEL,
          cost: 0.1,
          tokens: WRITE_TOKENS,
        },
      });
      expect(result).toMatchObject({
        kind: "compaction",
        cacheWriteExtraMicros: 2_500_000,
      });
    });

    test("No add-on outside the rule", async () => {
      const unknownAttribution = recorder();
      expect(
        await unknownAttribution.handle(endedWithWrites("m1")),
      ).toMatchObject({
        agent: "unknown",
        cacheWriteExtraMicros: 0,
      });
      const noCatalog = recorder({}, new Map());
      await noCatalog.handle(started("ses_1", "m2", "build"));
      expect(await noCatalog.handle(endedWithWrites("m2"))).toMatchObject({
        cacheWriteExtraMicros: 0,
      });
    });

    test("a failing price lookup still records the row", async () => {
      const r = createRecorder({
        resolveParent: async () => null,
        prices: async () => {
          throw new Error("down");
        },
        now: () => 1,
      });
      await r.handle(started("ses_1", "m1", "build"));
      expect(await r.handle(endedWithWrites("m1"))).toMatchObject({
        costMicros: 10_000,
        cacheWriteExtraMicros: 0,
      });
    });
  });
});
