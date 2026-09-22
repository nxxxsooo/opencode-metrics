import { Plugin } from "@opencode-ai/plugin"
import { createModelJsonScanner } from "./model-json-scanner"
import { createModelParser, modelIdentifier, readRequestModel, type ModelIdentity, type ModelTransport } from "./model-identity"
import { ModelIdentityRpc } from "./model-identity-rpc"
import { getConfig } from "./config"
import type { ModelEvidence } from "./model-evidence"
import { installWebSocketModelObserver } from "./ws-observer"

/** Cap the scanned prefix per WebSocket frame; model fields appear near the start. */
const FRAME_SCAN_LIMIT = 1024 * 1024
/** Bounded history of primary model.request records used to attribute sockets. */
const ATTRIBUTION_LIMIT = 64

interface ModelRequestRecord {
  readonly sessionID: string
  readonly baseURL: string
  readonly time: number
}

function normalizeBase(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, "")
}

function socketBase(url: string): string {
  return normalizeBase(url.replace(/^ws/i, "http").replace(/\/responses\/?(\?.*)?$/, ""))
}

function basesRelated(a: string, b: string): boolean {
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/")
}

// The beta SDK typings predate these hooks. Keep the compatibility boundary
// narrow until the supported SDK includes the native WS contract.
interface WebSocketHookEvent {
  readonly sessionID: string
  readonly kind: string
  readonly frame: string
}
type Registration = { dispose(): Promise<void> }
type WebSocketHook = (name: "experimental.ws.send" | "experimental.ws.receive",
  callback: (event: WebSocketHookEvent) => void) => Promise<Registration>

function hasNativeWebSocketHooks(version: string | undefined): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:$|\+)/.exec(version ?? "")
  if (!match) return false
  const [, major, minor, patch] = match.map(Number)
  return major! > 2 || (major === 2 && (minor! > 0 || patch! >= 12))
}

export default Plugin.define({
  // Internal server/storage identity within the opencode-metrics package.
  // Keep stable: OpenCode scopes saved model evidence by this ID.
  id: "opencode-metrics-model",
  async setup(context) {
    // Opt-in collection, not just a row-visibility preference. When disabled,
    // leave HTTP bodies and saved evidence untouched and expose no model RPC.
    if (context.options?.modelMonitor !== true && getConfig().modelMonitor !== true) return
    const { createModelEvidence } = await import("./model-evidence")
    const records = new Map<string, ModelEvidence>()
    const requests = new WeakMap<Request, ModelEvidence>()
    const lastReported = new Map<string, ModelIdentity>()
    // Evidence instances already claimed by an http.request; used to reuse the
    // model.request-seeded evidence for the same request instead of replacing it.
    const httpClaimed = new WeakSet<ModelEvidence>()
    const attributions: ModelRequestRecord[] = []
    const socketSessions = new WeakMap<object, string>()
    let disposed = false
    const rpc = await context.rpc.register(ModelIdentityRpc, {
      get: async (input) => {
        const sessionID = (input as { sessionID: string }).sessionID
        const current = records.get(sessionID)?.identity
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
    const commitResponse = (sessionID: string, evidence: ModelEvidence, model: string, source: string, transport: ModelTransport) => {
      evidence.response(model, source, transport)
      const record = evidence.identity
      const prior = lastReported.get(sessionID)
      if (prior?.observedAt === record.observedAt && prior.reported === model && prior.source === source
        && prior.transport === record.transport) return
      const snapshot = { ...record }
      lastReported.delete(sessionID)
      lastReported.set(sessionID, snapshot)
      if (lastReported.size > 256) lastReported.delete(lastReported.keys().next().value!)
      void context.storage.set(`model/${sessionID}`, snapshot).catch(() => {})
    }
    function attributeSocket(socket: object, url: string): string | null {
      const base = socketBase(url)
      if (!base) return null
      // Unattributable frames are ignored, never assigned to the most recent session.
      for (let i = attributions.length - 1; i >= 0; i--) {
        const record = attributions[i]!
        const candidate = normalizeBase(record.baseURL)
        if (candidate && basesRelated(candidate, base)) return record.sessionID
      }
      return null
    }
    function observeFrame(sessionID: string, direction: "in" | "out", text: string): void {
      if (disposed) return
      const evidence = records.get(sessionID)
      if (!evidence) return
      try {
        const scanner = createModelJsonScanner((model, source) => {
          if (disposed || records.get(sessionID) !== evidence) return
          if (direction === "out") evidence.request(model, "websocket")
          else commitResponse(sessionID, evidence, model, source, "websocket")
        })
        scanner.push(text.slice(0, FRAME_SCAN_LIMIT))
      } catch { /* Observation must not break generation or rewrite the frame. */ }
    }
    const nativeWebSocketHooks: Registration[] = []
    if (hasNativeWebSocketHooks(context.app?.version)) {
      try {
        const hook = context.session.hook.bind(context.session) as unknown as WebSocketHook
        nativeWebSocketHooks.push(await hook("experimental.ws.send", (event) => {
          if (event.kind === "primary") observeFrame(event.sessionID, "out", event.frame)
        }))
        nativeWebSocketHooks.push(await hook("experimental.ws.receive", (event) => {
          if (event.kind === "primary") observeFrame(event.sessionID, "in", event.frame)
        }))
      } catch {
        for (const hook of nativeWebSocketHooks.splice(0)) {
          try { await hook.dispose() } catch { /* Best effort cleanup before legacy fallback. */ }
        }
      }
    }
    // Fires before transport selection for every session request, HTTP or WebSocket.
    const modelRequestHook = await context.session.hook("model.request", async (event) => {
      if (disposed || event.kind !== "primary") return
      const ref = (event as { model?: { id?: unknown } }).model
      const configured = modelIdentifier(typeof ref?.id === "string" ? ref.id : null)
      const baseURL = typeof (event as { baseURL?: unknown }).baseURL === "string"
        ? (event as { baseURL?: unknown }).baseURL as string : ""
      // Every model call gets a fresh evidence/rank scope, including an HTTP→WS
      // switch. lastReported retains the previous pair until new evidence arrives.
      const evidence = createModelEvidence()
      records.delete(event.sessionID)
      records.set(event.sessionID, evidence)
      if (records.size > 256) records.delete(records.keys().next().value!)
      evidence.request(configured, "configured")
      if (nativeWebSocketHooks.length === 0) {
        attributions.push({ sessionID: event.sessionID, baseURL, time: Date.now() })
        if (attributions.length > ATTRIBUTION_LIMIT) attributions.shift()
      }
    })
    const requestHook = await context.session.hook("http.request", async (event) => {
      if (event.kind !== "primary" || disposed) return
      // Reuse the model.request-seeded evidence when it belongs to this request.
      let evidence = records.get(event.sessionID)
      if (!evidence || httpClaimed.has(evidence)) {
        evidence = createModelEvidence()
        records.delete(event.sessionID)
        records.set(event.sessionID, evidence)
        if (records.size > 256) records.delete(records.keys().next().value!)
      }
      httpClaimed.add(evidence)
      requests.set(event.request, evidence)
      evidence.request(await readRequestModel(event.request), "http")
    })
    const responseHook = await context.session.hook("http.response", async (event) => {
      if (event.kind !== "primary" || disposed) return
      // Read the final request too: a later plugin may have replaced or rewritten it.
      const tracked = requests.get(event.request)
      if (tracked && records.get(event.sessionID) !== tracked) return
      const evidence = tracked ?? createModelEvidence()
      evidence.request(await readRequestModel(event.request), "http")
      if (disposed) return
      records.set(event.sessionID, evidence)
      if (records.size > 256) records.delete(records.keys().next().value!)
      const response = event.response
      const contentType = response.headers.get("content-type") ?? ""
      if (!response.ok || !response.body || !/text\/event-stream|application\/json/i.test(contentType)) return
      const parser = createModelParser(/text\/event-stream/i.test(contentType), (model, source) => {
        if (disposed || records.get(event.sessionID) !== evidence) return
        commitResponse(event.sessionID, evidence, model, source, "http")
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
    // Older hosts lack native WS hooks. Retain the legacy observer for them;
    // modern hosts use explicit session IDs and never patch the global prototype.
    const observer = nativeWebSocketHooks.length > 0 ? null : installWebSocketModelObserver({
      isModelSocket: (url) => /^wss?:\/\//i.test(url) && /\/responses\/?(\?.*)?$/i.test(url),
      onFrame: ({ socket, url, direction, text }) => {
        if (disposed) return
        let attributedSession = socketSessions.get(socket)
        if (attributedSession === undefined) {
          const attributed = attributeSocket(socket, url)
          if (attributed === null) return
          socketSessions.set(socket, attributed)
          attributedSession = attributed
        }
        observeFrame(attributedSession, direction, text)
      },
    })
    return async () => {
      disposed = true
      records.clear()
      lastReported.clear()
      attributions.length = 0
      for (const hook of nativeWebSocketHooks) await hook.dispose()
      await responseHook.dispose()
      await requestHook.dispose()
      await modelRequestHook.dispose()
      observer?.dispose()
      await rpc.dispose()
    }
  },
})
