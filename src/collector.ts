import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Event } from "@opencode-ai/sdk/v2"
import type { BarConfig, MetricsAggregate, MetricsScope, RequestMetrics } from "./types"
import { aggregateRequestMetrics, createFreshMetrics, estimateTokens } from "./metrics"
import { parseAssistantMessage, parseSessionInfo, parseTextPart, parseUserMessage } from "./event-shapes"
import { applyAssistantTokens, applySessionModel, mergeAssistantModel } from "./request-updates"
import { createSessionTree } from "./session-tree"

export type MetricsListener = () => void

export interface MetricsCollector {
  getCurrent(sessionID: string): RequestMetrics | null
  getAggregate(sessionID: string, scope: MetricsScope, now?: number): MetricsAggregate | null
  getSessionStartTime(sessionID: string, scope?: MetricsScope): number | null
  getChildSessionCount(sessionID: string): number
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
  const sessionTree = createSessionTree()
  const sessionModels = new Map<string, { readonly modelID: string; readonly providerID: string }>()
  const sessionStartTimes = new Map<string, number>()
  const userMessageIds = new Map<string, Set<string>>()
  const listeners = new Set<MetricsListener>()
  const disposers: Array<() => void> = []

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

  function recordSession(value: unknown, now: number, defaultParentWhenMissing: boolean): void {
    const info = parseSessionInfo(value)
    if (!info) return
    if (info.hasParentID) {
      sessionTree.setParent(info.id, info.parentID)
    } else if (defaultParentWhenMissing) {
      sessionTree.setParent(info.id, null)
    }
    ensureSessionStart(info.id, now)
  }

  // ── session.created ──
  disposers.push(api.event.on("session.created", (event: Extract<Event, { type: "session.created" }>) => {
    const info = event.properties.info
    recordSession(info, performance.now(), true)
    notify()
  }))

  // ── session.updated ──
  disposers.push(api.event.on("session.updated", (event: Extract<Event, { type: "session.updated" }>) => {
    const info = event.properties.info
    recordSession(info, performance.now(), false)
    notify()
  }))

  // ── session.status ──
  disposers.push(api.event.on("session.status", (event: Extract<Event, { type: "session.status" }>) => {
    const sessionID = event.properties.sessionID
    const status = event.properties.status
    log(`session.status: ${sessionID} -> ${status?.type}`)
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
    if (field !== "text") return
    ensureSessionStart(sessionID, performance.now())

    let current = requests.get(sessionID)
    if (!current) {
      current = createFreshMetrics(sessionID, messageID, "", "", performance.now())
      applySessionModel(current, sessionModels.get(sessionID))
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
    const part = parseTextPart(event.properties.part)
    if (!part) return
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
    ensureSessionStart(sessionID, performance.now())

    const assistant = parseAssistantMessage(info)
    if (assistant) {
      const nextModel = mergeAssistantModel(sessionModels.get(sessionID), assistant)
      if (nextModel) sessionModels.set(sessionID, nextModel)

      const current = requests.get(sessionID)
      if (current) {
        const tokens = assistant.tokens
        if (tokens) {
          if (applyAssistantTokens(current, tokens)) {
            log(`exact: in=${tokens.input} out=${tokens.output} cr=${tokens.cacheRead} cw=${tokens.cacheWrite}`)
          } else {
            log(`assistant tokens all zero, skipping overwrite`)
          }
        }
        applySessionModel(current, sessionModels.get(sessionID))
        notify()
      }
    }

    const user = parseUserMessage(info)
    if (user) {
      const userMsgID = user.messageID
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
      applySessionModel(fresh, sessionModels.get(sessionID))
      requests.set(sessionID, fresh)
      notify()
    }
  }))

  // ── session.deleted ──
  disposers.push(api.event.on("session.deleted", (event: Extract<Event, { type: "session.deleted" }>) => {
    const sessionID = event.properties.sessionID
    sessionTree.deleteSession(sessionID)
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
    getAggregate(sessionID: string, scope: MetricsScope, now = performance.now()): MetricsAggregate | null {
      const ids = sessionTree.getScopeSessionIDs(sessionID, scope)
      const metrics = ids.map((id) => requests.get(id)).filter((m): m is RequestMetrics => m !== undefined)
      const aggregate = aggregateRequestMetrics(metrics, now)
      if (!aggregate) return null
      return {
        ...aggregate,
        childSessionCount: scope === "tree" ? sessionTree.getChildSessionCount(sessionID) : 0,
      }
    },
    getSessionStartTime(sessionID: string, scope: MetricsScope = "current"): number | null {
      const starts = sessionTree
        .getScopeSessionIDs(sessionID, scope)
        .map((id) => sessionStartTimes.get(id))
        .filter((start): start is number => start !== undefined)
      return starts.length === 0 ? null : Math.min(...starts)
    },
    getChildSessionCount(sessionID: string): number {
      return sessionTree.getChildSessionCount(sessionID)
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
      sessionTree.clear()
      sessionModels.clear()
      sessionStartTimes.clear()
      userMessageIds.clear()
      listeners.clear()
    },
  }
}
