import { describe, expect, jest, test } from "bun:test";
import {
  createCopilotUsageProbe,
  type ProbeDiagnostic,
  type ProbeResponse,
} from "./copilot-usage-probe";

const encoder = new TextEncoder();
const model = { providerID: "github-copilot", id: "gpt-6.1-sol" };
const chatUsage = {
  prompt_tokens: 40,
  completion_tokens: 0,
  total_tokens: 40,
  prompt_tokens_details: { cached_tokens: 25 },
  completion_tokens_details: { reasoning_tokens: 0 },
};
const responseUsage = {
  input_tokens: 40,
  input_tokens_details: { cached_tokens: 25 },
  output_tokens: 8,
  output_tokens_details: { reasoning_tokens: 3 },
};

function fixture(
  body: BodyInit | null,
  path = "/chat/completions",
  type = "application/json",
): ProbeResponse {
  return {
    model,
    request: new Request(`https://api.example.com${path}`),
    response: new Response(body, {
      status: 201,
      headers: { "content-type": type, "x-test": "unchanged" },
    }),
  };
}

function setup() {
  const diagnostics: ProbeDiagnostic[] = [];
  const probe = createCopilotUsageProbe((d) => diagnostics.push(d));
  return { probe, diagnostics };
}

async function consume(event: ProbeResponse): Promise<string> {
  return event.response.text();
}
function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// Fixtures follow the v2.2.5 Copilot adapters' usage schemas and responseFinishedChunkSchema.
// spec: openspec/specs/cost-recording/spec.md
describe("bounded Copilot usage observation", () => {
  test("Forwarding follows consumer demand", async () => {
    const { probe, diagnostics } = setup();
    const chunks = [
      encoder.encode('{"usage":'),
      encoder.encode(`${JSON.stringify(chatUsage)}}`),
    ];
    let reads = 0;
    const event = fixture(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            reads++;
            if (chunks.length) controller.enqueue(chunks.shift()!);
            else controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
    );
    probe.observe(event);
    await Promise.resolve();
    expect(reads).toBe(0);
    expect(diagnostics).toEqual([]);
    expect(event.response.status).toBe(201);
    expect(event.response.headers.get("x-test")).toBe("unchanged");
    const reader = event.response.body!.getReader();
    expect((await reader.read()).value).toEqual(encoder.encode('{"usage":'));
    await Promise.resolve();
    expect(reads).toBe(1);
    expect(diagnostics).toEqual([]);
    await reader.read();
    await reader.read();
    expect(diagnostics.map((d) => d.outcome)).toEqual(["complete"]);
    probe.dispose();
  });

  test("Cancellation and source failures propagate", async () => {
    const { probe, diagnostics } = setup();
    const reason = { cancelled: true };
    let cancelled: unknown;
    const event = fixture(
      new ReadableStream(
        {
          cancel(r) {
            cancelled = r;
          },
        },
        { highWaterMark: 0 },
      ),
    );
    probe.observe(event);
    await event.response.body!.cancel(reason);
    expect(cancelled).toBe(reason);
    const failure = new Error("private source error");
    const failed = fixture(
      new ReadableStream(
        {
          pull(c) {
            c.error(failure);
          },
        },
        { highWaterMark: 0 },
      ),
    );
    probe.observe(failed);
    await expect(consume(failed)).rejects.toBe(failure);
    expect(diagnostics.map((d) => d.outcome)).toEqual([
      "cancelled",
      "source-error",
    ]);
    probe.dispose();
    const pending = setup();
    let started!: () => void;
    const pulling = new Promise<void>((resolve) => (started = resolve));
    let pendingReason: unknown;
    const waiting = fixture(
      new ReadableStream<Uint8Array>(
        {
          pull() {
            started();
          },
          cancel(value) {
            pendingReason = value;
          },
        },
        { highWaterMark: 0 },
      ),
    );
    pending.probe.observe(waiting);
    const consumer = waiting.response.body!.getReader();
    const read = consumer.read();
    await pulling;
    await consumer.cancel(reason);
    expect(await read).toEqual({ value: undefined, done: true });
    expect(pendingReason).toBe(reason);
    expect(pending.diagnostics.map((d) => d.outcome)).toEqual(["cancelled"]);
    pending.probe.dispose();
  });

  test("Concurrent samples consume reservations once", async () => {
    const { probe, diagnostics } = setup();
    const events = Array.from({ length: 3 }, () => fixture("bad json"));
    const third = events[2]!.response;
    for (const event of events) probe.observe(event);
    expect(events[2]!.response).toBe(third);
    await Promise.all(events.map(consume));
    const responses = Array.from({ length: 3 }, () =>
      fixture(JSON.stringify({ usage: responseUsage }), "/responses"),
    );
    for (const event of responses) probe.observe(event);
    await Promise.all(responses.map(consume));
    expect(diagnostics.map((d) => d.endpoint)).toEqual([
      "chat-completions",
      "chat-completions",
      "responses",
      "responses",
    ]);
    probe.dispose();
  });

  test("Limits and disposal stop inspection only", async () => {
    jest.useFakeTimers();
    try {
      for (const [body, type, outcome] of [
        ["x".repeat(1024 * 1024 + 1), "application/json", "response-limit"],
        [
          "data: " + "x".repeat(64 * 1024 + 1),
          "text/event-stream",
          "event-limit",
        ],
      ] as const) {
        const { probe, diagnostics } = setup();
        const event = fixture(body, "/responses", type);
        probe.observe(event);
        expect(await consume(event)).toBe(body);
        expect(diagnostics.map((d) => d.outcome)).toEqual([outcome]);
        probe.dispose();
      }
      for (const outcome of ["timeout", "disposed"] as const) {
        const { probe, diagnostics } = setup();
        const event = fixture(JSON.stringify({ usage: chatUsage }));
        probe.observe(event);
        if (outcome === "timeout") jest.advanceTimersByTime(30_000);
        else probe.dispose();
        expect(diagnostics.map((d) => d.outcome)).toEqual([outcome]);
        expect(await consume(event)).toContain('"usage"');
        expect(diagnostics).toHaveLength(1);
        probe.dispose();
      }
      for (const outcome of ["timeout", "disposed"] as const) {
        for (const type of ["application/json", "text/event-stream"]) {
          const { probe, diagnostics } = setup();
          const parts =
            type === "application/json"
              ? ['{"usage":', `${JSON.stringify(chatUsage)}}`]
              : [
                  sse({ usage: { prompt_tokens: 40 } }) + "data: ",
                  "[DONE]\n\n",
                ];
          let controller!: ReadableStreamDefaultController<Uint8Array>;
          let pulls = 0;
          let notify!: () => void;
          const waiting = new Promise<void>((resolve) => (notify = resolve));
          const event = fixture(
            new ReadableStream<Uint8Array>(
              {
                start(value) {
                  controller = value;
                },
                pull(value) {
                  if (pulls++ === 0) value.enqueue(encoder.encode(parts[0]!));
                  else notify();
                },
              },
              { highWaterMark: 0 },
            ),
            "/chat/completions",
            type,
          );
          probe.observe(event);
          const consumer = event.response.body!.getReader();
          await consumer.read();
          const read = consumer.read();
          await waiting;
          if (outcome === "timeout") jest.advanceTimersByTime(30_000);
          else probe.dispose();
          controller.enqueue(encoder.encode(parts[1]!));
          controller.close();
          expect((await read).value).toEqual(encoder.encode(parts[1]!));
          expect((await consumer.read()).done).toBe(true);
          expect(diagnostics.map((d) => d.outcome)).toEqual([outcome]);
          probe.dispose();
        }
      }
      const oversizedEvent = ":\r\n".repeat(22_000) + "\r\n";
      for (const fragmented of [false, true]) {
        const { probe, diagnostics } = setup();
        const chunks = [oversizedEvent.slice(0, 2), oversizedEvent.slice(2)];
        const body = fragmented
          ? new ReadableStream<Uint8Array>(
              {
                pull(controller) {
                  if (chunks.length)
                    controller.enqueue(encoder.encode(chunks.shift()!));
                  else controller.close();
                },
              },
              { highWaterMark: 0 },
            )
          : oversizedEvent;
        const event = fixture(body, "/responses", "text/event-stream");
        probe.observe(event);
        expect(await consume(event)).toBe(oversizedEvent);
        expect(diagnostics.map((d) => d.outcome)).toEqual(["event-limit"]);
        probe.dispose();
      }
    } finally {
      jest.useRealTimers();
    }
  });

  test("Standard usage is projected without summing snapshots", async () => {
    const { probe, diagnostics } = setup();
    const chat = fixture(
      sse({ usage: { prompt_tokens: 1 } }) +
        sse({ usage: chatUsage }) +
        "data: [DONE]\n\n",
      "/chat/completions",
      "text/event-stream",
    );
    probe.observe(chat);
    await consume(chat);
    const responses = fixture(
      sse({ type: "response.completed", response: { usage: responseUsage } }),
      "/responses",
      "text/event-stream",
    );
    probe.observe(responses);
    await consume(responses);
    expect(
      diagnostics.map((d) => ({ snapshots: d.snapshots, usage: d.usage })),
    ).toEqual([
      {
        snapshots: 2,
        usage: { input: 40, output: 0, total: 40, cacheRead: 25, reasoning: 0 },
      },
      {
        snapshots: 1,
        usage: { input: 40, output: 8, cacheRead: 25, reasoning: 3 },
      },
    ]);
    probe.dispose();
    const split = setup();
    const bytes = encoder.encode(
      (
        sse({ choices: [{ content: "€" }], usage: chatUsage }) +
        "data: [DONE]\n\n"
      ).replaceAll("\n", "\r\n"),
    );
    let offset = 0;
    const fragmented = fixture(
      new ReadableStream<Uint8Array>(
        {
          pull(c) {
            if (offset < bytes.length) c.enqueue(bytes.slice(offset, ++offset));
            else c.close();
          },
        },
        { highWaterMark: 0 },
      ),
      "/chat/completions",
      "text/event-stream",
    );
    split.probe.observe(fragmented);
    await consume(fragmented);
    expect(split.diagnostics.map((d) => d.outcome)).toEqual(["complete"]);
    expect(split.diagnostics[0]!.usage).toEqual({
      input: 40,
      output: 0,
      total: 40,
      cacheRead: 25,
      reasoning: 0,
    });
    split.probe.dispose();
  });

  test("Missing malformed and incomplete usage remain distinguishable", async () => {
    const results: ProbeDiagnostic[] = [];
    for (const [body, type] of [
      ["{}", "application/json"],
      ['{"usage":{"prompt_tokens":-1}}', "application/json"],
      ["data: nope\n\n", "text/event-stream"],
      ['data: {"usage":', "text/event-stream"],
      [
        sse({ usage: { prompt_tokens: 40 } }) + 'data: {"usage":',
        "text/event-stream",
      ],
    ]) {
      const { probe, diagnostics } = setup();
      const event = fixture(body!, "/chat/completions", type!);
      probe.observe(event);
      await consume(event);
      results.push(...diagnostics);
      probe.dispose();
    }
    expect(
      results.map((d) => ({ outcome: d.outcome, usageState: d.usageState })),
    ).toEqual([
      { outcome: "complete", usageState: "absent" },
      { outcome: "complete", usageState: "present" },
      { outcome: "malformed", usageState: "unknown" },
      { outcome: "incomplete", usageState: "unknown" },
      { outcome: "incomplete", usageState: "present" },
    ]);
    expect(results[1]!.fields).toMatchObject({
      input: "invalid",
      cacheRead: "absent",
    });
    expect(results[4]!.fields).toMatchObject({
      input: "present",
      cacheRead: "unknown",
      billedCost: "unknown",
    });
    expect(results[4]!.usage).toEqual({ input: 40 });
  });

  test("Sensitive and unknown content is excluded", async () => {
    const { probe, diagnostics } = setup();
    const privateText = "private-person@example.com";
    const event = fixture(
      JSON.stringify({
        id: privateText,
        [privateText]: privateText,
        choices: [{ content: privateText }],
        usage: { ...chatUsage, [privateText]: 99 },
      }),
    );
    event.model = { ...model, id: privateText };
    event.request = new Request(
      `https://api.example.com/chat/completions?secret=${privateText}`,
      { headers: { authorization: privateText } },
    );
    probe.observe(event);
    await consume(event);
    expect(diagnostics).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).not.toContain(privateText);
    expect(diagnostics[0]!.model).toBeUndefined();
    expect(Object.keys(diagnostics[0]!).sort()).toEqual([
      "endpoint",
      "fields",
      "outcome",
      "snapshots",
      "usage",
      "usageState",
    ]);
    probe.dispose();
  });

  test("Observation and sink failures leave delivery usable", async () => {
    let calls = 0;
    const probe = createCopilotUsageProbe(() => {
      calls++;
      throw new Error("private sink failure");
    });
    for (const body of [JSON.stringify({ usage: chatUsage }), "invalid JSON"]) {
      const event = fixture(body);
      probe.observe(event);
      expect(await consume(event)).toBe(body);
    }
    expect(calls).toBe(2);
    probe.dispose();
    const failed = setup();
    const event = fixture(JSON.stringify({ usage: chatUsage }));
    const original = event.response;
    Object.defineProperty(original, "status", {
      get() {
        throw new Error("private response metadata");
      },
    });
    failed.probe.observe(event);
    expect(event.response).toBe(original);
    expect(await consume(event)).toContain('"usage"');
    expect(failed.diagnostics.map((d) => d.outcome)).toEqual([
      "observer-error",
    ]);
    failed.probe.dispose();
  });
});
