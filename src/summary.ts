import { rowAddOn, type PriceTable } from "./pricing";
import type {
  AgentTotal,
  Candidate,
  ModelTotal,
  ProviderTotal,
  TokenAgentTotal,
  TokenComponents,
  TokenModelTotal,
  TokenProviderTotal,
  TokenSummary,
  TokenUsageRow,
} from "./types";

export interface SummaryAggregate {
  readonly agents: readonly AgentTotal[];
  readonly models: readonly ModelTotal[];
  readonly providers: readonly ProviderTotal[];
}

export interface BuiltSummary {
  readonly totalMicros: number;
  readonly agents: AgentTotal[];
  readonly models: ModelTotal[];
  readonly providers: ProviderTotal[];
  /** False when a row that could carry a cache-write cost has unknown tokens or no price. */
  readonly complete: boolean;
  /** `providerId/modelId` of candidates without a priced catalog entry; used to trigger a reload. */
  readonly unpriced: string[];
}

/** Binary name order, matching the SQL `ORDER BY ... ASC` this replaces. */
function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorted<T extends { micros: number }>(
  totals: Map<string, number>,
  make: (name: string, micros: number) => T,
  nameOf: (entry: T) => string,
): T[] {
  return [...totals]
    .map(([name, micros]) => make(name, micros))
    .sort((a, b) => b.micros - a.micros || compareNames(nameOf(a), nameOf(b)));
}

/**
 * Combines opencode's own cost sums with a cache-write add-on computed per row from the current
 * catalog: one rounding per row, added as integers to the total, the agent and the model. Pure.
 */
export function buildSummary(
  aggregate: SummaryAggregate,
  candidates: readonly Candidate[],
  catalog: PriceTable,
): BuiltSummary {
  const agents = new Map(aggregate.agents.map((a) => [a.agent, a.micros]));
  const models = new Map(aggregate.models.map((m) => [m.model, m.micros]));
  const providers = new Map(
    aggregate.providers.map((p) => [p.provider, p.micros]),
  );
  const unpriced = new Set<string>();
  let complete = true;

  for (const row of candidates) {
    const addOn = rowAddOn(row, catalog);
    if (addOn.kind === "unknown") {
      complete = false;
      if (addOn.reason === "price") unpriced.add(addOn.key);
      continue;
    }
    const extra = addOn.micros;
    if (extra === 0) continue;
    agents.set(row.agent, (agents.get(row.agent) ?? 0) + extra);
    models.set(row.modelId, (models.get(row.modelId) ?? 0) + extra);
    providers.set(row.providerId, (providers.get(row.providerId) ?? 0) + extra);
  }

  const agentList = sorted(
    agents,
    (agent, micros) => ({ agent, micros }),
    (e) => e.agent,
  );
  return {
    totalMicros: agentList.reduce((sum, entry) => sum + entry.micros, 0),
    agents: agentList,
    models: sorted(
      models,
      (model, micros) => ({ model, micros }),
      (e) => e.model,
    ),
    providers: sorted(
      providers,
      (provider, micros) => ({ provider, micros }),
      (e) => e.provider,
    ),
    complete,
    unpriced: [...unpriced].sort(),
  };
}

/** Known subtotal plus availability of one row set or group. */
interface TokenTotals {
  readonly totalTokens: number | null;
  readonly complete: boolean;
}

interface Tally {
  known: number;
  hasKnown: boolean;
  complete: boolean;
}

function newTally(): Tally {
  return { known: 0, hasKnown: false, complete: true };
}

/** The five disjoint categories, exactly once each and never inferred from a price. */
function components(row: TokenComponents): readonly (number | null)[] {
  return [row.input, row.cacheRead, row.cacheWrite, row.output, row.reasoning];
}

/**
 * Adds one row's counts. A known count, including zero, sums into the subtotal; an unknown count
 * only marks the set incomplete. A row with some known counts still contributes those.
 */
function addRow(tally: Tally, row: TokenComponents): void {
  for (const value of components(row)) {
    if (value === null) {
      tally.complete = false;
      continue;
    }
    tally.known += value;
    tally.hasKnown = true;
  }
}

function totalsOf(tally: Tally): TokenTotals {
  return {
    totalTokens: tally.hasKnown ? tally.known : null,
    complete: tally.complete && tally.hasKnown,
  };
}

/**
 * Numeric totals descending, unavailable after every numeric value (including zero), then binary
 * name order. Completeness is not a tie-breaker.
 */
function compareTokenEntries<T extends TokenTotals>(
  nameOf: (entry: T) => string,
): (a: T, b: T) => number {
  return (a, b) => {
    if (a.totalTokens === null && b.totalTokens === null)
      return compareNames(nameOf(a), nameOf(b));
    if (a.totalTokens === null) return 1;
    if (b.totalTokens === null) return -1;
    return b.totalTokens - a.totalTokens || compareNames(nameOf(a), nameOf(b));
  };
}

function groupBy<T extends TokenTotals>(
  rows: readonly TokenUsageRow[],
  keyOf: (row: TokenUsageRow) => string,
  make: (name: string, totals: TokenTotals) => T,
  nameOf: (entry: T) => string,
): T[] {
  const groups = new Map<string, Tally>();
  for (const row of rows) {
    const key = keyOf(row);
    let tally = groups.get(key);
    if (tally === undefined) {
      tally = newTally();
      groups.set(key, tally);
    }
    addRow(tally, row);
  }
  return [...groups]
    .map(([name, tally]) => make(name, totalsOf(tally)))
    .sort(compareTokenEntries(nameOf));
}

/**
 * Projects retained token counts onto the additive summary view. Independent of prices and of the
 * dollar candidates: unknown prices never make tokens incomplete, and unknown counts never become
 * guessed zeros. Pure.
 */
export function buildTokenSummary(
  rows: readonly TokenUsageRow[],
): TokenSummary {
  const monthly = newTally();
  for (const row of rows) addRow(monthly, row);
  // An empty month is a known zero, not an unavailable month.
  const totals: TokenTotals =
    rows.length === 0 ? { totalTokens: 0, complete: true } : totalsOf(monthly);
  return {
    totalTokens: totals.totalTokens,
    complete: totals.complete,
    agents: groupBy<TokenAgentTotal>(
      rows,
      (row) => row.agent,
      (agent, group) => ({ agent, ...group }),
      (entry) => entry.agent,
    ),
    models: groupBy<TokenModelTotal>(
      rows,
      (row) => row.modelId,
      (model, group) => ({ model, ...group }),
      (entry) => entry.model,
    ),
    providers: groupBy<TokenProviderTotal>(
      rows,
      (row) => row.providerId,
      (provider, group) => ({ provider, ...group }),
      (entry) => entry.provider,
    ),
  };
}
