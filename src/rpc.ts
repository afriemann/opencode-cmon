import { Rpc } from "@opencode/plugin/rpc";

/**
 * Read access for the TUI process: one pull method over a caller-supplied half-open range, and a
 * change notification carrying only the revision so the TUI re-pulls.
 */
export const CostRpc = Rpc.define({
  id: "cmon",
  methods: {
    summary: {
      input: {
        type: "object",
        properties: { from: { type: "number" }, to: { type: "number" } },
        required: ["from", "to"],
      },
      output: {
        type: "object",
        properties: {
          revision: { type: "number" },
          totalMicros: { type: "number" },
          agents: {
            type: "array",
            items: {
              type: "object",
              properties: {
                agent: { type: "string" },
                micros: { type: "number" },
              },
              required: ["agent", "micros"],
            },
          },
          models: {
            type: "array",
            items: {
              type: "object",
              properties: {
                model: { type: "string" },
                micros: { type: "number" },
              },
              required: ["model", "micros"],
            },
          },
          providers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                provider: { type: "string" },
                micros: { type: "number" },
              },
              required: ["provider", "micros"],
            },
          },
          complete: { type: "boolean" },
          stalls: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                steps: { type: "number" },
                wastedMicros: { type: "number" },
                startedAt: { type: "number" },
              },
              required: ["sessionId", "steps", "wastedMicros", "startedAt"],
            },
          },
        },
        required: ["revision", "totalMicros", "agents", "complete"],
      },
    },
  },
  events: {
    cacheStall: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          modelId: { type: "string" },
          steps: { type: "number" },
          wastedMicros: { type: "number" },
          startedAt: { type: "number" },
        },
        required: ["sessionID", "steps", "wastedMicros", "startedAt"],
      },
    },
    changed: {
      schema: {
        type: "object",
        properties: { revision: { type: "number" } },
        required: ["revision"],
      },
    },
  },
} as const);
