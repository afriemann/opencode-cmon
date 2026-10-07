import { rowAddOn, type PriceTable } from "./pricing";
import type { AgentTotal, Candidate, ModelTotal, ProviderTotal } from "./types";

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
