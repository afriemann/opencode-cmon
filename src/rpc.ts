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
          complete: { type: "boolean" },
        },
        required: ["revision", "totalMicros", "agents", "complete"],
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { revision: { type: "number" } },
        required: ["revision"],
      },
    },
  },
} as const);
