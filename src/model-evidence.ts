import { INVALID_SPAN_CONTEXT, trace } from "@opentelemetry/api"
import { ATTR_GEN_AI_REQUEST_MODEL, ATTR_GEN_AI_RESPONSE_MODEL } from "@opentelemetry/semantic-conventions/incubating"
import { LLMSpan } from "@traceloop/node-server-sdk"
import { modelIdentifier, type ModelIdentity } from "./model-identity"

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
  return {
    identity,
    request(model: string | null) {
      identity.requested = null
      if (model !== null) reporter.reportRequest({ model, messages: [] })
    },
    response(model: string, source: string) {
      reporter.reportResponse({ model })
      identity.source = identity.reported ? source : null
    },
  }
}

export type ModelEvidence = ReturnType<typeof createModelEvidence>
