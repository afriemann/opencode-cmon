// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-recording/spec.md
import { describe, expect, test } from "bun:test";
import { formatUsd, usdToMicros } from "./money";

describe("money", () => {
  test("Sums are exact", () => {
    const sum = [0.1, 0.1, 0.1].map(usdToMicros).reduce((a, b) => a + b, 0);
    expect(sum).toBe(300000);
  });

  test("converts a step cost to integer micro-USD", () => {
    expect(usdToMicros(0.0123)).toBe(12300);
  });

  test("formats micro-USD as dollars rounded to cents", () => {
    expect(formatUsd(12_340_000)).toBe("$12.34");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1_005_000)).toBe("$1.01");
  });
});
