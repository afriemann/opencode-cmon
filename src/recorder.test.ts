// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-recording/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-recording/spec.md
// spec: openspec/changes/add-cost-analysis-tools/specs/cost-recording/spec.md
import { describe, expect, test } from "bun:test";
import { createRecorder, type CostEvent } from "./recorder";

const TOKENS = {
  input: 1,
  output: 1,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};
const MODEL = { providerID: "github-copilot", id: "claude-sonnet-4.6" };

const WRITE_TOKENS = {
  input: 4,
  output: 1,
  reasoning: 0,
  cache: { read: 5, write: 1_000_000 },
};

function recorder(
  parents: Record<string, string | null> = {},
  directories: Record<string, string> = {},
) {
  return createRecorder({
    resolveSession: async (sessionID) => ({
      parentId: parents[sessionID] ?? null,
      directory: directories[sessionID] ?? null,
    }),
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
  data: { sessionID, assistantMessageID, cost, tokens: TOKENS, finish: "stop" },
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
      tokens: { input: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: 1,
      reasoningTokens: 0,
      finish: "stop",
      directory: null,
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
      resolveSession: async () => {
        throw new Error("boom");
      },
      now: () => 1,
    });
    expect(await r.handle(ended("ses_1", "m", 0.01))).toMatchObject({
      parentSessionId: null,
      directory: null,
    });
  });

  describe("details", () => {
    test("Step output and reasoning tokens are stored", async () => {
      const r = recorder();
      const result = await r.handle({
        id: "evt_e",
        type: "session.step.ended",
        data: {
          sessionID: "ses_1",
          assistantMessageID: "m1",
          cost: 0.01,
          tokens: { ...TOKENS, output: 225, reasoning: 25 },
          finish: "length",
        },
      });
      expect(result).toMatchObject({
        outputTokens: 225,
        reasoningTokens: 25,
        finish: "length",
      });
    });

    test("Ended step stores its finish reason", async () => {
      const r = recorder();
      expect(await r.handle(ended("ses_1", "m1", 0.01))).toMatchObject({
        finish: "stop",
      });
    });

    test("Missing token data stores NULL", async () => {
      const r = recorder();
      const result = await r.handle({
        id: "evt_c",
        type: "session.compaction.ended",
        data: { sessionID: "ses_1", model: MODEL, cost: 0.1 },
      });
      expect(result).toMatchObject({
        outputTokens: null,
        reasoningTokens: null,
      });
    });

    test("Failed step and compaction have no finish reason", async () => {
      const r = recorder();
      const failed = await r.handle({
        id: "evt_f",
        type: "session.step.failed",
        data: {
          sessionID: "ses_1",
          assistantMessageID: "m1",
          cost: 0.01,
          tokens: TOKENS,
          finish: "content-filter",
        },
      });
      const compaction = await r.handle({
        id: "evt_c",
        type: "session.compaction.ended",
        data: { sessionID: "ses_1", cost: 0.1, tokens: TOKENS, finish: "stop" },
      });
      expect([failed?.finish, compaction?.finish]).toEqual([null, null]);
    });

    test("Event location wins", async () => {
      const r = recorder({}, { ses_1: "/work/b" });
      const result = await r.handle({
        ...ended("ses_1", "m1", 0.01),
        location: { directory: "/work/a" },
      });
      expect(result).toMatchObject({ directory: "/work/a" });
    });

    test("Session location is the fallback", async () => {
      const r = recorder({}, { ses_1: "/work/b" });
      expect(await r.handle(ended("ses_1", "m1", 0.01))).toMatchObject({
        directory: "/work/b",
      });
    });

    test("Unknown directory stays NULL", async () => {
      const r = recorder();
      expect(await r.handle(ended("ses_1", "m1", 0.01))).toMatchObject({
        directory: null,
      });
    });
  });

  describe("token storage", () => {
    const endedWith = (
      id: string,
      type: string,
      tokens: unknown,
    ): CostEvent => ({
      id: `evt_${id}`,
      type,
      data: { sessionID: "ses_1", assistantMessageID: id, cost: 0.01, tokens },
    });

    test("Step tokens are stored", async () => {
      const r = recorder();
      await r.handle(started("ses_1", "m1", "build"));
      expect(
        await r.handle(endedWith("m1", "session.step.ended", WRITE_TOKENS)),
      ).toMatchObject({
        costMicros: 10_000,
        tokens: { input: 4, cacheRead: 5, cacheWrite: 1_000_000 },
      });
    });

    test("failed steps store tokens too", async () => {
      const r = recorder();
      expect(
        await r.handle(endedWith("m1", "session.step.failed", WRITE_TOKENS)),
      ).toMatchObject({
        failed: true,
        tokens: { cacheWrite: 1_000_000 },
      });
    });

    test("Compaction without tokens stores NULL", async () => {
      const r = recorder();
      const result = await r.handle({
        id: "evt_c",
        type: "session.compaction.ended",
        data: { sessionID: "ses_1", model: MODEL, cost: 0.1 },
      });
      expect(result).toMatchObject({ kind: "compaction", tokens: null });
    });

    test("A malformed token object stores zeros", async () => {
      const r = recorder();
      expect(
        await r.handle(endedWith("m1", "session.step.ended", { input: 3 })),
      ).toMatchObject({
        tokens: { input: 3, cacheRead: 0, cacheWrite: 0 },
      });
    });
  });
});
