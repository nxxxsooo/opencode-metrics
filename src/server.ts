import { Plugin } from "@opencode-ai/plugin"
import { createModelParser, modelIdentifier, readRequestModel, type ModelIdentity } from "./model-identity"
import { ModelIdentityRpc } from "./model-identity-rpc"

export default Plugin.define({
  id: "opencode-metrics-model",
  async setup(context) {
    const records = new Map<string, ModelIdentity>()
    const requests = new WeakMap<Request, ModelIdentity>()
    const lastReported = new Map<string, ModelIdentity>()
    let disposed = false
    const rpc = await context.rpc.register(ModelIdentityRpc, {
      get: async (input) => {
        const sessionID = (input as { sessionID: string }).sessionID
        const current = records.get(sessionID)
        if (current?.reported) return { ...current, previous: false }
        let last = lastReported.get(sessionID)
        if (!last) {
          try {
            const saved = await context.storage.get(`model/${sessionID}`) as ModelIdentity | undefined
            if (saved && modelIdentifier(saved.reported) && typeof saved.observedAt === "number") {
              last = saved
              lastReported.set(sessionID, saved)
              if (lastReported.size > 256) lastReported.delete(lastReported.keys().next().value!)
            }
          } catch { /* Missing storage must not disable live collection. */ }
        }
        return last ? { ...last, previous: Boolean(current) }
          : { ...(current ?? { requested: null, reported: null, source: null, observedAt: 0 }), previous: false }
      },
    })
    const requestHook = await context.session.hook("http.request", async (event) => {
      if (event.kind !== "primary" || disposed) return
      const record: ModelIdentity = { requested: null, reported: null, source: null, observedAt: Date.now() }
      records.delete(event.sessionID)
      records.set(event.sessionID, record)
      requests.set(event.request, record)
      if (records.size > 256) records.delete(records.keys().next().value!)
      record.requested = await readRequestModel(event.request)
    })
    const responseHook = await context.session.hook("http.response", async (event) => {
      if (event.kind !== "primary" || disposed) return
      // Read the final request too: a later plugin may have replaced or rewritten it.
      const tracked = requests.get(event.request)
      if (tracked && records.get(event.sessionID) !== tracked) return
      const record = tracked
        ?? { requested: null, reported: null, source: null, observedAt: Date.now() }
      record.requested = await readRequestModel(event.request)
      if (disposed) return
      records.set(event.sessionID, record)
      if (records.size > 256) records.delete(records.keys().next().value!)
      const response = event.response
      const contentType = response.headers.get("content-type") ?? ""
      if (!response.ok || !response.body || !/text\/event-stream|application\/json/i.test(contentType)) return
      const parser = createModelParser(/text\/event-stream/i.test(contentType), (model, source) => {
        if (disposed || records.get(event.sessionID) !== record) return
        record.reported = model
        record.source = source
        const prior = lastReported.get(event.sessionID)
        if (prior?.observedAt === record.observedAt && prior.reported === model && prior.source === source) return
        const snapshot = { ...record }
        lastReported.delete(event.sessionID)
        lastReported.set(event.sessionID, snapshot)
        if (lastReported.size > 256) lastReported.delete(lastReported.keys().next().value!)
        void context.storage.set(`model/${event.sessionID}`, snapshot).catch(() => {})
      })
      // Pass through every byte without teeing an unconsumed copy of the stream.
      event.response = new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          try { parser.push(chunk) } catch { /* Observation must not break generation. */ }
          controller.enqueue(chunk)
        },
        flush() { try { parser.end() } catch { /* Observation only. */ } },
      })), { status: response.status, statusText: response.statusText, headers: response.headers })
    })
    return async () => {
      disposed = true
      records.clear()
      lastReported.clear()
      await responseHook.dispose()
      await requestHook.dispose()
      await rpc.dispose()
    }
  },
})
