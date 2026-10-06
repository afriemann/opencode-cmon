import { usdToMicros } from "./money";
import { tokenCounts } from "./pricing";
import { COMPACTION_AGENT, UNKNOWN, type CostRow } from "./types";

export interface CostEvent {
  readonly id: string;
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface RecorderDeps {
  /** Returns the parent session ID, or null for a top-level session. */
  readonly resolveParent: (sessionID: string) => Promise<string | null>;
  readonly now: () => number;
}

export interface Recorder {
  /** Updates internal state and returns the row to persist, or null when the event costs nothing. */
  handle(event: CostEvent): Promise<CostRow | null>;
}

interface ModelRef {
  readonly providerId: string;
  readonly modelId: string;
}

interface StepState extends ModelRef {
  readonly agent: string;
  readonly started: number;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function modelRef(value: unknown): ModelRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { providerID, id } = value as Record<string, unknown>;
  const providerId = str(providerID);
  const modelId = str(id);
  return providerId && modelId ? { providerId, modelId } : undefined;
}

/** Mirrors opencode's `SessionMessage.ID.fromEvent`. */
function messageIdFromEvent(eventId: string): string {
  return eventId.replace(/^evt_/, "msg_");
}

export function createRecorder(deps: RecorderDeps): Recorder {
  const steps = new Map<string, StepState>();
  const lastStep = new Map<string, StepState>();
  const compactions = new Map<string, string>();
  const parents = new Map<string, string | null>();

  async function parentOf(sessionID: string): Promise<string | null> {
    if (parents.has(sessionID)) return parents.get(sessionID) ?? null;
    try {
      const parent = await deps.resolveParent(sessionID);
      parents.set(sessionID, parent);
      return parent;
    } catch {
      return null;
    }
  }

  async function stepRow(
    data: Readonly<Record<string, unknown>>,
    failed: boolean,
  ): Promise<CostRow | null> {
    const sessionId = str(data.sessionID);
    const id = str(data.assistantMessageID);
    const cost = num(data.cost);
    if (!sessionId || !id || cost === undefined) return null;
    if (data.tokens === undefined || data.tokens === null) return null;
    const own = steps.get(id);
    steps.delete(id);
    const state = own ?? lastStep.get(sessionId);
    return {
      id,
      sessionId,
      parentSessionId: await parentOf(sessionId),
      agent: state?.agent ?? UNKNOWN,
      providerId: state?.providerId ?? UNKNOWN,
      modelId: state?.modelId ?? UNKNOWN,
      kind: "step",
      failed,
      costMicros: usdToMicros(cost),
      tokens: tokenCounts(data.tokens),
      createdAt: own?.started ?? deps.now(),
    };
  }

  async function compactionRow(
    event: CostEvent,
    failed: boolean,
  ): Promise<CostRow | null> {
    const data = event.data;
    const sessionId = str(data.sessionID);
    const cost = num(data.cost);
    if (!sessionId || cost === undefined) return null;
    if (failed && (data.tokens === undefined || data.tokens === null))
      return null;
    const id =
      str(data.inputID) ??
      compactions.get(sessionId) ??
      messageIdFromEvent(event.id);
    compactions.delete(sessionId);
    const last = lastStep.get(sessionId);
    const model = modelRef(data.model) ?? last;
    return {
      id,
      sessionId,
      parentSessionId: await parentOf(sessionId),
      agent: last?.agent ?? COMPACTION_AGENT,
      providerId: model?.providerId ?? UNKNOWN,
      modelId: model?.modelId ?? UNKNOWN,
      kind: "compaction",
      failed,
      costMicros: usdToMicros(cost),
      // Null means unknown: the startup fill (or a redelivery) resolves it.
      tokens: data.tokens == null ? null : tokenCounts(data.tokens),
      createdAt: deps.now(),
    };
  }

  return {
    async handle(event) {
      const data = event.data;
      switch (event.type) {
        case "session.step.started": {
          const id = str(data.assistantMessageID);
          const sessionId = str(data.sessionID);
          const agent = str(data.agent);
          const model = modelRef(data.model);
          if (!id || !sessionId || !agent || !model) return null;
          const state: StepState = {
            agent,
            ...model,
            started: num(data.started) ?? deps.now(),
          };
          steps.set(id, state);
          lastStep.set(sessionId, state);
          return null;
        }
        case "session.step.ended":
          return stepRow(data, false);
        case "session.step.failed":
          return stepRow(data, true);
        case "session.compaction.started": {
          const sessionId = str(data.sessionID);
          if (sessionId)
            compactions.set(
              sessionId,
              str(data.inputID) ?? messageIdFromEvent(event.id),
            );
          return null;
        }
        case "session.compaction.ended":
          return compactionRow(event, false);
        case "session.compaction.failed":
          return compactionRow(event, true);
        default:
          return null;
      }
    },
  };
}
