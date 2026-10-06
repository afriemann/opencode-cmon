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
  /** Cache-write cost opencode prices at zero but GitHub bills; added to `costMicros` for display. */
  readonly cacheWriteExtraMicros: number;
  /** UTC epoch milliseconds. */
  readonly createdAt: number;
}

export interface AgentTotal {
  readonly agent: string;
  readonly micros: number;
}

export interface Summary {
  readonly revision: number;
  readonly totalMicros: number;
  readonly agents: readonly AgentTotal[];
}
