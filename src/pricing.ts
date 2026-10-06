/** GitHub bills Claude cache writes at 1.25x the input price (5-minute cache, verified against the Copilot usage table). */
export const CACHE_WRITE_MULTIPLIER = 1.25;
/** The only provider whose Claude cache writes are billed but priced at 0 by opencode. */
export const COPILOT_PROVIDER = "github-copilot";
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

/**
 * Whether a row of this model can carry a cache-write cost. With a catalog entry the Claude test
 * uses the entry's family; without one it falls back to the `claude-` id prefix.
 */
export function addOnApplies(
  providerId: string,
  modelId: string,
  price: ModelPrice | undefined,
): boolean {
  if (price) return isCopilotClaude(price);
  return (
    providerId === COPILOT_PROVIDER && modelId.startsWith(CLAUDE_ID_PREFIX)
  );
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

export interface PriceLookup {
  /** The cached catalog snapshot; synchronous, never loads, empty until the first load lands. */
  table(): PriceTable;
  /**
   * Fire-and-forget reload, one load at a time. `"updated"` always loads (queued once if a load is
   * running); `"miss"` loads at most once per `MISS_RELOAD_INTERVAL_MS`.
   */
  refresh(reason: "updated" | "miss"): void;
}

const EMPTY: PriceTable = new Map();
/** A hung catalog call must not stall anything for long; the summary never waits for it anyway. */
const LOAD_TIMEOUT_MS = 5_000;
const MISS_RELOAD_INTERVAL_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function fingerprint(table: PriceTable): string {
  return JSON.stringify([...table].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Keeps the last non-empty catalog. `onChange` fires only when a load produced a different table,
 * so a model that stays unpriced cannot cause a notify -> summary -> reload loop.
 */
export function createPriceLookup(
  list: () => Promise<unknown>,
  log: (message: string) => void,
  onChange: () => void,
  now: () => number = Date.now,
): PriceLookup {
  let table: PriceTable = EMPTY;
  let loading = false;
  let queued = false;
  let lastMissStart = Number.NEGATIVE_INFINITY;
  let failing = false;

  async function load(): Promise<void> {
    loading = true;
    try {
      const loaded = parseCatalog(await withTimeout(list(), LOAD_TIMEOUT_MS));
      failing = false;
      if (loaded.size > 0 && fingerprint(loaded) !== fingerprint(table)) {
        table = loaded;
        onChange();
      }
    } catch (error) {
      if (!failing) log(`failed to load model prices: ${String(error)}`);
      failing = true;
    } finally {
      loading = false;
      if (queued) {
        queued = false;
        void load();
      }
    }
  }

  return {
    table: () => table,
    refresh(reason) {
      if (reason === "miss") {
        if (loading || now() - lastMissStart < MISS_RELOAD_INTERVAL_MS) return;
        lastMissStart = now();
      } else if (loading) {
        queued = true;
        return;
      }
      void load();
    },
  };
}
