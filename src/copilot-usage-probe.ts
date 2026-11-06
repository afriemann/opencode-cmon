export interface ProbeResponse {
  model: { providerID: string; id: string };
  request: Request;
  response: Response;
}

export type ProbeDiagnostic = Record<string, unknown>;

type Endpoint = "chat-completions" | "responses";
type Outcome =
  | "complete"
  | "incomplete"
  | "malformed"
  | "cancelled"
  | "source-error"
  | "observer-error"
  | "response-limit"
  | "event-limit"
  | "timeout"
  | "disposed";
type FieldState = "present" | "invalid" | "absent" | "unknown";
const MAX_SAMPLES = 2;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_DURATION_MS = 30_000;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function at(value: unknown, path: readonly string[]): unknown {
  for (const key of path) value = object(value)?.[key];
  return value;
}

const CHAT_FIELDS = {
  input: ["prompt_tokens"],
  output: ["completion_tokens"],
  total: ["total_tokens"],
  cacheRead: ["prompt_tokens_details", "cached_tokens"],
  reasoning: ["completion_tokens_details", "reasoning_tokens"],
};
const RESPONSE_FIELDS = {
  input: ["input_tokens"],
  output: ["output_tokens"],
  cacheRead: ["input_tokens_details", "cached_tokens"],
  reasoning: ["output_tokens_details", "reasoning_tokens"],
};

// Candidate names are observations only, not a contract for billed units or currency.
const CANDIDATE_FIELDS = {
  cacheWrite: ["cache_write_tokens"],
  billedCost: ["cost"],
  nanoAiu: ["totalNanoAiu"],
};

function classify(
  event: ProbeResponse,
): { endpoint: Endpoint; sse: boolean } | undefined {
  if (
    event.model.providerID !== "github-copilot" ||
    !event.response.body ||
    event.response.bodyUsed ||
    event.response.body.locked
  )
    return;
  const path = new URL(event.request.url).pathname;
  const endpoint = path.endsWith("/chat/completions")
    ? "chat-completions"
    : path.endsWith("/responses")
      ? "responses"
      : undefined;
  const type = event.response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (
    !endpoint ||
    (type !== "application/json" && type !== "text/event-stream")
  )
    return;
  return { endpoint, sse: type === "text/event-stream" };
}

export function createCopilotUsageProbe(
  emit: (diagnostic: ProbeDiagnostic) => void,
): { observe(event: ProbeResponse): void; dispose(): void } {
  const reservations: Record<Endpoint, number> = {
    "chat-completions": 0,
    responses: 0,
  };
  const active = new Set<(outcome: Outcome) => void>();
  let disposed = false;

  function observe(event: ProbeResponse): void {
    if (disposed) return;
    let stop: ((outcome: Outcome) => void) | undefined;
    try {
      const selected = classify(event);
      if (!selected || reservations[selected.endpoint] >= MAX_SAMPLES) return;
      reservations[selected.endpoint]++;
      const { endpoint, sse } = selected;
      const model = /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(event.model.id)
        ? event.model.id
        : undefined;
      let snapshots = 0;
      let usageState: "present" | "invalid" | "absent" = "absent";
      let usage: Record<string, number> = {};
      let fields: Record<string, FieldState> = {};
      let finished = false;
      let received = 0;
      let json = "";
      let eventBytes = new Uint8Array(sse ? MAX_EVENT_BYTES : 0);
      let eventLength = 0;
      let lineLength = 0;
      let previousCR = false;
      let pendingDispatch = false;
      let terminal = false;
      const decoder = new TextDecoder("utf-8", { fatal: true });

      const finish = (outcome: Outcome): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        active.delete(finish);
        json = "";
        eventBytes = new Uint8Array(0);
        const complete = outcome === "complete";
        if (!complete) {
          fields = Object.fromEntries(
            Object.entries(fields).map(([key, state]) => [
              key,
              state === "absent" ? "unknown" : state,
            ]),
          );
        }
        const diagnostic: ProbeDiagnostic = {
          endpoint,
          outcome,
          snapshots,
          usageState:
            !complete && usageState === "absent" ? "unknown" : usageState,
          usage,
          fields,
          ...(model ? { model } : {}),
        };
        try {
          emit(diagnostic);
        } catch {
          /* The sink cannot change provider delivery. */
        }
        usage = {};
        fields = {};
      };
      stop = finish;
      active.add(finish);
      const timer = setTimeout(() => finish("timeout"), MAX_DURATION_MS);
      timer.unref?.();

      const project = (payload: unknown): void => {
        const root = object(payload);
        const value = root?.usage ?? object(root?.response)?.usage;
        if (value === undefined || value === null) return;
        snapshots++;
        usageState = object(value) ? "present" : "invalid";
        usage = {};
        fields = {};
        const paths = {
          ...(endpoint === "chat-completions" ? CHAT_FIELDS : RESPONSE_FIELDS),
          ...CANDIDATE_FIELDS,
        };
        for (const [key, path] of Object.entries(paths)) {
          const number = at(value, path);
          if (number === undefined || number === null) fields[key] = "absent";
          else if (
            typeof number === "number" &&
            Number.isFinite(number) &&
            number >= 0
          ) {
            fields[key] = "present";
            usage[key] = number;
          } else fields[key] = "invalid";
        }
      };

      const dispatch = (): void => {
        const text = decoder.decode(eventBytes.subarray(0, eventLength));
        const data = text
          .split(/\r\n|\r|\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        eventLength = 0;
        if (!data) return;
        if (data === "[DONE]" && endpoint === "chat-completions") {
          terminal = true;
          return;
        }
        const payload: unknown = JSON.parse(data);
        const type = object(payload)?.type;
        if (
          endpoint === "responses" &&
          (type === "response.completed" || type === "response.incomplete")
        )
          terminal = true;
        project(payload);
      };

      const inspect = (chunk: Uint8Array): void => {
        if (finished) return;
        if (chunk.byteLength > MAX_RESPONSE_BYTES - received) {
          finish("response-limit");
          return;
        }
        received += chunk.byteLength;
        if (!sse) {
          json += decoder.decode(chunk, { stream: true });
          return;
        }
        for (const byte of chunk) {
          if (previousCR) {
            previousCR = false;
            if (byte === 10) {
              if (eventLength === MAX_EVENT_BYTES) {
                finish("event-limit");
                return;
              }
              eventBytes[eventLength++] = byte;
              if (pendingDispatch) {
                pendingDispatch = false;
                dispatch();
              }
              continue;
            }
            if (pendingDispatch) {
              pendingDispatch = false;
              dispatch();
            }
          }
          if (eventLength === MAX_EVENT_BYTES) {
            finish("event-limit");
            return;
          }
          eventBytes[eventLength++] = byte;
          if (byte === 13 || byte === 10) {
            if (lineLength === 0) {
              if (byte === 13) pendingDispatch = true;
              else dispatch();
            }
            lineLength = 0;
            previousCR = byte === 13;
          } else {
            lineLength++;
            previousCR = false;
          }
        }
      };

      const original = event.response;
      const acquireReader = () => original.body!.getReader();
      let reader: ReturnType<typeof acquireReader> | undefined;
      const stream = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            let result: Awaited<ReturnType<NonNullable<typeof reader>["read"]>>;
            try {
              reader ??= acquireReader();
              result = await reader.read();
            } catch (error) {
              finish("source-error");
              reader?.releaseLock();
              controller.error(error);
              return;
            }
            if (result.done) {
              if (!finished) {
                try {
                  if (!sse) {
                    json += decoder.decode();
                    project(JSON.parse(json));
                    finish("complete");
                  } else {
                    if (pendingDispatch) dispatch();
                    finish(
                      eventLength > 0 || !terminal ? "incomplete" : "complete",
                    );
                  }
                } catch {
                  finish("malformed");
                }
              }
              reader.releaseLock();
              controller.close();
            } else {
              try {
                inspect(result.value);
              } catch {
                finish("malformed");
              }
              controller.enqueue(result.value);
            }
          },
          async cancel(reason) {
            finish("cancelled");
            try {
              if (reader) await reader.cancel(reason);
              else await original.body!.cancel(reason);
            } finally {
              reader?.releaseLock();
            }
          },
        },
        { highWaterMark: 0 },
      );
      try {
        event.response = new Response(stream, {
          status: original.status,
          statusText: original.statusText,
          headers: original.headers,
        });
      } catch {
        finish("observer-error");
      }
    } catch {
      stop?.("observer-error");
    }
  }

  return {
    observe,
    dispose() {
      disposed = true;
      for (const finish of active) finish("disposed");
    },
  };
}
