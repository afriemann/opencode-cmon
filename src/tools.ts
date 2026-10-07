import { isAbsolute } from "node:path";
import {
  buildHotspots,
  buildReport,
  HOTSPOTS_MAX_LIMIT,
  parsePeriod,
  renderHotspots,
  renderReport,
  REPORT_MAX_LIMIT,
  validateLimit,
  type AnalysisInput,
  type GroupBy,
  type SortBy,
} from "./analysis";
import type { PriceTable } from "./pricing";
import type { RowFilter, Store } from "./store";
import type { EntryKind } from "./types";

const GROUP_BY: readonly GroupBy[] = [
  "agent",
  "model",
  "provider",
  "session",
  "day",
];
const SORT_BY: readonly SortBy[] = ["cost", "steps", "avgCost"];
const KINDS: readonly EntryKind[] = ["step", "compaction"];
const CURRENT_PROJECT = "current";
const NAMESPACE = "cmon";

export interface CostToolDeps {
  /** The live store; throws once cost tracking has stopped. */
  readonly store: () => Pick<Store, "filteredRows">;
  readonly catalog: () => PriceTable;
  /** Called when a result is incomplete so the price catalog can reload. */
  readonly onIncomplete: () => void;
  /** Directory of the calling session, or null when unknown. */
  readonly sessionDirectory: (sessionID: string) => Promise<string | null>;
  readonly now: () => Date;
}

export interface CostTool {
  readonly name: string;
  readonly description: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: Readonly<Record<string, unknown>>;
  readonly options: { readonly namespace: string; readonly pinned: true };
  readonly execute: (
    input: unknown,
    context: { readonly sessionID: string },
  ) => Promise<{ output: unknown; content: string }>;
}

const COMMON_DESCRIPTION =
  "Amounts are USD. `period` is `month` (default, current local month), `YYYY-MM`, `<N>d` (last N days, 1-184) or `YYYY-MM-DD..YYYY-MM-DD` (inclusive local days); only the last 6 months are kept. " +
  "`project` limits to a directory and everything below it (so a repo root covers its worktrees); `current` is the calling session's directory; omitted means all projects, and rows with unknown directory are excluded when it is set. " +
  "`session` includes its sub-agent sessions unless `includeSubagents` is false. Note that title-generation cost is not tracked.";

const FILTER_PROPERTIES = {
  period: {
    type: "string",
    description: "month | YYYY-MM | <N>d | YYYY-MM-DD..YYYY-MM-DD",
  },
  agent: { type: "string" },
  model: { type: "string", description: "Model id, merged across providers" },
  provider: { type: "string" },
  kind: { type: "string", enum: KINDS },
  session: { type: "string", description: "Session id" },
  includeSubagents: { type: "boolean", description: "Default true" },
  project: { type: "string", description: "Absolute directory, or `current`" },
} as const;

function limitProperty(max: number) {
  return {
    type: "integer",
    minimum: 1,
    maximum: max,
    description: `Default 10, at most ${max}`,
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function text(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string.`);
  return value;
}

function choice<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = text(input, key);
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T))
    throw new Error(`${key} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

async function loadInput(
  deps: CostToolDeps,
  raw: unknown,
  sessionID: string,
): Promise<{ args: Record<string, unknown>; input: AnalysisInput }> {
  const args = record(raw);
  const now = deps.now();
  const range = parsePeriod(text(args, "period"), now);
  let project = text(args, "project");
  if (project === CURRENT_PROJECT) {
    const directory = await deps.sessionDirectory(sessionID);
    if (directory === null)
      throw new Error(
        "The directory of the calling session is unknown, so `current` cannot be resolved; pass an absolute project path.",
      );
    project = directory;
  } else if (project !== undefined && !isAbsolute(project)) {
    throw new Error("project must be an absolute directory path or `current`.");
  }
  const includeSubagents = args.includeSubagents;
  if (includeSubagents !== undefined && typeof includeSubagents !== "boolean")
    throw new Error("includeSubagents must be a boolean.");
  const optional = <K extends keyof RowFilter>(key: K, value: RowFilter[K]) =>
    value === undefined ? {} : { [key]: value };
  const filter: RowFilter = {
    ...range,
    ...optional("agent", text(args, "agent")),
    ...optional("model", text(args, "model")),
    ...optional("provider", text(args, "provider")),
    ...optional("kind", choice(args, "kind", KINDS)),
    ...optional("session", text(args, "session")),
    ...optional("includeSubagents", includeSubagents),
    ...optional("project", project),
  };
  const { rows, unknownDirectory } = deps.store().filteredRows(filter);
  return {
    args,
    input: {
      rows,
      unknownDirectory,
      projectFiltered: project !== undefined,
      catalog: deps.catalog(),
      range,
      now,
    },
  };
}

export function createCostTools(deps: CostToolDeps): CostTool[] {
  const options = { namespace: NAMESPACE, pinned: true } as const;
  const output = { type: "object", additionalProperties: true } as const;
  return [
    {
      name: "cost_report",
      description: `Report where opencode cost went: cost, share, steps, average cost per step, token counts, cache-read ratio and failed-step cost, grouped by agent (default), model, provider, session or day. Use it to find the biggest cost drivers. ${COMMON_DESCRIPTION}`,
      input: {
        type: "object",
        properties: {
          ...FILTER_PROPERTIES,
          groupBy: { type: "string", enum: GROUP_BY },
          sort: { type: "string", enum: SORT_BY, description: "Default cost" },
          limit: limitProperty(REPORT_MAX_LIMIT),
        },
        additionalProperties: false,
      },
      output,
      options,
      async execute(raw, context) {
        const { args, input } = await loadInput(deps, raw, context.sessionID);
        const report = buildReport(input, {
          groupBy: choice(args, "groupBy", GROUP_BY) ?? "agent",
          sort: choice(args, "sort", SORT_BY) ?? "cost",
          limit: validateLimit(numberArg(args), REPORT_MAX_LIMIT),
        });
        if (!report.complete) deps.onIncomplete();
        return { output: report, content: renderReport(report) };
      },
    },
    {
      name: "cost_hotspots",
      description: `Rank cost hotspots with evidence and suggestions for reducing them: expensive sessions and steps, low cache use, cache writes, failed or truncated steps, compactions, sub-agent fan-out, context growth and each agent's model mix. Attributable costs overlap, so do not add them up; suggestions are heuristics, not guarantees. ${COMMON_DESCRIPTION}`,
      input: {
        type: "object",
        properties: {
          ...FILTER_PROPERTIES,
          limit: limitProperty(HOTSPOTS_MAX_LIMIT),
        },
        additionalProperties: false,
      },
      output,
      options,
      async execute(raw, context) {
        const { args, input } = await loadInput(deps, raw, context.sessionID);
        const hotspots = buildHotspots(
          input,
          validateLimit(numberArg(args), HOTSPOTS_MAX_LIMIT),
        );
        if (!hotspots.complete) deps.onIncomplete();
        return { output: hotspots, content: renderHotspots(hotspots) };
      },
    },
  ];
}

function numberArg(args: Record<string, unknown>): number | undefined {
  const value = args.limit;
  if (value === undefined) return undefined;
  if (typeof value !== "number") throw new Error("limit must be a number.");
  return value;
}
