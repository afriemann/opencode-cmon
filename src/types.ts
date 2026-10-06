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
  /** UTC epoch milliseconds. */
  readonly createdAt: number;
}

export interface AgentTotal {
  readonly agent: string;
  readonly micros: number;
}

export interface ModelTotal {
  /** `providerId/modelId`. */
  readonly model: string;
  readonly micros: number;
}

export interface Summary {
  readonly revision: number;
  readonly totalMicros: number;
  readonly agents: readonly AgentTotal[];
  readonly models: readonly ModelTotal[];
  /** False when some row that could carry a cache-write cost could not be priced. */
  readonly complete: boolean;
}

/** A row that may carry a cache-write cost, priced in code at read time. */
export interface Candidate {
  readonly agent: string;
  readonly providerId: string;
  readonly modelId: string;
  /** Null when the row's token counts are unknown. */
  readonly tokens: TokenCounts | null;
}
