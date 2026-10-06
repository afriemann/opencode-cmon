/** GitHub bills Claude cache writes at 1.25x the input price (5-minute cache, verified against the Copilot usage table). */
export const CACHE_WRITE_MULTIPLIER = 1.25;
const COPILOT_PROVIDER = "github-copilot";
const CLAUDE_FAMILY_PREFIX = "claude";
const CLAUDE_ID_PREFIX = "claude-";

export interface CostTier {
  readonly tier?: { readonly type: "context"; readonly size: number };
  readonly input: number;
  readonly cache: { readonly read: number; readonly write: number };
}

export interface ModelPrice {
  readonly providerId: string;
  readonly modelId: string;
  readonly family?: string;
  readonly cost: readonly CostTier[];
}

export interface TokenCounts {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** Keyed by `${providerId}/${modelId}`. */
export type PriceTable = ReadonlyMap<string, ModelPrice>;

export function priceKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function tokenCounts(value: unknown): TokenCounts {
  const tokens = record(value);
  const cache = record(tokens?.cache);
  return {
    input: finiteOrZero(tokens?.input),
    cacheRead: finiteOrZero(cache?.read),
    cacheWrite: finiteOrZero(cache?.write),
  };
}

function isCopilotClaude(price: ModelPrice): boolean {
  if (price.providerId !== COPILOT_PROVIDER) return false;
  return price.family !== undefined
    ? price.family.toLowerCase().startsWith(CLAUDE_FAMILY_PREFIX)
    : price.modelId.startsWith(CLAUDE_ID_PREFIX);
}

/** Mirrors opencode's `calculateCost`: largest context tier below the context size, else the untiered entry. */
export function selectTier(
  cost: readonly CostTier[],
  tokens: TokenCounts,
): CostTier | undefined {
  const context = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  const tiered = cost
    .filter(
      (entry): entry is CostTier & { tier: NonNullable<CostTier["tier"]> } =>
        entry.tier?.type === "context",
    )
    .filter((entry) => context > entry.tier.size)
    .sort((a, b) => b.tier.size - a.tier.size)[0];
  return tiered ?? cost.find((entry) => entry.tier === undefined);
}

/**
 * Extra micro-USD for cache-write tokens that opencode prices at zero. Prices are USD per million
 * tokens, so tokens x price is already micro-USD.
 */
export function cacheWriteExtraMicros(
  tokens: TokenCounts,
  price: ModelPrice | undefined,
): number {
  if (!price || tokens.cacheWrite === 0 || !isCopilotClaude(price)) return 0;
  const tier = selectTier(price.cost, tokens);
  if (!tier || tier.cache.write !== 0) return 0;
  return Math.round(tokens.cacheWrite * CACHE_WRITE_MULTIPLIER * tier.input);
}

function parseTier(value: unknown): CostTier | undefined {
  const entry = record(value);
  const cache = record(entry?.cache);
  if (
    !entry ||
    typeof entry.input !== "number" ||
    typeof cache?.write !== "number"
  )
    return undefined;
  const tier = record(entry.tier);
  const read = typeof cache.read === "number" ? cache.read : 0;
  return {
    ...(tier?.type === "context" && typeof tier.size === "number"
      ? { tier: { type: "context" as const, size: tier.size } }
      : {}),
    input: entry.input,
    cache: { read, write: cache.write },
  };
}

/** Defensive: unknown shapes and bad entries are skipped, never thrown. */
export function parseCatalog(response: unknown): PriceTable {
  const list = Array.isArray(response) ? response : record(response)?.data;
  const table = new Map<string, ModelPrice>();
  if (!Array.isArray(list)) return table;
  for (const item of list) {
    const model = record(item);
    if (
      !model ||
      typeof model.id !== "string" ||
      typeof model.providerID !== "string"
    )
      continue;
    const cost = (Array.isArray(model.cost) ? model.cost : [])
      .map(parseTier)
      .filter((tier): tier is CostTier => tier !== undefined);
    table.set(priceKey(model.providerID, model.id), {
      providerId: model.providerID,
      modelId: model.id,
      ...(typeof model.family === "string" ? { family: model.family } : {}),
      cost,
    });
  }
  return table;
}

/** True when the catalog carries at least one priced Copilot model (a partial catalog may not). */
export function hasCopilotPrices(table: PriceTable): boolean {
  for (const price of table.values()) {
    if (price.providerId === COPILOT_PROVIDER && price.cost.length > 0)
      return true;
  }
  return false;
}

export interface PriceLookup {
  /** The cached table; loads when empty or invalidated. Concurrent calls share one load. */
  current(): Promise<PriceTable>;
  /** Marks the cache stale so the next `current()` reloads. */
  invalidate(): void;
}

const EMPTY: PriceTable = new Map();
/** A hung catalog call must not stall startup or recording; recording with add-on 0 is the soft failure. */
const LOAD_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createPriceLookup(
  list: () => Promise<unknown>,
  log: (message: string) => void,
): PriceLookup {
  let table: PriceTable = EMPTY;
  let stale = true;
  let inFlight: Promise<PriceTable> | undefined;
  let failing = false;

  async function load(): Promise<PriceTable> {
    try {
      const loaded = parseCatalog(await withTimeout(list(), LOAD_TIMEOUT_MS));
      failing = false;
      if (loaded.size > 0) {
        table = loaded;
        stale = false;
      }
    } catch (error) {
      if (!failing) log(`failed to load model prices: ${String(error)}`);
      failing = true;
    }
    return table;
  }

  return {
    async current() {
      if (!stale && table.size > 0) return table;
      inFlight ??= load().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    invalidate() {
      stale = true;
    },
  };
}
