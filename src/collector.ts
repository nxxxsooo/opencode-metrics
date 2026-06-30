import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Event } from "@opencode-ai/sdk/v2"
import type { BarConfig, RequestMetrics } from "./types"
import { createFreshMetrics, estimateTokens } from "./metrics"

interface SessionInfoExt {
  id?: string
  parentID?: string | null
}
interface AssistantMessageExt {
  role?: string
  modelID?: string
  providerID?: string
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
}
interface UserMessageExt {
  id?: string
  role?: string
}
interface PartExt {
  type?: string
  messageID?: string
  text?: string
}

export type MetricsListener = () => void

export interface MetricsCollector {
  getCurrent(sessionID: string): RequestMetrics | null
  getSessionStartTime(sessionID: string): number | null
  subscribe(listener: MetricsListener): () => void
  dispose(): void
}

export function createCollector(
  api: TuiPluginApi,
  config: BarConfig,
  log: (msg: string) => void,
): MetricsCollector {
  const requests = new Map<string, RequestMetrics>()
  const holdTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const sessionParents = new Map<string, string | null | undefined>()
  const sessionModels = new Map<string, { modelID: string; providerID: string }>()
  const sessionStartTimes = new Map<string, number>()
  const userMessageIds = new Map<string, Set<string>>()
  const listeners = new Set<MetricsListener>()
  const disposers: Array<() => void> = []

  const defaultFilter = (session: { parentID?: string | null }) => !session.parentID

  function shouldTrackSession(sessionID: string): boolean {
    const parentID = sessionParents.get(sessionID)
    if (parentID === undefined) return true
    return defaultFilter({ parentID })
  }

  function notify(): void {
    for (const listener of listeners) listener()
  }

  function ensureSessionStart(sessionID: string, now: number): void {
    if (!sessionStartTimes.has(sessionID)) {
      sessionStartTimes.set(sessionID, now)
    }
  }

  function clearHoldTimer(sessionID: string): void {
    const timer = holdTimers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      holdTimers.delete(sessionID)
    }
  }

  // ── session.created ──
  disposers.push(api.event.on("session.created", (event: Extract<Event, { type: "session.created" }>) => {
    const info = event.properties.info
    if (info?.id) {
      sessionParents.set(info.id, (info as SessionInfoExt).parentID ?? null)
      if (shouldTrackSession(info.id)) {
        ensureSessionStart(info.id, performance.now())
      }
    }
  }))

  // ── session.updated ──
  disposers.push(api.event.on("session.updated", (event: Extract<Event, { type: "session.updated" }>) => {
    const info = event.properties.info
    if (info?.id) {
      sessionParents.set(info.id, (info as SessionInfoExt).parentID ?? null)
      if (shouldTrackSession(info.id)) {
        ensureSessionStart(info.id, performance.now())
      }
    }
  }))

  // ── session.status ──
  disposers.push(api.event.on("session.status", (event: Extract<Event, { type: "session.status" }>) => {
    const sessionID = event.properties.sessionID
    const status = event.properties.status
    log(`session.status: ${sessionID} -> ${status?.type}`)
    if (!shouldTrackSession(sessionID)) return
    ensureSessionStart(sessionID, performance.now())

    if (status?.type === "busy") {
      clearHoldTimer(sessionID)
      const existing = requests.get(sessionID)
      if (existing && existing.isComplete) {
        const prev = existing
        requests.set(sessionID, createFreshMetrics(sessionID, "", prev.modelID, prev.providerID, performance.now()))
        log(`new model request after tool call: session=${sessionID}`)
        notify()
      } else if (!existing) {
        requests.set(sessionID, createFreshMetrics(sessionID, "", "", "", performance.now()))
        notify()
      }
    }

    if (status?.type === "idle") {
      const current = requests.get(sessionID)
      if (current) {
        current.isStreaming = false
        current.isComplete = true
        current.completeTime = performance.now()
        log(`request complete: session=${sessionID}`)
        notify()
        if (config.holdDurationMs > 0) {
          clearHoldTimer(sessionID)
          holdTimers.set(sessionID, setTimeout(() => {
            holdTimers.delete(sessionID)
            if (requests.get(sessionID)?.sessionID === sessionID) {
              requests.delete(sessionID)
              notify()
            }
          }, config.holdDurationMs))
        }
      }
    }
  }))

  // ── message.part.delta ──
  disposers.push(api.event.on("message.part.delta", (event: Extract<Event, { type: "message.part.delta" }>) => {
    const sessionID = event.properties.sessionID
    const messageID = event.properties.messageID
    const delta = event.properties.delta ?? ""
    const field = event.properties.field ?? ""
    if (!shouldTrackSession(sessionID)) return
    if (field !== "text") return
    ensureSessionStart(sessionID, performance.now())

    let current = requests.get(sessionID)
    if (!current) {
      current = createFreshMetrics(sessionID, messageID, "", "", performance.now())
      const cached = sessionModels.get(sessionID)
      if (cached) {
        current.modelID = cached.modelID
        current.providerID = cached.providerID
      }
      requests.set(sessionID, current)
    }

    if (current.firstTokenTime === null) {
      current.firstTokenTime = performance.now()
    }

    current.estimatedOutputTokens += estimateTokens(delta, config.estimationRatio)
    current.lastDeltaTime = performance.now()
    current.isStreaming = true
    notify()
  }))

  // ── message.part.updated ──
  disposers.push(api.event.on("message.part.updated", (event: Extract<Event, { type: "message.part.updated" }>) => {
    const sessionID = event.properties.sessionID
    const part = event.properties.part as PartExt
    if (!part || part.type !== "text" || !part.messageID || !part.text) return
    if (!shouldTrackSession(sessionID)) return
    ensureSessionStart(sessionID, performance.now())
    const msgIds = userMessageIds.get(sessionID)
    if (!msgIds || !msgIds.has(part.messageID)) return

    const current = requests.get(sessionID)
    if (current) {
      current.estimatedInputTokens = estimateTokens(part.text, config.estimationRatio)
      log(`estimated input tokens: ${current.estimatedInputTokens} (textLen=${part.text.length})`)
      notify()
    }
  }))

  // ── message.updated ──
  disposers.push(api.event.on("message.updated", (event: Extract<Event, { type: "message.updated" }>) => {
    const sessionID = event.properties.sessionID
    const info = event.properties.info
    if (!shouldTrackSession(sessionID)) return
    ensureSessionStart(sessionID, performance.now())

    const role: string = (info as AssistantMessageExt)?.role ?? ""

    if (role === "assistant") {
      const mid = (info as AssistantMessageExt).modelID
      const pid = (info as AssistantMessageExt).providerID
      if (mid || pid) {
        const existing = sessionModels.get(sessionID)
        sessionModels.set(sessionID, {
          modelID: mid || existing?.modelID || "",
          providerID: pid || existing?.providerID || "",
        })
      }

      const current = requests.get(sessionID)
      if (current) {
        const tokens = (info as AssistantMessageExt).tokens
        if (tokens) {
          const input = Math.max(0, tokens.input ?? 0)
          const output = Math.max(0, tokens.output ?? 0)
          const reasoning = Math.max(0, tokens.reasoning ?? 0)
          const cacheRead = Math.max(0, tokens.cache?.read ?? 0)
          const cacheWrite = Math.max(0, tokens.cache?.write ?? 0)
          if (input + output + reasoning + cacheRead + cacheWrite > 0) {
            current.exactInputTokens = input
            current.exactOutputTokens = output
            current.exactReasoningTokens = reasoning
            current.exactCacheReadTokens = cacheRead
            current.exactCacheWriteTokens = cacheWrite
            current.hasExactTokens = true
            log(`exact: in=${input} out=${output} cr=${cacheRead} cw=${cacheWrite}`)
          } else {
            log(`assistant tokens all zero, skipping overwrite`)
          }
        }
        const cached = sessionModels.get(sessionID)
        if (cached) {
          current.modelID = cached.modelID
          current.providerID = cached.providerID
        }
        notify()
      }
    }

    if (role === "user") {
      const userMsgID = (info as UserMessageExt).id ?? ""
      const current = requests.get(sessionID)
      if (current && current.messageID === userMsgID) {
        return
      }
      const fresh = createFreshMetrics(sessionID, userMsgID, "", "", performance.now())
      if (userMsgID) {
        let msgIds = userMessageIds.get(sessionID)
        if (!msgIds) {
          msgIds = new Set()
          userMessageIds.set(sessionID, msgIds)
        }
        msgIds.add(userMsgID)
      }
      log(`user msg: id=${userMsgID}`)
      const cached = sessionModels.get(sessionID)
      if (cached) {
        fresh.modelID = cached.modelID
        fresh.providerID = cached.providerID
      }
      requests.set(sessionID, fresh)
      notify()
    }
  }))

  // ── session.deleted ──
  disposers.push(api.event.on("session.deleted", (event: Extract<Event, { type: "session.deleted" }>) => {
    const sessionID = event.properties.sessionID
    sessionParents.delete(sessionID)
    sessionModels.delete(sessionID)
    sessionStartTimes.delete(sessionID)
    userMessageIds.delete(sessionID)
    clearHoldTimer(sessionID)
    if (requests.has(sessionID)) {
      requests.delete(sessionID)
      notify()
    }
  }))

  return {
    getCurrent(sessionID: string): RequestMetrics | null {
      return requests.get(sessionID) ?? null
    },
    getSessionStartTime(sessionID: string): number | null {
      return sessionStartTimes.get(sessionID) ?? null
    },
    subscribe(listener: MetricsListener): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose(): void {
      for (const dispose of disposers.splice(0)) dispose()
      for (const timer of holdTimers.values()) clearTimeout(timer)
      holdTimers.clear()
      requests.clear()
      sessionParents.clear()
      sessionModels.clear()
      sessionStartTimes.clear()
      userMessageIds.clear()
      listeners.clear()
    },
  }
}
