import {
  capText,
  clock,
  excludedOf,
  header,
  money,
  notesFor,
  price,
  type AnalysisInput,
  type PricedRow,
  type Range,
} from "./analysis";
import { priceKey, selectTier } from "./pricing";

export const CACHE_BREAKS_MAX_LIMIT = 30;
/** Steps with known tokens a session needs before it is examined. */
export const CACHE_BREAKS_MIN_STEPS = 20;
/** Consecutive steps with an identical cache read that make a frozen cache. */
export const FROZEN_MIN_STEPS = 15;
/** Steps in the rolling cache-ratio window. */
export const RATIO_WINDOW_STEPS = 10;
/** A rolling ratio below this is a degraded cache. */
export const RATIO_THRESHOLD = 0.5;
/** Most full misses and change-points listed per session. */
export const MAX_LISTED_ENTRIES = 10;

export interface FrozenRun {
  readonly steps: number;
  readonly cacheRead: number;
  /** 1-based position among the session's examined steps. */
  readonly startStep: number;
  readonly startAt: number;
  readonly inputAtStart: number;
  readonly inputAtEnd: number;
}

export interface FullMiss {
  readonly step: number;
  readonly at: number;
  readonly input: number;
}

export interface ChangePoint {
  readonly step: number;
  readonly at: number;
  readonly direction: "down" | "up";
  readonly ratio: number;
}

export interface FlaggedSession {
  readonly sessionId: string;
  readonly agent: string;
  readonly provider: string;
  readonly model: string;
  readonly steps: number;
  /** Cache read / (cache read + uncached input) over the examined steps. */
  readonly cacheRatio: number | null;
  readonly totalMicros: number;
  readonly frozen?: FrozenRun;
  readonly fullMisses: { readonly count: number; readonly entries: FullMiss[] };
  readonly changePoints: {
    readonly count: number;
    readonly entries: ChangePoint[];
  };
  readonly estimatedWasteMicros?: number;
  /** Why the waste estimate is absent. */
  readonly wasteOmitted?: string;
}

export interface ModelSummary {
  readonly provider: string;
  readonly model: string;
  readonly examined: number;
  readonly flagged: number;
}

export interface CacheBreaks {
  readonly range: Range;
  readonly totalMicros: number;
  readonly complete: boolean;
  readonly sessionsExamined: number;
  readonly sessionsFlagged: number;
  /** At most `limit` sessions, most expensive first. */
  readonly flagged: FlaggedSession[];
  readonly models: ModelSummary[];
  readonly notes: string[];
}

interface Step {
  readonly entry: PricedRow;
  readonly cacheRead: number;
  readonly input: number;
  readonly afterCompaction: boolean;
}

const ratioOf = (read: number, input: number): number | null =>
  read + input === 0 ? null : read / (read + input);

function byTime(a: PricedRow, b: PricedRow): number {
  return a.row.createdAt - b.row.createdAt || (a.row.id < b.row.id ? -1 : 1);
}

function mostFrequent(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  )[0]![0];
}

/** The examined steps of a session; a compaction row only marks the step after it. */
function stepsOf(timeline: readonly PricedRow[]): Step[] {
  const steps: Step[] = [];
  let afterCompaction = false;
  for (const entry of timeline) {
    if (entry.row.kind === "compaction") {
      afterCompaction = true;
      continue;
    }
    const tokens = entry.row.tokens;
    if (tokens !== null)
      steps.push({
        entry,
        cacheRead: tokens.cacheRead,
        input: tokens.input,
        afterCompaction,
      });
    afterCompaction = false;
  }
  return steps;
}

function longestFrozenRun(steps: readonly Step[]): FrozenRun | undefined {
  let best: { start: number; end: number } | undefined;
  let start = 0;
  const frozen = (s: Step) => s.cacheRead > 0 && s.input > 0;
  for (let i = 1; i <= steps.length; i += 1) {
    const continues =
      i < steps.length &&
      frozen(steps[i]!) &&
      frozen(steps[start]!) &&
      steps[i]!.cacheRead === steps[start]!.cacheRead;
    if (continues) continue;
    if (frozen(steps[start]!) && (!best || i - start > best.end - best.start))
      best = { start, end: i };
    start = i;
  }
  if (!best || best.end - best.start < FROZEN_MIN_STEPS) return undefined;
  const first = steps[best.start]!;
  return {
    steps: best.end - best.start,
    cacheRead: first.cacheRead,
    startStep: best.start + 1,
    startAt: first.entry.row.createdAt,
    inputAtStart: first.input,
    inputAtEnd: steps[best.end - 1]!.input,
  };
}

function fullMissesOf(steps: readonly Step[]): number[] {
  const found: number[] = [];
  for (let i = 1; i < steps.length; i += 1)
    if (
      steps[i]!.cacheRead === 0 &&
      steps[i - 1]!.cacheRead > 0 &&
      !steps[i]!.afterCompaction
    )
      found.push(i);
  return found;
}

function changePointsOf(steps: readonly Step[]): ChangePoint[] {
  const found: ChangePoint[] = [];
  let low: boolean | undefined;
  let read = 0;
  let input = 0;
  steps.forEach((step, i) => {
    read += step.cacheRead;
    input += step.input;
    if (i >= RATIO_WINDOW_STEPS) {
      read -= steps[i - RATIO_WINDOW_STEPS]!.cacheRead;
      input -= steps[i - RATIO_WINDOW_STEPS]!.input;
    }
    if (i < RATIO_WINDOW_STEPS - 1) return;
    const ratio = ratioOf(read, input);
    if (ratio === null) return;
    const below = ratio < RATIO_THRESHOLD;
    if (low !== undefined && below !== low)
      found.push({
        step: i + 1,
        at: step.entry.row.createdAt,
        direction: below ? "down" : "up",
        ratio,
      });
    low = below;
  });
  return found;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Flagged uncached input billed at the input price instead of the session's median cache-read price. */
function wasteOf(
  steps: readonly Step[],
  flaggedIndexes: ReadonlySet<number>,
  catalog: AnalysisInput["catalog"],
): { micros: number } | { omitted: string } {
  if (flaggedIndexes.size === 0)
    return { omitted: "no frozen or full-miss steps to price" };
  const tierOf = (step: Step) => {
    const { row } = step.entry;
    const model = catalog.get(priceKey(row.providerId, row.modelId));
    return model && row.tokens ? selectTier(model.cost, row.tokens) : undefined;
  };
  const reads = steps.flatMap((s) => tierOf(s)?.cache.read ?? []);
  let micros = 0;
  for (const i of flaggedIndexes) {
    const tier = tierOf(steps[i]!);
    if (!tier || reads.length === 0)
      return { omitted: "a flagged step has no catalog price" };
    // USD per million tokens equals micro-USD per token.
    micros += steps[i]!.input * (tier.input - median(reads));
  }
  return { micros: Math.round(micros) };
}

function examine(
  sessionId: string,
  timeline: readonly PricedRow[],
  steps: readonly Step[],
  catalog: AnalysisInput["catalog"],
): FlaggedSession | undefined {
  const frozen = longestFrozenRun(steps);
  const misses = fullMissesOf(steps);
  const changes = changePointsOf(steps);
  if (!frozen && misses.length === 0 && changes.length === 0) return undefined;
  const flaggedIndexes = new Set(misses);
  if (frozen)
    for (let i = 0; i < frozen.steps; i += 1)
      flaggedIndexes.add(frozen.startStep - 1 + i);
  const waste = wasteOf(steps, flaggedIndexes, catalog);
  const rows = steps.map((s) => s.entry.row);
  return {
    sessionId,
    agent: mostFrequent(rows.map((r) => r.agent)),
    provider: mostFrequent(rows.map((r) => r.providerId)),
    model: mostFrequent(rows.map((r) => r.modelId)),
    steps: steps.length,
    cacheRatio: ratioOf(
      steps.reduce((n, s) => n + s.cacheRead, 0),
      steps.reduce((n, s) => n + s.input, 0),
    ),
    totalMicros: timeline.reduce((n, e) => n + e.micros, 0),
    ...(frozen ? { frozen } : {}),
    fullMisses: {
      count: misses.length,
      entries: misses.slice(0, MAX_LISTED_ENTRIES).map((i) => ({
        step: i + 1,
        at: steps[i]!.entry.row.createdAt,
        input: steps[i]!.input,
      })),
    },
    changePoints: {
      count: changes.length,
      entries: changes.slice(0, MAX_LISTED_ENTRIES),
    },
    ...("micros" in waste
      ? { estimatedWasteMicros: waste.micros }
      : { wasteOmitted: waste.omitted }),
  };
}

export function buildCacheBreaks(
  input: AnalysisInput,
  limit: number,
): CacheBreaks {
  const priced = price(input.rows, input.catalog);
  const sessions = new Map<string, PricedRow[]>();
  for (const entry of priced.rows) {
    const list = sessions.get(entry.row.sessionId);
    if (list) list.push(entry);
    else sessions.set(entry.row.sessionId, [entry]);
  }
  const flagged: FlaggedSession[] = [];
  const models = new Map<string, ModelSummary>();
  let examined = 0;
  let sessionsFlagged = 0;
  let skipped = 0;
  for (const [sessionId, rows] of sessions) {
    const timeline = [...rows].sort(byTime);
    const steps = stepsOf(timeline);
    skipped += timeline.filter(
      (e) => e.row.kind === "step" && e.row.tokens === null,
    ).length;
    if (steps.length < CACHE_BREAKS_MIN_STEPS) continue;
    examined += 1;
    const found = examine(sessionId, timeline, steps, input.catalog);
    const provider = mostFrequent(steps.map((s) => s.entry.row.providerId));
    const model = mostFrequent(steps.map((s) => s.entry.row.modelId));
    const key = priceKey(provider, model);
    const summary = models.get(key) ?? {
      provider,
      model,
      examined: 0,
      flagged: 0,
    };
    models.set(key, {
      ...summary,
      examined: summary.examined + 1,
      flagged: summary.flagged + (found ? 1 : 0),
    });
    if (found) {
      sessionsFlagged += 1;
      flagged.push(found);
    }
  }
  flagged.sort(
    (a, b) =>
      b.totalMicros - a.totalMicros || (a.sessionId < b.sessionId ? -1 : 1),
  );
  const notes = [
    ...notesFor(input, priced.unpricedRows, excludedOf(input)),
    `Only steps with known token counts and sessions with at least ${CACHE_BREAKS_MIN_STEPS} such steps are examined; the cache ratio is cache read / (cache read + uncached input), so it ignores cache writes.`,
    "Estimated waste bills the flagged steps' uncached input at the catalog input price instead of the session's median catalog cache-read price; it is omitted when a price is unknown.",
  ];
  if (skipped > 0)
    notes.push(`${skipped} step(s) without token counts were skipped.`);
  return {
    range: input.range,
    totalMicros: priced.rows.reduce((n, e) => n + e.micros, 0),
    complete: priced.unpricedRows === 0,
    sessionsExamined: examined,
    sessionsFlagged,
    flagged: flagged.slice(0, limit),
    models: [...models.values()].sort(
      (a, b) =>
        b.flagged - a.flagged ||
        b.examined - a.examined ||
        (priceKey(a.provider, a.model) < priceKey(b.provider, b.model)
          ? -1
          : 1),
    ),
    notes,
  };
}

const percent = (share: number | null): string =>
  share === null ? "n/a" : `${(share * 100).toFixed(1)}%`;

function sessionLines(f: FlaggedSession, index: number): string[] {
  const lines = [
    `${index + 1}. ${f.sessionId} | ${f.agent} | ${f.provider}/${f.model} | ${f.steps} steps | cache ${percent(f.cacheRatio)} | ${money(f.totalMicros)}`,
  ];
  if (f.frozen)
    lines.push(
      `   frozen: ${f.frozen.steps} steps at cache read ${f.frozen.cacheRead} from step ${f.frozen.startStep} (${clock(f.frozen.startAt)}), uncached input ${f.frozen.inputAtStart} -> ${f.frozen.inputAtEnd}`,
    );
  if (f.fullMisses.count > 0)
    lines.push(
      `   full misses: ${f.fullMisses.count}; ${f.fullMisses.entries.map((m) => `step ${m.step} (${clock(m.at)}) input ${m.input}`).join(", ")}`,
    );
  if (f.changePoints.count > 0)
    lines.push(
      `   ratio change-points: ${f.changePoints.count}; ${f.changePoints.entries.map((c) => `${c.direction} at step ${c.step} (${clock(c.at)}) ratio ${percent(c.ratio)}`).join(", ")}`,
    );
  lines.push(
    f.estimatedWasteMicros === undefined
      ? `   waste omitted: ${f.wasteOmitted}`
      : `   est. waste: ${money(f.estimatedWasteMicros)}`,
  );
  return lines;
}

export function renderCacheBreaks(result: CacheBreaks): string {
  const lines = [
    header(result.range, result.totalMicros, result.complete),
    `${result.sessionsFlagged} of ${result.sessionsExamined} examined session(s) flagged${result.flagged.length < result.sessionsFlagged ? `, ${result.flagged.length} shown` : ""}`,
    ...result.flagged.flatMap(sessionLines),
    ...(result.models.length === 0
      ? []
      : [
          "Per model (flagged/examined):",
          ...result.models.map(
            (m) => `${m.provider}/${m.model}: ${m.flagged}/${m.examined}`,
          ),
        ]),
    ...result.notes.map((n) => `Note: ${n}`),
  ];
  return capText(lines.join("\n"));
}
