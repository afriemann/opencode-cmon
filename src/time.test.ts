// spec: openspec/changes/add-monthly-cost-tracking/specs/cost-display/spec.md
import { describe, expect, test } from "bun:test";
import { localMonthRange, retentionCutoff } from "./time";

describe("time", () => {
  test("Month range across DST", () => {
    // Europe/Berlin (TZ pinned by the test script): DST starts 2026-03-29.
    const [from, to] = localMonthRange(new Date(2026, 2, 15, 12));
    expect(new Date(from)).toEqual(new Date(2026, 2, 1, 0, 0, 0, 0));
    expect(new Date(to)).toEqual(new Date(2026, 3, 1, 0, 0, 0, 0));
    expect(new Date(to).getHours()).toBe(0);
  });

  test("month range rolls over the year in December", () => {
    const [from, to] = localMonthRange(new Date(2026, 11, 31, 23, 59));
    expect(new Date(from)).toEqual(new Date(2026, 11, 1));
    expect(new Date(to)).toEqual(new Date(2027, 0, 1));
  });

  test("retention cutoff is six calendar months back in local time", () => {
    expect(retentionCutoff(new Date(2026, 9, 6, 10, 30))).toBe(
      new Date(2026, 3, 6, 10, 30).getTime(),
    );
  });
});
