// spec: openspec/changes/archive/2026-10-24-toggle-token-display/specs/cost-display/spec.md
// contract: openspec/changes/archive/2026-10-24-toggle-token-display/design.md#availability-and-aggregation-invariants
// RPC: openspec/changes/archive/2026-10-24-toggle-token-display/design.md#additive-summary--rpc-schema
import { describe, expect, test } from "bun:test";
import { CostRpc } from "./rpc";
import { server } from "./test-support/token-host";
import { buildSummary } from "./summary";
import { parseCatalog } from "./pricing";

describe("token summary public contract", () => {
  test("TOK-19 compact presentation never rounds RPC counts or ranks equal formatted values by name", async () => {
    const host = await server();
    try {
      const insert = host.db.query(`INSERT INTO cost_entry
        (id,session_id,agent,provider_id,model_id,kind,cost_micros,
        tokens_input,tokens_cache_read,tokens_cache_write,tokens_output,tokens_reasoning,created_at,source)
        VALUES (?,'s',?,'p','m','step',?, ?,0,0,0,0,100,'live')`);
      insert.run("high", "z-higher", 340_000, 1234);
      insert.run("low", "a-lower", 12_000_000, 1233);
      const before = host.db
        .query("SELECT * FROM cost_entry ORDER BY id")
        .all();
      const result = await host.summary(100, 101);
      expect(result.tokens?.totalTokens).toBe(2467);
      expect(result.tokens?.agents).toEqual([
        { agent: "z-higher", totalTokens: 1234, complete: true },
        { agent: "a-lower", totalTokens: 1233, complete: true },
      ]);
      expect(result.agents).toEqual([
        { agent: "a-lower", micros: 12_000_000 },
        { agent: "z-higher", micros: 340_000 },
      ]);
      expect(result.totalMicros).toBe(12_340_000);
      expect(
        host.db.query("SELECT * FROM cost_entry ORDER BY id").all(),
      ).toEqual(before);
    } finally {
      await host.close();
    }
  });
  test("TOK-13 missing prices never alter complete token projection", async () => {
    const host = await server();
    try {
      host.db
        .query(
          `INSERT INTO cost_entry
        (id,session_id,agent,provider_id,model_id,kind,cost_micros,
        tokens_input,tokens_cache_read,tokens_cache_write,tokens_output,tokens_reasoning,created_at,source)
        VALUES ('unpriced','s','build','github-copilot','claude-sonnet-4.6','step',0,
        100,200,300,40,60,100,'live')`,
        )
        .run();
      const result = await host.summary(100, 101);
      expect(result.totalMicros).toBe(0);
      expect(result.complete).toBe(false);
      expect(result.tokens?.totalTokens).toBe(700);
      expect(result.tokens?.complete).toBe(true);
    } finally {
      await host.close();
    }
  });
  test("TOK-12 pure dollar aggregation remains immutable and price-independent for ordinary rows", () => {
    const aggregate = Object.freeze({
      agents: Object.freeze([
        { agent: "a", micros: 123 },
        { agent: "B", micros: 123 },
      ]),
      models: Object.freeze([{ model: "m", micros: 246 }]),
      providers: Object.freeze([{ provider: "p", micros: 246 }]),
    });
    const before = JSON.stringify(aggregate);
    expect(buildSummary(aggregate, [], parseCatalog([]))).toMatchObject({
      totalMicros: 246,
      complete: true,
      unpriced: [],
      agents: [
        { agent: "B", micros: 123 },
        { agent: "a", micros: 123 },
      ],
      models: [{ model: "m", micros: 246 }],
      providers: [{ provider: "p", micros: 246 }],
    });
    expect(JSON.stringify(aggregate)).toBe(before);
  });
  test.each(Array.from({ length: 32 }, (_, i) => i))(
    "TOK-01 NULL mask %i preserves each known component",
    async (mask) => {
      const host = await server();
      try {
        const vector = [100, 200, 300, 40, 60].map((n, bit) =>
          mask & (1 << bit) ? n : null,
        );
        host.db
          .query(
            `INSERT INTO cost_entry
          (id,session_id,agent,provider_id,model_id,kind,failed,cost_micros,
          tokens_input,tokens_cache_read,tokens_cache_write,tokens_output,tokens_reasoning,created_at,source)
          VALUES (?,?,?,?,?,'step',0,123,?,?,?,?,?,?,'backfill')`,
          )
          .run(`r${mask}`, "s", "a", "p", "m", ...vector, mask + 100);
        const reply = await host.summary(mask + 100, mask + 101);
        const expected =
          mask === 0
            ? null
            : vector.reduce<number>((sum, n) => sum + (n ?? 0), 0);
        expect(reply.tokens).toEqual({
          totalTokens: expected,
          complete: mask === 31,
          agents: [
            { agent: "a", totalTokens: expected, complete: mask === 31 },
          ],
          models: [
            { model: "m", totalTokens: expected, complete: mask === 31 },
          ],
          providers: [
            { provider: "p", totalTokens: expected, complete: mask === 31 },
          ],
        });
        expect(reply.totalMicros).toBe(123);
      } finally {
        await host.close();
      }
    },
  );

  test("TOK-02 range, attribution, ranking, reconciliation and read-only projection", async () => {
    const host = await server();
    try {
      const insert = host.db.query(`INSERT INTO cost_entry
        (id,session_id,parent_session_id,agent,provider_id,model_id,kind,failed,cost_micros,
        tokens_input,tokens_cache_read,tokens_cache_write,tokens_output,tokens_reasoning,created_at,source)
        VALUES (?,'child','parent',?,?,?,?,?,?,?,?,?,?,?,?, 'live')`);
      // Same model across providers; binary tie order; zero before unavailable.
      insert.run(
        "a",
        "a",
        "p",
        "shared",
        "step",
        1,
        500,
        100,
        200,
        300,
        40,
        60,
        100,
      );
      insert.run(
        "b",
        "B",
        "q",
        "shared",
        "compaction",
        0,
        0,
        700,
        0,
        0,
        0,
        0,
        101,
      );
      insert.run(
        "z",
        "zero",
        "p",
        "zero",
        "step",
        0,
        10,
        0,
        null,
        null,
        null,
        null,
        102,
      );
      insert.run(
        "u",
        "unknown",
        "unknown",
        "unknown",
        "step",
        0,
        1,
        null,
        null,
        null,
        null,
        null,
        103,
      );
      insert.run(
        "edge",
        "excluded",
        "p",
        "edge",
        "step",
        0,
        999,
        999,
        0,
        0,
        0,
        0,
        104,
      );
      const before = host.db
        .query("SELECT * FROM cost_entry ORDER BY id")
        .all();
      const reply = await host.summary(100, 104);
      const again = await host.summary(100, 104);
      expect(again).toEqual(reply);
      expect(
        host.db.query("SELECT * FROM cost_entry ORDER BY id").all(),
      ).toEqual(before);
      expect(reply.totalMicros).toBe(511);
      expect(reply.agents.map((e) => e.agent)).toEqual([
        "a",
        "zero",
        "unknown",
        "B",
      ]);
      expect(reply.tokens).toEqual({
        totalTokens: 1400,
        complete: false,
        agents: [
          { agent: "B", totalTokens: 700, complete: true },
          { agent: "a", totalTokens: 700, complete: true },
          { agent: "zero", totalTokens: 0, complete: false },
          { agent: "unknown", totalTokens: null, complete: false },
        ],
        models: [
          { model: "shared", totalTokens: 1400, complete: true },
          { model: "zero", totalTokens: 0, complete: false },
          { model: "unknown", totalTokens: null, complete: false },
        ],
        providers: [
          { provider: "p", totalTokens: 700, complete: false },
          { provider: "q", totalTokens: 700, complete: true },
          { provider: "unknown", totalTokens: null, complete: false },
        ],
      });
      for (const list of [
        reply.tokens!.agents,
        reply.tokens!.models,
        reply.tokens!.providers,
      ])
        expect(list.reduce((sum, e) => sum + (e.totalTokens ?? 0), 0)).toBe(
          1400,
        );
      expect((await host.summary(104, 105)).tokens?.totalTokens).toBe(999);
      expect((await host.summary(105, 106)).tokens).toEqual({
        totalTokens: 0,
        complete: true,
        agents: [],
        models: [],
        providers: [],
      });
    } finally {
      await host.close();
    }
  });

  // Schema-shape assertions only: supported-host validation/transport is a candidate gate.
  // Accept equivalent JSON Schema union spellings rather than prescribe schema construction.
  function expectNullableCount(schema: {
    type?: string | string[];
    anyOf?: { type: string }[];
    oneOf?: { type: string }[];
  }) {
    expect(schema).toBeDefined();
    const types = schema.anyOf
      ? schema.anyOf.map((variant) => variant.type)
      : schema.oneOf
        ? schema.oneOf.map((variant) => variant.type)
        : [schema.type].flat();
    expect(types).toContain("null");
    expect(types.filter((type) => type !== "null")).toHaveLength(1);
    expect(["number", "integer"]).toContain(
      types.find((type) => type !== "null") ?? "",
    );
  }

  test("TOK-03 RPC schema shape retains old inputs and optional old reply fields", () => {
    const rpc = JSON.parse(JSON.stringify(CostRpc));
    expect(rpc.id).toBe("cmon");
    expect(Object.keys(rpc.methods)).toEqual(["summary"]);
    expect(rpc.methods.summary.input).toEqual({
      type: "object",
      properties: {
        from: { type: "number" },
        to: { type: "number" },
      },
      required: ["from", "to"],
    });
    expect(rpc.methods.summary.output.required).toEqual([
      "revision",
      "totalMicros",
      "agents",
      "complete",
    ]);
    const tokens = rpc.methods.summary.output.properties.tokens;
    expect(tokens).toBeDefined();
    expect(tokens.type).toBe("object");
    expect([...tokens.required].sort()).toEqual([
      "agents",
      "complete",
      "models",
      "providers",
      "totalTokens",
    ]);
    expect(Object.keys(tokens.properties).sort()).toEqual([
      "agents",
      "complete",
      "models",
      "providers",
      "totalTokens",
    ]);
    expectNullableCount(tokens.properties.totalTokens);
    expect(tokens.properties.complete.type).toBe("boolean");
    expect(Object.keys(rpc.events)).toEqual(["changed"]);
    expect(rpc.events.changed.schema.required).toEqual(["revision"]);
  });

  test.each([
    ["agents", "agent"],
    ["models", "model"],
    ["providers", "provider"],
  ])(
    "TOK-03 %s nested RPC schema shape uses exact %s entry fields",
    (list, name) => {
      const rpc = JSON.parse(JSON.stringify(CostRpc));
      const tokens = rpc.methods.summary.output.properties.tokens;
      expect(tokens).toBeDefined();
      const group = tokens.properties[list];
      expect(group.type).toBe("array");
      expect(group.items.type).toBe("object");
      expect([...group.items.required].sort()).toEqual(
        [name, "totalTokens", "complete"].sort(),
      );
      expect(Object.keys(group.items.properties).sort()).toEqual(
        [name, "totalTokens", "complete"].sort(),
      );
      expect(group.items.properties[name].type).toBe("string");
      expectNullableCount(group.items.properties.totalTokens);
      expect(group.items.properties.complete.type).toBe("boolean");
    },
  );
});
