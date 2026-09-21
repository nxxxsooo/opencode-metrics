import { INVALID_SPAN_CONTEXT, trace } from "@opentelemetry/api"
import { ATTR_GEN_AI_REQUEST_MODEL, ATTR_GEN_AI_RESPONSE_MODEL } from "@opentelemetry/semantic-conventions/incubating"
import { LLMSpan } from "@traceloop/node-server-sdk"
import { modelIdentifier, type ModelIdentity, type ModelTransport } from "./model-identity"

/** Where a requested-model value came from; higher fidelity wins. */
export type RequestOrigin = ModelTransport | "configured"
const originRank: Record<RequestOrigin, number> = { configured: 0, websocket: 1, http: 2 }

/** OpenLLMetry's manual reporting API, backed by a local, model-only attribute sink. */
export function createModelEvidence(observedAt = Date.now()) {
  const identity: ModelIdentity = { requested: null, reported: null, source: null, observedAt }
  // An inert span supplies the OTel interface without registering a global tracer,
  // auto-instrumentation or exporter in OpenCode's shared server process.
  const sink = trace.wrapSpanContext(INVALID_SPAN_CONTEXT)
  sink.setAttribute = (key, value) => {
    if (key === ATTR_GEN_AI_REQUEST_MODEL) identity.requested = modelIdentifier(value)
    if (key === ATTR_GEN_AI_RESPONSE_MODEL) identity.reported = modelIdentifier(value)
    return sink
  }
  sink.setAttributes = (attributes) => {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) sink.setAttribute(key, value)
    }
    return sink
  }
  const reporter = new LLMSpan(sink)
  let requestOrigin: RequestOrigin | null = null
  return {
    identity,
    request(model: string | null, origin: RequestOrigin = "http") {
      const rank = originRank[origin]
      // A lower-fidelity source never overwrites or clears captured evidence.
      if (rank < (requestOrigin === null ? -1 : originRank[requestOrigin])) return
      requestOrigin = origin
      if (model === null) { identity.requested = null; return }
      reporter.reportRequest({ model, messages: [] })
    },
    response(model: string, source: string, transport: ModelTransport = "http") {
      reporter.reportResponse({ model })
      identity.source = identity.reported ? source : null
      // Only WebSocket records carry the marker; HTTP snapshots keep their historical shape.
      if (identity.reported && transport === "websocket") identity.transport = "websocket"
    },
  }
}

export type ModelEvidence = ReturnType<typeof createModelEvidence>
