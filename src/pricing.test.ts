// spec: openspec/changes/account-for-cache-writes/specs/cost-recording/spec.md
import { describe, expect, jest, test } from "bun:test";
import {
  cacheWriteExtraMicros,
  createPriceLookup,
  hasCopilotPrices,
  parseCatalog,
  selectTier,
  tokenCounts,
  type ModelPrice,
} from "./pricing";

const SONNET: ModelPrice = {
  providerId: "github-copilot",
  modelId: "claude-sonnet-5.5",
  family: "claude-sonnet",
  cost: [{ input: 2, cache: { read: 0.2, write: 0 } }],
};

const counts = (cacheWrite: number, input = 0, cacheRead = 0) => ({
  input,
  cacheRead,
  cacheWrite,
});

describe("cacheWriteExtraMicros", () => {
  test("Sonnet cache writes are priced", () => {
    expect(cacheWriteExtraMicros(counts(1_725_111), SONNET)).toBe(4_312_778);
  });

  test("No add-on outside the rule", () => {
    const cases: Array<[string, ModelPrice | undefined, number]> = [
      ["unknown price", undefined, 1000],
      ["non-copilot provider", { ...SONNET, providerId: "openrouter" }, 1000],
      [
        "non-claude model",
        { ...SONNET, modelId: "gpt-5.3-codex", family: "gpt-codex" },
        1000,
      ],
      [
        "write already priced",
        { ...SONNET, cost: [{ input: 2, cache: { read: 0.2, write: 2.5 } }] },
        1000,
      ],
      ["no write tokens", SONNET, 0],
      ["no cost tiers", { ...SONNET, cost: [] }, 1000],
    ];
    for (const [label, price, tokens] of cases) {
      expect([label, cacheWriteExtraMicros(counts(tokens), price)]).toEqual([
        label,
        0,
      ]);
    }
  });

  test("falls back to the claude- id prefix when family is absent", () => {
    const noFamily: ModelPrice = {
      providerId: SONNET.providerId,
      modelId: SONNET.modelId,
      cost: SONNET.cost,
    };
    expect(cacheWriteExtraMicros(counts(1000), noFamily)).toBe(2500);
    expect(
      cacheWriteExtraMicros(counts(1000), {
        ...noFamily,
        modelId: "my-claude-ish",
      }),
    ).toBe(0);
  });

  test("rounds once per row", () => {
    const price = {
      ...SONNET,
      cost: [{ input: 0.333, cache: { read: 0, write: 0 } }],
    };
    expect(cacheWriteExtraMicros(counts(3), price)).toBe(
      Math.round(3 * 1.25 * 0.333),
    );
  });
});

describe("selectTier", () => {
  const tiered = [
    { input: 3, cache: { read: 0.3, write: 0 } },
    {
      tier: { type: "context" as const, size: 200_000 },
      input: 6,
      cache: { read: 0.6, write: 0 },
    },
  ];

  test("Tier selection matches opencode", () => {
    expect(selectTier(tiered, counts(100_000))?.input).toBe(3);
    expect(selectTier(tiered, counts(100_000, 100_000, 1))?.input).toBe(6);
    expect(selectTier(tiered, counts(0, 150_000, 60_000))?.input).toBe(6);
  });

  test("returns undefined without an untiered entry or matching tier", () => {
    expect(selectTier([tiered[1]!], counts(10))).toBeUndefined();
  });

  test("the zero-write check uses the selected tier", () => {
    const mixed = [
      { input: 3, cache: { read: 0, write: 0 } },
      {
        tier: { type: "context" as const, size: 10 },
        input: 6,
        cache: { read: 0, write: 7 },
      },
    ];
    const price = { ...SONNET, cost: mixed };
    expect(cacheWriteExtraMicros(counts(5), price)).toBe(
      Math.round(5 * 1.25 * 3),
    );
    expect(cacheWriteExtraMicros(counts(50), price)).toBe(0);
  });
});

describe("parseCatalog", () => {
  const entry = {
    id: "claude-sonnet-5.5",
    providerID: "github-copilot",
    family: "claude-sonnet",
    cost: [{ input: 2, output: 10, cache: { read: 0.2, write: 0 } }],
  };

  test("reads {data} and bare arrays and skips bad entries", () => {
    for (const response of [{ data: [entry, { id: 1 }, null] }, [entry]]) {
      const table = parseCatalog(response);
      expect(table.size).toBe(1);
      expect(
        table.get("github-copilot/claude-sonnet-5.5")?.cost[0]?.cache.write,
      ).toBe(0);
    }
  });

  test("garbage yields an empty table", () => {
    expect(parseCatalog("nope").size).toBe(0);
    expect(parseCatalog(undefined).size).toBe(0);
  });
});

describe("tokenCounts", () => {
  test("maps token JSON and treats missing, NaN and negative as 0", () => {
    expect(
      tokenCounts({
        input: 5,
        output: 1,
        reasoning: 0,
        cache: { read: 7, write: 9 },
      }),
    ).toEqual({ input: 5, cacheRead: 7, cacheWrite: 9 });
    expect(tokenCounts({ input: -1, cache: { write: Number.NaN } })).toEqual({
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(tokenCounts(undefined)).toEqual({
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });
});

describe("PriceLookup", () => {
  const entry = {
    id: "m",
    providerID: "p",
    cost: [{ input: 1, cache: { read: 0, write: 0 } }],
  };
  const log = () => {};

  test("loads once under concurrent calls", async () => {
    let calls = 0;
    const lookup = createPriceLookup(
      async () => ((calls += 1), { data: [entry] }),
      log,
    );
    const [a, b] = await Promise.all([lookup.current(), lookup.current()]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    await lookup.current();
    expect(calls).toBe(1);
  });

  test("empty or failed loads keep the previous table and retry", async () => {
    const responses: unknown[] = [
      { data: [entry] },
      { data: [] },
      new Error("down"),
      { data: [entry, { ...entry, id: "n" }] },
    ];
    const lookup = createPriceLookup(async () => {
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    }, log);
    expect((await lookup.current()).size).toBe(1);
    lookup.invalidate();
    expect((await lookup.current()).size).toBe(1);
    lookup.invalidate();
    expect((await lookup.current()).size).toBe(1);
    lookup.invalidate();
    expect((await lookup.current()).size).toBe(2);
  });

  test("an empty first load retries on the next call", async () => {
    const responses: unknown[] = [{ data: [] }, { data: [entry] }];
    const lookup = createPriceLookup(async () => responses.shift(), log);
    expect((await lookup.current()).size).toBe(0);
    expect((await lookup.current()).size).toBe(1);
  });

  test("a hanging catalog load times out and yields the empty table", async () => {
    jest.useFakeTimers();
    try {
      const lookup = createPriceLookup(() => new Promise(() => {}), log);
      const pending = lookup.current();
      jest.advanceTimersByTime(5_000);
      expect((await pending).size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("hasCopilotPrices", () => {
  test("requires a github-copilot model with a cost entry", () => {
    const other = parseCatalog([
      {
        id: "x",
        providerID: "openrouter",
        cost: [{ input: 1, cache: { read: 0, write: 0 } }],
      },
    ]);
    const noCost = parseCatalog([
      { id: "x", providerID: "github-copilot", cost: [] },
    ]);
    const ok = parseCatalog([
      {
        id: "x",
        providerID: "github-copilot",
        cost: [{ input: 1, cache: { read: 0, write: 0 } }],
      },
    ]);
    expect([
      hasCopilotPrices(other),
      hasCopilotPrices(noCost),
      hasCopilotPrices(ok),
    ]).toEqual([false, false, true]);
  });
});
