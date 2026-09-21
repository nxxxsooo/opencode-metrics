import { Rpc } from "@opencode-ai/plugin/rpc"

export const ModelIdentityRpc = Rpc.define({
  id: "opencode-metrics-model",
  methods: {
    get: {
      errors: {},
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          requested: { type: ["string", "null"] },
          reported: { type: ["string", "null"] },
          source: { type: ["string", "null"] },
          observedAt: { type: "number" },
          previous: { type: "boolean" },
          transport: { type: "string", enum: ["http", "websocket"] },
        },
        required: ["requested", "reported", "source", "observedAt", "previous"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
