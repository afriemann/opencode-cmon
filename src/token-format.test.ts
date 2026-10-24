// spec: openspec/changes/archive/2026-10-24-toggle-token-display/specs/cost-display/spec.md
// Presentation only: exact summary/RPC values are covered by token-summary.test.ts.
import { expect, test } from "bun:test";
import {
  amount,
  breakdownLines,
  footerLine,
  formatTokens,
  tokenAmount,
} from "./tui";
import type { SummaryReply } from "./types";

test.each([
  [0, "0"],
  [1, "1"],
  [12, "12"],
  [999, "999"],
  [1000, "1k"],
  [1001, "1k"],
  [1200, "1.2k"],
  [1234, "1.23k"],
  [1235, "1.24k"],
  [999_994, "999.99k"],
  [999_995, "1M"],
  [1_000_000, "1M"],
  [1_200_000, "1.2M"],
  [1_234_999, "1.23M"],
  [1_235_000, "1.24M"],
  [999_994_999, "999.99M"],
  [999_995_000, "1B"],
  [590_977_798, "590.98M"],
  [1_000_000_000, "1B"],
  [1_578_717_226, "1.58B"],
  [1_235_000_000, "1.24B"],
  [999_995_000_000, "1000B"],
  [1_234_567_890_123, "1234.57B"],
] as const)(
  "TOK-14 compact boundary %i => %s, complete and partial",
  (count, text) => {
    const label = count === 1 ? "token" : "tokens";
    expect(formatTokens(count)).toBe(text);
    expect(tokenAmount(count, true)).toBe(`${text} ${label}`);
    expect(tokenAmount(count, false)).toBe(`~${text} ${label}`);
  },
);

test("TOK-14 every whole count below 1000 remains exact; NULL/absent are not zero", () => {
  for (let count = 0; count < 1000; count++)
    expect(formatTokens(count)).toBe(String(count));
  for (const missing of [null, undefined]) {
    expect(tokenAmount(missing, false)).toBe("Tokens unavailable");
    expect(tokenAmount(missing, true)).toBe("Tokens unavailable");
  }
});

test("TOK-15 equal display strings preserve exact ranking, values and dollar projection", () => {
  const summary: SummaryReply = {
    revision: 7,
    totalMicros: 12_340_000,
    complete: false,
    agents: [
      { agent: "a-lower", micros: 12_000_000 },
      { agent: "z-higher", micros: 340_000 },
    ],
    models: [],
    providers: [],
    tokens: {
      totalTokens: 2467,
      complete: true,
      agents: [
        { agent: "z-higher", totalTokens: 1234, complete: true },
        { agent: "a-lower", totalTokens: 1233, complete: true },
      ],
      models: [],
      providers: [],
    },
  };
  const state = { kind: "ready", summary } as const;
  const before = JSON.stringify(summary);
  expect(amount(state, "tokens")).toBe("2.47k tokens");
  expect(breakdownLines(state, "agent", "tokens")).toEqual([
    { label: "z-higher", amount: "1.23k tokens" },
    { label: "a-lower", amount: "1.23k tokens" },
  ]);
  expect(footerLine(state, true, "tokens")).toBe(
    "▼ 2.47k tokens · z-higher 1.23k tokens · a-lower 1.23k tokens",
  );
  expect(footerLine(state, false, "tokens")).toBe("▶ 2.47k tokens this month");
  expect(footerLine(state, true, "dollars")).toBe(
    "▼ ~$12.34 · a-lower $12.00 · z-higher $0.34",
  );
  expect(JSON.stringify(summary)).toBe(before);
});
