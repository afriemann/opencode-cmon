import { usdToMicros } from "./money";
import { detailTokens, tokenCounts } from "./pricing";
import { COMPACTION_AGENT, UNKNOWN, type CostRow } from "./types";

export interface CostEvent {
  readonly id: string;
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
  /** The event envelope's location, when the host supplies one. */
  readonly location?: { readonly directory?: string };
}

export interface SessionInfo {
  readonly parentId: string | null;
  readonly directory: string | null;
}

export interface RecorderDeps {
  /** Parent session ID (null for a top-level session) and directory (null when unknown). */
  readonly resolveSession: (sessionID: string) => Promise<SessionInfo>;
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
  const sessions = new Map<string, SessionInfo>();

  async function sessionOf(sessionID: string): Promise<SessionInfo> {
    const cached = sessions.get(sessionID);
    if (cached) return cached;
    try {
      const info = await deps.resolveSession(sessionID);
      sessions.set(sessionID, info);
      return info;
    } catch {
      return { parentId: null, directory: null };
    }
  }

  /** Output and reasoning counts; null (unknown) when the event carries no token object. */
  function outputCounts(tokens: unknown): {
    outputTokens: number | null;
    reasoningTokens: number | null;
  } {
    if (tokens === undefined || tokens === null)
      return { outputTokens: null, reasoningTokens: null };
    const { output, reasoning } = detailTokens(tokens);
    return { outputTokens: output, reasoningTokens: reasoning };
  }

  async function stepRow(
    data: Readonly<Record<string, unknown>>,
    failed: boolean,
    location: CostEvent["location"],
  ): Promise<CostRow | null> {
    const sessionId = str(data.sessionID);
    const id = str(data.assistantMessageID);
    const cost = num(data.cost);
    if (!sessionId || !id || cost === undefined) return null;
    if (data.tokens === undefined || data.tokens === null) return null;
    const own = steps.get(id);
    steps.delete(id);
    const state = own ?? lastStep.get(sessionId);
    const session = await sessionOf(sessionId);
    return {
      id,
      sessionId,
      parentSessionId: session.parentId,
      agent: state?.agent ?? UNKNOWN,
      providerId: state?.providerId ?? UNKNOWN,
      modelId: state?.modelId ?? UNKNOWN,
      kind: "step",
      failed,
      costMicros: usdToMicros(cost),
      tokens: tokenCounts(data.tokens),
      ...outputCounts(data.tokens),
      // A failed step's finish is always an error variant that `failed` already covers.
      finish: failed ? null : (str(data.finish) ?? null),
      directory: str(location?.directory) ?? session.directory,
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
    const session = await sessionOf(sessionId);
    return {
      id,
      sessionId,
      parentSessionId: session.parentId,
      agent: last?.agent ?? COMPACTION_AGENT,
      providerId: model?.providerId ?? UNKNOWN,
      modelId: model?.modelId ?? UNKNOWN,
      kind: "compaction",
      failed,
      costMicros: usdToMicros(cost),
      // Null means unknown: the startup fill (or a redelivery) resolves it.
      tokens: data.tokens == null ? null : tokenCounts(data.tokens),
      ...outputCounts(data.tokens),
      finish: null,
      directory: str(event.location?.directory) ?? session.directory,
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
          return stepRow(data, false, event.location);
        case "session.step.failed":
          return stepRow(data, true, event.location);
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
