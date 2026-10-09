// spec: openspec/changes/fix-cache-write-addon-per-row/specs/cost-display/spec.md
// spec: openspec/changes/account-for-cache-writes/specs/cost-recording/spec.md
// spec: openspec/changes/compute-cache-writes-at-read/specs/cost-display/spec.md
import { describe, expect, jest, test } from "bun:test";
import {
  cacheWriteExtraMicros,
  createPriceLookup,
  addOnApplies,
  parseCatalog,
  rowAddOn,
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

describe("addOnApplies", () => {
  test("uses the entry's family when priced, the claude- prefix otherwise", () => {
    expect(addOnApplies("github-copilot", "x", SONNET)).toBe(true);
    expect(addOnApplies("github-copilot", "claude-old", undefined)).toBe(true);
    expect(addOnApplies("github-copilot", "gpt-5", undefined)).toBe(false);
    expect(addOnApplies("openrouter", "claude-x", undefined)).toBe(false);
  });
});

describe("PriceLookup", () => {
  const entry = {
    id: "m",
    providerID: "p",
    cost: [{ input: 1, cache: { read: 0, write: 0 } }],
  };
  const log = () => {};
  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };

  test("table() is synchronous, empty before the first load and never loads", () => {
    let calls = 0;
    const lookup = createPriceLookup(
      async () => ((calls += 1), { data: [entry] }),
      log,
      () => {},
    );
    expect(lookup.table().size).toBe(0);
    expect(calls).toBe(0);
  });

  test("refresh loads once under concurrent calls and fires onChange when the catalog changes", async () => {
    let calls = 0;
    let changes = 0;
    const lookup = createPriceLookup(
      async () => ((calls += 1), { data: [entry] }),
      log,
      () => (changes += 1),
    );
    lookup.refresh("updated");
    lookup.refresh("updated");
    await flush();
    expect(calls).toBe(2);
    expect(lookup.table().size).toBe(1);
    expect(changes).toBe(1);
  });

  test("an identical catalog does not fire onChange", async () => {
    let changes = 0;
    const lookup = createPriceLookup(
      async () => ({ data: [entry] }),
      log,
      () => (changes += 1),
    );
    lookup.refresh("updated");
    await flush();
    lookup.refresh("updated");
    await flush();
    expect(changes).toBe(1);
  });

  test("Reloads are rate-limited", async () => {
    let calls = 0;
    let now = 1_000_000;
    const lookup = createPriceLookup(
      async () => ((calls += 1), { data: [] }),
      log,
      () => {},
      () => now,
    );
    lookup.refresh("miss");
    await flush();
    lookup.refresh("miss");
    await flush();
    expect(calls).toBe(1);
    now += 60_000;
    lookup.refresh("miss");
    await flush();
    expect(calls).toBe(2);
  });

  test("an updated refresh is not rate-limited by misses", async () => {
    let calls = 0;
    const lookup = createPriceLookup(
      async () => ((calls += 1), { data: [] }),
      log,
      () => {},
      () => 5,
    );
    lookup.refresh("miss");
    await flush();
    lookup.refresh("updated");
    await flush();
    expect(calls).toBe(2);
  });

  test("empty or failed loads keep the previous table", async () => {
    const responses: unknown[] = [
      { data: [entry] },
      { data: [] },
      new Error("down"),
    ];
    const lookup = createPriceLookup(
      async () => {
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
      },
      log,
      () => {},
    );
    for (let i = 0; i < 3; i += 1) {
      lookup.refresh("updated");
      await flush();
    }
    expect(lookup.table().size).toBe(1);
  });

  test("A hanging catalog never stalls the summary", async () => {
    jest.useFakeTimers();
    try {
      const lookup = createPriceLookup(
        () => new Promise(() => {}),
        log,
        () => {},
      );
      lookup.refresh("updated");
      expect(lookup.table().size).toBe(0);
      jest.advanceTimersByTime(5_000);
      await flush();
      expect(lookup.table().size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("rowAddOn per-row cache-write decision", () => {
  const priced = (write: number): ModelPrice => ({
    ...SONNET,
    cost: [{ input: 2, output: 10, cache: { read: 0.1, write } }],
  });
  const catalog = (write: number) =>
    new Map([["github-copilot/claude-sonnet-5.5", priced(write)]]);
  // 40,000 cache-write tokens -> add-on 100,000; 1,000 output tokens -> expected 10,000.
  const row = (over: Record<string, unknown> = {}) => ({
    providerId: "github-copilot",
    modelId: "claude-sonnet-5.5",
    tokens: counts(40_000),
    costMicros: 10_000,
    outputTokens: 1000,
    reasoningTokens: 0,
    ...over,
  });

  test("A non-zero catalog cache-write price does not drop the add-on", () => {
    expect(rowAddOn(row(), catalog(2.5))).toEqual({
      kind: "micros",
      micros: 100_000,
    });
  });

  test("A row that already includes cache writes gets no add-on", () => {
    expect(rowAddOn(row({ costMicros: 110_000 }), catalog(0))).toEqual({
      kind: "micros",
      micros: 0,
    });
  });

  test("applies below the midpoint and not at it", () => {
    expect(rowAddOn(row({ costMicros: 59_999 }), catalog(0))).toEqual({
      kind: "micros",
      micros: 100_000,
    });
    expect(rowAddOn(row({ costMicros: 60_000 }), catalog(0))).toEqual({
      kind: "micros",
      micros: 0,
    });
  });

  test("Unknown output tokens fall back to the catalog price", () => {
    const unknown = row({ outputTokens: null });
    expect(rowAddOn(unknown, catalog(0))).toEqual({
      kind: "micros",
      micros: 100_000,
    });
    expect(rowAddOn(unknown, catalog(2.5))).toEqual({
      kind: "micros",
      micros: 0,
    });
    expect(rowAddOn(row({ reasoningTokens: null }), catalog(2.5))).toEqual({
      kind: "micros",
      micros: 0,
    });
  });

  test("a tier without an output price falls back to the catalog price", () => {
    const noOutput = new Map([
      [
        "github-copilot/claude-sonnet-5.5",
        { ...SONNET, cost: [{ input: 2, cache: { read: 0.1, write: 2.5 } }] },
      ],
    ]);
    expect(rowAddOn(row(), noOutput)).toEqual({ kind: "micros", micros: 0 });
  });

  test("the tier output price is used in the per-row decision", () => {
    const tiered = new Map([
      [
        "github-copilot/claude-sonnet-5.5",
        {
          ...SONNET,
          cost: [
            { input: 2, output: 10, cache: { read: 0.1, write: 0 } },
            {
              tier: { type: "context" as const, size: 200_000 },
              input: 4,
              output: 20,
              cache: { read: 0.2, write: 0 },
            },
          ],
        },
      ],
    ]);
    // context 240,000 > 200,000: expected = 20,000 + 40,000*0 ; add-on = 40,000*1.25*4 = 200,000
    const big = row({ tokens: counts(40_000, 200_000), costMicros: 800_000 + 20_000 });
    expect(rowAddOn(big, tiered)).toEqual({ kind: "micros", micros: 200_000 });
  });
});
