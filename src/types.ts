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
  readonly costMicros: number;
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
