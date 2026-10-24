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
          // Additive token view. Optional so a reply from an older server stays valid.
          tokens: {
            type: "object",
            properties: {
              totalTokens: {
                anyOf: [{ type: "number" }, { type: "null" }],
              },
              complete: { type: "boolean" },
              agents: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    agent: { type: "string" },
                    totalTokens: {
                      anyOf: [{ type: "number" }, { type: "null" }],
                    },
                    complete: { type: "boolean" },
                  },
                  required: ["agent", "totalTokens", "complete"],
                },
              },
              models: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    model: { type: "string" },
                    totalTokens: {
                      anyOf: [{ type: "number" }, { type: "null" }],
                    },
                    complete: { type: "boolean" },
                  },
                  required: ["model", "totalTokens", "complete"],
                },
              },
              providers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    provider: { type: "string" },
                    totalTokens: {
                      anyOf: [{ type: "number" }, { type: "null" }],
                    },
                    complete: { type: "boolean" },
                  },
                  required: ["provider", "totalTokens", "complete"],
                },
              },
            },
            required: [
              "totalTokens",
              "complete",
              "agents",
              "models",
              "providers",
            ],
          },
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
