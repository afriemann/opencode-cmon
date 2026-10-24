import type { TokenCounts } from "./pricing";

/** Attribution used when a row's agent or model cannot be determined. */
export const UNKNOWN = "unknown";
/** Agent for a compaction in a session with no prior step. */
export const COMPACTION_AGENT = "compaction";

export type EntryKind = "step" | "compaction";

export interface CostRow {
  readonly id: string;
  readonly sessionId: string;
  readonly parentSessionId: string | null;
  readonly agent: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly kind: EntryKind;
  readonly failed: boolean;
  /** opencode's own cost for the step. */
  readonly costMicros: number;
  /** Token counts for read-time pricing; null when the event carried no token data. */
  readonly tokens: TokenCounts | null;
  /** Output tokens; null when unknown. */
  readonly outputTokens: number | null;
  /** Reasoning tokens; null when unknown. */
  readonly reasoningTokens: number | null;
  /** Finish reason of a completed step; null for failed steps, compactions and unknown. */
  readonly finish: string | null;
  /** Project directory the cost was incurred in; null when unknown. */
  readonly directory: string | null;
  /** UTC epoch milliseconds. */
  readonly createdAt: number;
}

export interface AgentTotal {
  readonly agent: string;
  readonly micros: number;
}

export interface ModelTotal {
  /** The model id, merged across providers. */
  readonly model: string;
  readonly micros: number;
}

export interface ProviderTotal {
  readonly provider: string;
  readonly micros: number;
}

export interface Summary {
  readonly revision: number;
  readonly totalMicros: number;
  readonly agents: readonly AgentTotal[];
  readonly models: readonly ModelTotal[];
  readonly providers: readonly ProviderTotal[];
  /** False when some row that could carry a cache-write cost could not be priced. */
  readonly complete: boolean;
}

/**
 * The five stored token categories. They are disjoint, so a complete row's usage is their sum.
 * `null` means the ledger does not know that count; a known zero is not the same as unknown.
 */
export interface TokenComponents {
  readonly input: number | null;
  readonly cacheRead: number | null;
  readonly cacheWrite: number | null;
  readonly output: number | null;
  readonly reasoning: number | null;
}

/** One retained row's lossless token counts and attribution, independent of pricing. */
export interface TokenUsageRow extends TokenComponents {
  readonly agent: string;
  readonly modelId: string;
  readonly providerId: string;
}

export interface TokenAgentTotal {
  readonly agent: string;
  /** Known subtotal for the group, or null when none of its counts are known. */
  readonly totalTokens: number | null;
  /** True only when every count of every included row is known. */
  readonly complete: boolean;
}

export interface TokenModelTotal {
  /** The model id, merged across providers. */
  readonly model: string;
  readonly totalTokens: number | null;
  readonly complete: boolean;
}

export interface TokenProviderTotal {
  readonly provider: string;
  readonly totalTokens: number | null;
  readonly complete: boolean;
}

/** Read-only token projection carried alongside the unchanged dollar summary. */
export interface TokenSummary {
  readonly totalTokens: number | null;
  readonly complete: boolean;
  readonly agents: readonly TokenAgentTotal[];
  readonly models: readonly TokenModelTotal[];
  readonly providers: readonly TokenProviderTotal[];
}

/**
 * A `summary` reply. The additive token view is optional so a reply from an older server, and an
 * older client that ignores it, both stay valid.
 */
export interface SummaryReply extends Summary {
  readonly tokens?: TokenSummary;
}

/** A row that may carry a cache-write cost, priced in code at read time. */
export interface Candidate {
  readonly agent: string;
  readonly providerId: string;
  readonly modelId: string;
  /** Null when the row's token counts are unknown. */
  readonly tokens: TokenCounts | null;
  /** opencode's own cost for the step; tells whether it already includes cache writes. */
  readonly costMicros: number;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
}
