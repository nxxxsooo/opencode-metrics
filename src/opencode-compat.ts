import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { MetricsEventApi } from "./event-bus"
import type { HydrationApi } from "./session-hydration"

export interface HostSession {
  readonly id: string
  readonly parentID: string | null
}

export interface MetricsHost extends MetricsEventApi {
  readonly kind: "opencode-metrics-host"
  getStateHydrationApi(): HydrationApi | null
  fetchHydrationApi(sessionID: string): Promise<HydrationApi | null>
  fetchChildren(sessionID: string): Promise<readonly HostSession[] | null>
  requestRender(): void
  dispose(): void
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function callable(record: UnknownRecord | null, key: string): ((...args: never[]) => unknown) | null {
  if (!record || typeof record[key] !== "function") return null
  const fn = record[key] as (...args: never[]) => unknown
  return fn.bind(record)
}

function responseData(value: unknown): unknown {
  if (!isRecord(value)) return value
  if (value.error !== undefined && value.error !== null) {
    throw new Error(`OpenCode client returned an error: ${String(value.error)}`)
  }
  return Object.prototype.hasOwnProperty.call(value, "data") ? value.data : value
}

function messageInfo(value: unknown): unknown {
  return isRecord(value) && isRecord(value.info) ? value.info : value
}

function inferredStatus(messages: readonly unknown[]): { readonly type: "idle" | "busy" } {
  const last = messageInfo(messages.at(-1))
  if (!isRecord(last) || last.role !== "assistant") return { type: "idle" }
  const time = isRecord(last.time) ? last.time : null
  return { type: typeof time?.completed === "number" ? "idle" : "busy" }
}

function stateHydrationApi(api: unknown): HydrationApi | null {
  if (!isRecord(api) || !isRecord(api.state) || !isRecord(api.state.session)) return null
  const messages = callable(api.state.session, "messages")
  const status = callable(api.state.session, "status")
  if (!messages || !status) return null
  const part = callable(api.state, "part")
  return {
    state: {
      session: {
        messages: (sessionID) => {
          const value = messages(sessionID as never)
          return Array.isArray(value) ? value : []
        },
        status: (sessionID) => status(sessionID as never),
      },
      ...(part ? { part: (messageID: string) => {
        const value = part(messageID as never)
        return Array.isArray(value) ? value : []
      } } : {}),
    },
  }
}

function clientSession(api: unknown): UnknownRecord | null {
  if (!isRecord(api) || !isRecord(api.client) || !isRecord(api.client.session)) return null
  return api.client.session
}

function parseChildren(value: unknown): readonly HostSession[] {
  const data = responseData(value)
  if (!Array.isArray(data)) return []
  return data.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0) return []
    return [{ id: item.id, parentID: typeof item.parentID === "string" ? item.parentID : null }]
  })
}

export function isMetricsHost(value: unknown): value is MetricsHost {
  return isRecord(value) && value.kind === "opencode-metrics-host"
}

export function createOpenCodeHost(
  api: TuiPluginApi | MetricsEventApi | unknown,
  log: (message: string) => void = () => {},
): MetricsHost {
  if (!isRecord(api) || !isRecord(api.event) || typeof api.event.on !== "function") {
    throw new Error("OpenCode host does not expose an event bus")
  }

  const eventOn = api.event.on as (type: string, handler: (event: unknown) => void) => () => void
  const stateApi = stateHydrationApi(api)
  const session = clientSession(api)
  const messages = callable(session, "messages")
  const children = callable(session, "children")
  const renderer = isRecord(api.renderer) ? api.renderer : null
  const requestRender = callable(renderer, "requestRender")
  let disposed = false

  return {
    kind: "opencode-metrics-host",
    event: {
      on(type, handler) {
        if (disposed) return () => {}
        return eventOn(type, handler)
      },
    },
    getStateHydrationApi() {
      return disposed ? null : stateApi
    },
    async fetchHydrationApi(sessionID) {
      if (disposed || !messages) return null
      try {
        const response = await messages({ sessionID } as never)
        if (disposed) return null
        const data = responseData(response)
        if (!Array.isArray(data)) return null
        const status = inferredStatus(data)
        return {
          state: {
            session: {
              messages: () => data,
              status: () => status,
            },
          },
        }
      } catch (error) {
        if (!disposed) log(`session message fallback failed: session=${sessionID} error=${String(error)}`)
        return null
      }
    },
    async fetchChildren(sessionID) {
      if (disposed || !children) return null
      try {
        const response = await children({ sessionID } as never)
        return disposed ? null : parseChildren(response)
      } catch (error) {
        if (!disposed) log(`session children fallback failed: session=${sessionID} error=${String(error)}`)
        return null
      }
    },
    requestRender() {
      if (!disposed && requestRender) requestRender()
    },
    dispose() {
      disposed = true
    },
  }
}
