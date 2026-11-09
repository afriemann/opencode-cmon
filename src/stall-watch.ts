import { findStalls } from "./analysis";
import type { PriceTable } from "./pricing";
import type { CostRow, StallSummary } from "./types";

/** Only this much history is read per evaluation; a stall that began earlier is seen from its in-window tail. */
export const STALL_WINDOW_MS = 24 * 60 * 60 * 1000;

export const SUMMARY_MAX_STALLS = 3;
/** An ongoing stall whose last step is older than this is treated as idle and not listed. */
export const STALL_IDLE_MS = 30 * 60 * 1000;

/** Ongoing stalls in `rows` for the summary, highest wasted cost first. */
export function ongoingStalls(
  rows: readonly CostRow[],
  catalog: PriceTable,
  now: number,
): StallSummary[] {
  return findStalls(rows, catalog)
    .filter((s) => s.ongoing && now - s.endedAt <= STALL_IDLE_MS)
    .sort((a, b) => b.stalledCostMicros - a.stalledCostMicros)
    .slice(0, SUMMARY_MAX_STALLS)
    .map((s) => ({
      sessionId: s.sessionId,
      steps: s.steps,
      wastedMicros: s.stalledCostMicros,
      startedAt: s.startedAt,
    }));
}

export interface StallAlert {
  readonly sessionId: string;
  readonly modelId: string;
  readonly steps: number;
  readonly wastedMicros: number;
  readonly startedAt: number;
}

export interface StallWatchDeps {
  readonly sessionSteps: (sessionId: string, since: number) => CostRow[];
  readonly catalog: () => PriceTable;
  readonly now: () => number;
  readonly announce: (alert: StallAlert) => void;
}

/** Announces each ongoing cache stall once per session; recovery re-arms the session. */
export function createStallWatch(deps: StallWatchDeps) {
  const announced = new Set<string>();
  return {
    observe(row: CostRow): void {
      if (row.kind !== "step") return;
      const rows = deps.sessionSteps(
        row.sessionId,
        deps.now() - STALL_WINDOW_MS,
      );
      const ongoing = findStalls(rows, deps.catalog()).find((s) => s.ongoing);
      if (!ongoing) {
        announced.delete(row.sessionId);
        return;
      }
      if (announced.has(row.sessionId)) return;
      announced.add(row.sessionId);
      deps.announce({
        sessionId: row.sessionId,
        modelId: ongoing.modelId,
        steps: ongoing.steps,
        wastedMicros: ongoing.stalledCostMicros,
        startedAt: ongoing.startedAt,
      });
    },
  };
}
