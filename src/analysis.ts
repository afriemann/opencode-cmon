import { formatUsd } from "./money";
import { rowAddOn, type PriceTable } from "./pricing";
import { localMonthRange, RETENTION_MONTHS, retentionCutoff } from "./time";
import type { CostRow } from "./types";

export const DEFAULT_LIMIT = 10;
export const REPORT_MAX_LIMIT = 50;
export const HOTSPOTS_MAX_LIMIT = 30;
export const MAX_PERIOD_DAYS = 184;
export const TEXT_MAX_BYTES = 8 * 1024;
export const TEXT_MAX_LINES = 120;

/** A session below this cache-read share of its input-side tokens is flagged. */
export const LOW_CACHE_READ_RATIO = 0.5;
/** Minimum input plus cache-read tokens a session needs before its cache ratio is judged. */
export const MIN_CACHE_TOKENS = 100_000;
/** A root session with at least this many descendant sessions is a fan-out. */
export const FANOUT_MIN_CHILDREN = 5;
/** Minimum steps for a context-growth finding. */
export const GROWTH_MIN_STEPS = 5;
/** Last-to-first input-side token ratio that counts as context growth. */
export const GROWTH_RATIO = 3;
/** Anthropic prompt-cache lifetime; a step after a longer pause rewrites the whole context. */
export const CACHE_TTL_MS = 5 * 60 * 1000;
/** Gaps below this are a continuous burst of steps. */
export const FAST_GAP_MS = 60 * 1000;
/** After an idle gap, a step reading less than this share of its input-side tokens from cache rewrote its context. */
export const IDLE_REWRITE_MAX_READ_SHARE = 0.5;
/** Gap buckets in display order. */
const GAP_BUCKETS = ["first", "<1m", "1-5m", ">5m"] as const;
/** Floor for the first step's input-side tokens in the growth ratio, so a tiny first step cannot inflate it. */
export const GROWTH_BASELINE_TOKENS = 5_000;
/** Most findings of one session- or step-level type. */
export const TOP_PER_TYPE = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const TRUNCATION_MARKER = "… truncated";
const TITLE_CAVEAT =
  "title-generation cost is not tracked, so real spend is slightly higher than shown.";
const PERIOD_FORMS =
  "month, YYYY-MM, <N>d (1-184 days) or YYYY-MM-DD..YYYY-MM-DD";

export interface Range {
  /** Epoch ms, inclusive. */
  readonly from: number;
  /** Epoch ms, exclusive. */
  readonly to: number;
}

export type GroupBy =
  "agent" | "model" | "provider" | "session" | "day" | "gap";
export type SortBy = "cost" | "steps" | "avgCost";

export interface AnalysisInput {
  readonly rows: readonly CostRow[];
  /** Rows matching every filter but lacking a directory; used only with `projectFiltered`. */
  readonly unknownDirectory: readonly CostRow[];
  /** Milliseconds since each row's previous step by row id; a missing or null entry means none. */
  readonly gaps: ReadonlyMap<string, number | null>;
  readonly projectFiltered: boolean;
  readonly catalog: PriceTable;
  readonly range: Range;
  readonly now: Date;
}

function invalidPeriod(spec: string): Error {
  return new Error(`Invalid period "${spec}". Accepted: ${PERIOD_FORMS}.`);
}

/** A real local calendar day, or undefined (rejects `2026-02-30`). */
function localDay(text: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return undefined;
  const [year, month, day] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
}

/** Parses a period into a half-open local-time range. */
export function parsePeriod(spec: string | undefined, now: Date): Range {
  if (spec === undefined || spec === "month") {
    const [from, to] = localMonthRange(now);
    return { from, to };
  }
  const month = /^(\d{4})-(\d{2})$/.exec(spec);
  if (month) {
    const monthIndex = Number(month[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) throw invalidPeriod(spec);
    const [from, to] = localMonthRange(
      new Date(Number(month[1]), monthIndex, 1),
    );
    return { from, to };
  }
  const days = /^(\d+)d$/.exec(spec);
  if (days) {
    const count = Number(days[1]);
    if (count < 1 || count > MAX_PERIOD_DAYS) throw invalidPeriod(spec);
    // The end is exclusive, so +1 keeps a row created at this very millisecond in range.
    return { from: now.getTime() - count * DAY_MS, to: now.getTime() + 1 };
  }
  const span = /^(.+)\.\.(.+)$/.exec(spec);
  const first = span && localDay(span[1] ?? "");
  const last = span && localDay(span[2] ?? "");
  if (first && last && first <= last) {
    const end = new Date(
      last.getFullYear(),
      last.getMonth(),
      last.getDate() + 1,
    );
    return { from: first.getTime(), to: end.getTime() };
  }
  throw invalidPeriod(spec);
}

export function validateLimit(limit: number | undefined, max: number): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > max)
    throw new Error(`limit must be an integer from 1 to ${max}.`);
  return limit;
}

interface PricedRow {
  readonly row: CostRow;
  /** opencode's cost plus the cache-write add-on. */
  readonly micros: number;
  /** The cache-write add-on alone. */
  readonly addOnMicros: number;
}

interface Priced {
  readonly rows: PricedRow[];
  /** Rows whose cache-write add-on could not be priced. */
  readonly unpricedRows: number;
}

function price(rows: readonly CostRow[], catalog: PriceTable): Priced {
  let unpricedRows = 0;
  const priced = rows.map((row): PricedRow => {
    const addOn = rowAddOn(row, catalog);
    if (addOn.kind === "unknown") {
      unpricedRows += 1;
      return { row, micros: row.costMicros, addOnMicros: 0 };
    }
    return {
      row,
      micros: row.costMicros + addOn.micros,
      addOnMicros: addOn.micros,
    };
  });
  return { rows: priced, unpricedRows };
}

const sum = (rows: readonly PricedRow[]): number =>
  rows.reduce((total, entry) => total + entry.micros, 0);

function dateOf(epoch: number): string {
  const date = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function notesFor(
  input: AnalysisInput,
  unpricedRows: number,
  excluded: { rows: number; micros: number } | undefined,
): string[] {
  const notes = [TITLE_CAVEAT];
  const cutoff = retentionCutoff(input.now);
  if (input.range.from < cutoff)
    notes.push(
      `Data older than ${RETENTION_MONTHS} months was pruned; the period effectively starts ${dateOf(cutoff)}.`,
    );
  if (unpricedRows > 0)
    notes.push(
      `Incomplete: the Copilot Claude cache-write cost is missing for ${unpricedRows} row(s) (unknown tokens or no catalog price), so totals are a lower bound.`,
    );
  if (excluded)
    notes.push(
      `${excluded.rows} row(s) with an unknown directory (${money(excluded.micros)}) are excluded by the project filter.`,
    );
  return notes;
}

function excludedOf(input: AnalysisInput) {
  if (!input.projectFiltered) return undefined;
  const unknown = price(input.unknownDirectory, input.catalog);
  return { rows: unknown.rows.length, micros: sum(unknown.rows) };
}

export interface TokenSums {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export interface GroupStats {
  readonly key: string;
  readonly micros: number;
  readonly share: number;
  readonly steps: number;
  /** Average cost per step; null without steps. */
  readonly avgMicros: number | null;
  readonly tokens: TokenSums;
  /** Cache-read share of input-side tokens; null when no cache tokens were reported. */
  readonly cacheReadRatio: number | null;
  readonly failedMicros: number;
}

export interface Report {
  readonly range: Range;
  readonly groupBy: GroupBy;
  readonly totalMicros: number;
  readonly complete: boolean;
  readonly groups: GroupStats[];
  readonly notes: string[];
  readonly excluded?: { rows: number; micros: number };
}

function gapBucket(gap: number | null | undefined): string {
  if (gap === null || gap === undefined) return "first";
  if (gap < FAST_GAP_MS) return "<1m";
  return gap <= CACHE_TTL_MS ? "1-5m" : ">5m";
}

function keyOf(
  row: CostRow,
  groupBy: GroupBy,
  gaps: AnalysisInput["gaps"],
): string {
  switch (groupBy) {
    case "agent":
      return row.agent;
    case "model":
      return row.modelId;
    case "provider":
      return row.providerId;
    case "session":
      return row.sessionId;
    case "day":
      return dateOf(row.createdAt);
    case "gap":
      return gapBucket(gaps.get(row.id));
  }
}

function statsOf(
  key: string,
  entries: readonly PricedRow[],
  total: number,
): GroupStats {
  const tokens = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  let steps = 0;
  let failedMicros = 0;
  for (const { row, micros } of entries) {
    if (row.kind === "step") steps += 1;
    if (row.failed) failedMicros += micros;
    tokens.input += row.tokens?.input ?? 0;
    tokens.cacheRead += row.tokens?.cacheRead ?? 0;
    tokens.cacheWrite += row.tokens?.cacheWrite ?? 0;
    tokens.output += row.outputTokens ?? 0;
    tokens.reasoning += row.reasoningTokens ?? 0;
  }
  const micros = sum(entries);
  const cacheTokens = tokens.cacheRead + tokens.cacheWrite;
  return {
    key,
    micros,
    share: total === 0 ? 0 : micros / total,
    steps,
    avgMicros: steps === 0 ? null : Math.round(micros / steps),
    tokens,
    cacheReadRatio:
      cacheTokens === 0
        ? null
        : tokens.cacheRead /
          (tokens.input + tokens.cacheRead + tokens.cacheWrite),
    failedMicros,
  };
}

const SORTS: Record<SortBy, (g: GroupStats) => number> = {
  cost: (g) => g.micros,
  steps: (g) => g.steps,
  avgCost: (g) => g.avgMicros ?? -1,
};

export function buildReport(
  input: AnalysisInput,
  options: { groupBy: GroupBy; sort: SortBy; limit: number },
): Report {
  const priced = price(input.rows, input.catalog);
  const total = sum(priced.rows);
  const buckets = groupBy(priced.rows, (entry) =>
    keyOf(entry.row, options.groupBy, input.gaps),
  );
  const metric = SORTS[options.sort];
  const all = [...buckets].map(([key, entries]) =>
    statsOf(key, entries, total),
  );
  const bucketOrder = (key: string): number =>
    (GAP_BUCKETS as readonly string[]).indexOf(key);
  all.sort(
    options.groupBy === "gap"
      ? (a, b) => bucketOrder(a.key) - bucketOrder(b.key)
      : (a, b) => metric(b) - metric(a) || (a.key < b.key ? -1 : 1),
  );
  const kept = all.slice(0, options.limit);
  const rest = all.slice(options.limit);
  const groups = [...kept];
  if (rest.length > 0) {
    const restKeys = new Set(rest.map((g) => g.key));
    const entries = priced.rows.filter((e) =>
      restKeys.has(keyOf(e.row, options.groupBy, input.gaps)),
    );
    groups.push(statsOf("others", entries, total));
  }
  const excluded = excludedOf(input);
  return {
    range: input.range,
    groupBy: options.groupBy,
    totalMicros: total,
    complete: priced.unpricedRows === 0,
    groups,
    notes: notesFor(input, priced.unpricedRows, excluded),
    ...(excluded ? { excluded } : {}),
  };
}

export type FindingType =
  | "top_session"
  | "top_step"
  | "low_cache_read"
  | "cache_write_spend"
  | "failed_steps"
  | "truncated_steps"
  | "compaction_spend"
  | "subagent_fanout"
  | "input_growth"
  | "idle_cache_rewrite"
  | "agent_model_mix";

export interface Finding {
  readonly type: FindingType;
  readonly scope: string;
  readonly evidence: {
    readonly metric: string;
    readonly value: number | string;
    readonly threshold: number | null;
  };
  /** Cost covered by the pattern; overlaps with other findings. */
  readonly attributableMicros: number;
  readonly share: number;
  readonly suggestion: string | null;
  readonly basis: string;
}

export interface Hotspots {
  readonly range: Range;
  readonly totalMicros: number;
  readonly complete: boolean;
  readonly findings: Finding[];
  readonly notes: string[];
}

const SHORT_ID_LENGTH = 8;
const shortId = (id: string): string => id.slice(-SHORT_ID_LENGTH);

function bySessionRoot(rows: readonly PricedRow[]) {
  const parent = new Map<string, string | null>();
  for (const { row } of rows) parent.set(row.sessionId, row.parentSessionId);
  const chain = (session: string): string[] => {
    const seen = new Set<string>();
    let current: string | null = session;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      current = parent.get(current) ?? null;
    }
    return [...seen];
  };
  const rolled = new Map<string, number>();
  const own = new Map<string, number>();
  const descendants = new Map<string, Set<string>>();
  for (const { row, micros } of rows) {
    own.set(row.sessionId, (own.get(row.sessionId) ?? 0) + micros);
    const ids = chain(row.sessionId);
    for (const id of ids) rolled.set(id, (rolled.get(id) ?? 0) + micros);
    const root = ids[ids.length - 1] ?? row.sessionId;
    if (root !== row.sessionId) {
      const set = descendants.get(root) ?? new Set<string>();
      for (const id of ids.slice(0, -1)) set.add(id);
      descendants.set(root, set);
    }
  }
  const roots = new Set<string>();
  for (const { row } of rows) {
    const ids = chain(row.sessionId);
    roots.add(ids[ids.length - 1] ?? row.sessionId);
  }
  return { rolled, own, descendants, roots };
}

const topBy = <T>(items: readonly T[], metric: (item: T) => number): T[] =>
  [...items].sort((a, b) => metric(b) - metric(a)).slice(0, TOP_PER_TYPE);

function groupBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const bucket = map.get(name);
    if (bucket) bucket.push(item);
    else map.set(name, [item]);
  }
  return map;
}

const inputSide = (row: CostRow): number =>
  (row.tokens?.input ?? 0) + (row.tokens?.cacheRead ?? 0);

export function buildHotspots(input: AnalysisInput, limit: number): Hotspots {
  const priced = price(input.rows, input.catalog);
  const total = sum(priced.rows);
  const findings: Omit<Finding, "share">[] = [];
  const add = (finding: Omit<Finding, "share">): number =>
    findings.push(finding);

  const tree = bySessionRoot(priced.rows);
  for (const root of topBy([...tree.roots], (id) => tree.rolled.get(id) ?? 0)) {
    add({
      type: "top_session",
      scope: root,
      evidence: {
        metric: "sessionCostWithSubagentsMicros",
        value: tree.rolled.get(root) ?? 0,
        threshold: null,
      },
      attributableMicros: tree.rolled.get(root) ?? 0,
      suggestion:
        "Inspect this session: which agent, model and step dominate (cost_report with the session filter).",
      basis:
        "Cost of the root session plus all descendant sessions in the period.",
    });
  }
  for (const entry of topBy(priced.rows, (e) => e.micros)) {
    add({
      type: "top_step",
      scope: `${shortId(entry.row.id)} in ${entry.row.sessionId}`,
      evidence: {
        metric: "stepCostMicros",
        value: entry.micros,
        threshold: null,
      },
      attributableMicros: entry.micros,
      suggestion:
        "Check what this step sent or produced (large context or output).",
      basis: "Single most expensive rows, including the cache-write add-on.",
    });
  }

  const reportsCacheReads = new Set(
    priced.rows
      .filter((e) => (e.row.tokens?.cacheRead ?? 0) > 0)
      .map((e) => `${e.row.providerId}/${e.row.modelId}`),
  );
  const cacheSessions = groupBy(
    priced.rows.filter(
      (e) =>
        e.row.tokens !== null &&
        reportsCacheReads.has(`${e.row.providerId}/${e.row.modelId}`),
    ),
    (e) => e.row.sessionId,
  );
  const lowCache = [...cacheSessions]
    .map(([session, entries]) => {
      const t = entries.reduce(
        (a, e) => ({
          input: a.input + (e.row.tokens?.input ?? 0),
          read: a.read + (e.row.tokens?.cacheRead ?? 0),
          write: a.write + (e.row.tokens?.cacheWrite ?? 0),
        }),
        { input: 0, read: 0, write: 0 },
      );
      return {
        session,
        micros: sum(entries),
        ratio: t.read / (t.input + t.read + t.write),
        context: t.input + t.read,
      };
    })
    .filter(
      (s) => s.context >= MIN_CACHE_TOKENS && s.ratio < LOW_CACHE_READ_RATIO,
    );
  for (const s of topBy(lowCache, (x) => x.micros)) {
    add({
      type: "low_cache_read",
      scope: s.session,
      evidence: {
        metric: "cacheReadRatio",
        value: Math.round(s.ratio * 1000) / 1000,
        threshold: LOW_CACHE_READ_RATIO,
      },
      attributableMicros: s.micros,
      suggestion:
        "Keep the prompt prefix stable (system prompt, tool list, early messages) so more of it is served from cache.",
      basis: `Sessions with at least ${MIN_CACHE_TOKENS} input+cache-read tokens on provider/model pairs that report cache reads somewhere in the period; cost is that of those steps.`,
    });
  }

  const writers = priced.rows.filter(
    (e) => (e.row.tokens?.cacheWrite ?? 0) > 0,
  );
  if (writers.length > 0) {
    add({
      type: "cache_write_spend",
      scope: "all",
      evidence: {
        metric: "cacheWriteTokens",
        value: writers.reduce((n, e) => n + (e.row.tokens?.cacheWrite ?? 0), 0),
        threshold: null,
      },
      attributableMicros: writers.reduce((n, e) => n + e.addOnMicros, 0),
      suggestion:
        "Frequent cache writes mean the cached prefix keeps changing; avoid editing early context.",
      basis:
        "Cost is the cache-write add-on billed for Copilot Claude only; for other providers the write cost is inside opencode's cost and not separable, so only tokens are shown.",
    });
  }

  const wasted: ReadonlyArray<
    [FindingType, string, (r: CostRow) => boolean, string, string]
  > = [
    [
      "failed_steps",
      "failedSteps",
      (r) => r.failed,
      "Find why steps fail or abort (errors, user aborts) before they bill.",
      "Cost of rows marked failed.",
    ],
    [
      "truncated_steps",
      "truncatedSteps",
      (r) => r.finish === "length",
      "Steps hit the output limit; shorten the task or split it so output is not cut off and redone.",
      "Cost of steps whose finish reason is length.",
    ],
    [
      "compaction_spend",
      "compactions",
      (r) => r.kind === "compaction",
      "Frequent compaction signals oversized contexts; start fresh sessions or trim tool output.",
      "Cost of compaction rows.",
    ],
  ];
  for (const [type, metric, test, suggestion, basis] of wasted) {
    const matching = priced.rows.filter((e) => test(e.row));
    if (matching.length === 0) continue;
    add({
      type,
      scope: "all",
      evidence: { metric, value: matching.length, threshold: null },
      attributableMicros: sum(matching),
      suggestion,
      basis,
    });
  }

  const fanouts = [...tree.roots]
    .map((root) => ({
      root,
      children: tree.descendants.get(root)?.size ?? 0,
      micros: (tree.rolled.get(root) ?? 0) - (tree.own.get(root) ?? 0),
    }))
    .filter((f) => f.children >= FANOUT_MIN_CHILDREN);
  for (const f of topBy(fanouts, (x) => x.micros)) {
    add({
      type: "subagent_fanout",
      scope: f.root,
      evidence: {
        metric: "descendantSessions",
        value: f.children,
        threshold: FANOUT_MIN_CHILDREN,
      },
      attributableMicros: f.micros,
      suggestion:
        "Many sub-agent sessions: batch the delegated work or give each sub-agent a narrower brief.",
      basis:
        "Cost of all descendant sessions of a root session. A child whose parent lookup failed was recorded without a parent and counts as a root.",
    });
  }

  const growth = [
    ...groupBy(
      priced.rows.filter((e) => e.row.kind === "step" && e.row.tokens !== null),
      (e) => e.row.sessionId,
    ),
  ]
    .map(([session, entries]) => {
      const ordered = [...entries].sort(
        (a, b) =>
          a.row.createdAt - b.row.createdAt || (a.row.id < b.row.id ? -1 : 1),
      );
      const first = inputSide(ordered[0]!.row);
      const last = inputSide(ordered[ordered.length - 1]!.row);
      return {
        session,
        steps: ordered.length,
        ratio: last / Math.max(first, GROWTH_BASELINE_TOKENS),
        micros: sum(ordered),
      };
    })
    .filter((s) => s.steps >= GROWTH_MIN_STEPS && s.ratio >= GROWTH_RATIO);
  for (const s of topBy(growth, (x) => x.micros)) {
    add({
      type: "input_growth",
      scope: s.session,
      evidence: {
        metric: "lastToFirstInputRatio",
        value: Math.round(s.ratio * 10) / 10,
        threshold: GROWTH_RATIO,
      },
      attributableMicros: s.micros,
      suggestion:
        "Context grows every step; compact earlier, split the task, or cut large tool outputs.",
      basis: `Sessions with at least ${GROWTH_MIN_STEPS} steps; ratio of input+cache-read tokens of the last step to the first (at least ${GROWTH_BASELINE_TOKENS}). A compaction resets context and lowers the ratio.`,
    });
  }

  const rewrites = priced.rows.filter((e) => {
    const gap = input.gaps.get(e.row.id);
    const t = e.row.tokens;
    if (e.row.kind !== "step" || t === null || gap == null) return false;
    const side = t.input + t.cacheRead + t.cacheWrite;
    return (
      gap > CACHE_TTL_MS &&
      side > 0 &&
      t.cacheRead / side < IDLE_REWRITE_MAX_READ_SHARE
    );
  });
  if (rewrites.length > 0) {
    const written = rewrites.reduce(
      (n, e) => n + (e.row.tokens?.cacheWrite ?? 0),
      0,
    );
    add({
      type: "idle_cache_rewrite",
      scope: "all",
      evidence: {
        metric: "stepsAfterIdleGap",
        value: `${rewrites.length} step(s), avg ${Math.round(written / rewrites.length)} cache-write tokens`,
        threshold: CACHE_TTL_MS / 60_000,
      },
      attributableMicros: sum(rewrites),
      suggestion:
        "Pauses over 5 minutes let the prompt cache expire and the whole context is written again; compact or start a fresh session instead of resuming a large one after a break.",
      basis: `Steps whose gap to the previous step in their session exceeds ${CACHE_TTL_MS / 60_000} minutes and that read under ${IDLE_REWRITE_MAX_READ_SHARE * 100}% of their input-side tokens from cache. The gap is between recorded step start times, so it includes tool run and thinking time; the provider's real cache expiry is not observable.`,
    });
  }

  for (const [agent, entries] of groupBy(priced.rows, (e) => e.row.agent)) {
    const agentTotal = sum(entries);
    const models = [...groupBy(entries, (e) => e.row.modelId)]
      .map(([model, rows]) => ({ model, micros: sum(rows) }))
      .sort((a, b) => b.micros - a.micros);
    const outputs = entries.filter(
      (e) => e.row.kind === "step" && e.row.outputTokens !== null,
    );
    const averageOutput =
      outputs.length === 0
        ? "n/a"
        : String(
            Math.round(
              outputs.reduce((n, e) => n + (e.row.outputTokens ?? 0), 0) /
                outputs.length,
            ),
          );
    const shares = models
      .map(
        (m) =>
          `${m.model} ${agentTotal === 0 ? 0 : Math.round((m.micros / agentTotal) * 100)}%`,
      )
      .join(", ");
    add({
      type: "agent_model_mix",
      scope: agent,
      evidence: {
        metric: "modelShareAndAvgOutputTokensPerStep",
        value: `${shares}; avg output ${averageOutput} tokens/step`,
        threshold: null,
      },
      attributableMicros: agentTotal,
      suggestion: null,
      basis:
        "A fact, not a recommendation: the agent's total cost split by model. Whether a cheaper model would do is not observable here.",
    });
  }

  // Facts without a recommendation rank after every actionable finding, whatever their cost.
  const factRank = (f: Omit<Finding, "share">): number =>
    f.suggestion === null ? 1 : 0;
  const compareText = (a: string, b: string): number =>
    a < b ? -1 : a > b ? 1 : 0;
  const ranked = findings
    .sort(
      (a, b) =>
        factRank(a) - factRank(b) ||
        b.attributableMicros - a.attributableMicros ||
        compareText(a.type, b.type) ||
        compareText(a.scope, b.scope),
    )
    .slice(0, limit)
    .map((f): Finding => ({
      ...f,
      share: total === 0 ? 0 : f.attributableMicros / total,
    }));
  const excluded = excludedOf(input);
  return {
    range: input.range,
    totalMicros: total,
    complete: priced.unpricedRows === 0,
    findings: ranked,
    notes: [
      "Attributable costs overlap between findings (a session can also have failed steps); do not add them up.",
      ...notesFor(input, priced.unpricedRows, excluded),
    ],
  };
}

export function money(micros: number): string {
  return micros !== 0 && micros < 10_000
    ? `$${(micros / 1_000_000).toFixed(4)}`
    : formatUsd(micros);
}

const compact = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : String(n);
const percent = (share: number): string => `${(share * 100).toFixed(1)}%`;
const day = (epoch: number): string => dateOf(epoch);

/** Cuts text to the line and byte caps, ending with a marker when anything was removed. */
export function capText(text: string): string {
  const encoder = new TextEncoder();
  const lines = text.split("\n");
  if (
    lines.length <= TEXT_MAX_LINES &&
    encoder.encode(text).length <= TEXT_MAX_BYTES
  )
    return text;
  let cut = lines.slice(0, TEXT_MAX_LINES - 1).join("\n");
  const budget =
    TEXT_MAX_BYTES - encoder.encode(`\n${TRUNCATION_MARKER}`).length;
  while (encoder.encode(cut).length > budget)
    cut = cut.slice(
      0,
      Math.max(
        0,
        cut.length - Math.ceil((encoder.encode(cut).length - budget) / 3) - 1,
      ),
    );
  return `${cut}\n${TRUNCATION_MARKER}`;
}

function header(range: Range, total: number, complete: boolean): string {
  const approx = complete ? "" : "~";
  return `Period ${day(range.from)} to ${day(range.to - 1)}, total ${approx}${money(total)}${complete ? "" : " (incomplete)"}`;
}

export function renderReport(report: Report): string {
  const lines = [
    header(report.range, report.totalMicros, report.complete),
    `Grouped by ${report.groupBy}: cost, share, steps, avg/step, tokens in/out/reasoning/cache-read/cache-write, cache-read ratio, failed cost`,
    ...report.groups.map((g) => {
      const t = g.tokens;
      return [
        g.key,
        money(g.micros),
        percent(g.share),
        `${g.steps} steps`,
        g.avgMicros === null ? "avg n/a" : `avg ${money(g.avgMicros)}`,
        `tok ${compact(t.input)}/${compact(t.output)}/${compact(t.reasoning)}/${compact(t.cacheRead)}/${compact(t.cacheWrite)}`,
        g.cacheReadRatio === null
          ? "cache n/a"
          : `cache ${percent(g.cacheReadRatio)}`,
        `failed ${money(g.failedMicros)}`,
      ].join(" | ");
    }),
    ...report.notes.map((n) => `Note: ${n}`),
  ];
  return capText(lines.join("\n"));
}

export function renderHotspots(hotspots: Hotspots): string {
  const lines = [
    header(hotspots.range, hotspots.totalMicros, hotspots.complete),
  ];
  if (hotspots.findings.length === 0) lines.push("No findings.");
  hotspots.findings.forEach((f, i) => {
    const threshold =
      f.evidence.threshold === null
        ? ""
        : ` (threshold ${f.evidence.threshold})`;
    const value =
      f.evidence.metric.endsWith("Micros") &&
      typeof f.evidence.value === "number"
        ? money(f.evidence.value)
        : f.evidence.value;
    lines.push(
      `${i + 1}. ${f.type} [${f.scope}] ${money(f.attributableMicros)} (${percent(f.share)})`,
      `   evidence: ${f.evidence.metric} = ${value}${threshold}`,
      ...(f.suggestion === null ? [] : [`   suggestion: ${f.suggestion}`]),
      `   basis: ${f.basis}`,
    );
  });
  lines.push(...hotspots.notes.map((n) => `Note: ${n}`));
  return capText(lines.join("\n"));
}
