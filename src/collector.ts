import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BarConfig, MetricsAggregate, MetricsScope, RequestMetrics } from "./types"
import { aggregateRequestMetrics, getDisplayInputTokens, getDisplayOutputTokens } from "./metrics"
import { registerEventHandlers } from "./event-handlers"
import type { CollectorState } from "./collector-state"
import type { MetricsEventApi } from "./event-bus"
import { hydrateSession, isHydrationApi, type HydrationApi } from "./session-hydration"
import { createSessionTree } from "./session-tree"
import { getSessionElapsedMs, startSessionTiming, stopSessionTiming } from "./session-timing"

export type MetricsListener = () => void
type MetricsHydrationApi = MetricsEventApi & HydrationApi

export interface MetricsCollector {
  getCurrent(sessionID: string): RequestMetrics | null
  getAggregate(sessionID: string, scope: MetricsScope, now?: number): MetricsAggregate | null
  getSessionElapsedMs(sessionID: string, scope?: MetricsScope, now?: number): number
  getChildSessionCount(sessionID: string): number
  subscribe(listener: MetricsListener): () => void
  dispose(): void
}

export function createCollector(
  api: TuiPluginApi,
  config: BarConfig,
  log: (msg: string) => void,
): MetricsCollector
export function createCollector(
  api: MetricsEventApi,
  config: BarConfig,
  log: (msg: string) => void,
): MetricsCollector
export function createCollector(
  api: MetricsHydrationApi,
  config: BarConfig,
  log: (msg: string) => void,
): MetricsCollector
export function createCollector(
  api: TuiPluginApi | MetricsEventApi | MetricsHydrationApi,
  config: BarConfig,
  log: (msg: string) => void,
): MetricsCollector {
  const state: CollectorState = {
    requests: new Map(),
    holdTimers: new Map(),
    sessionTree: createSessionTree(),
    sessionModels: new Map(),
    sessionTimings: new Map(),
    userMessageIds: new Map(),
    assistantMessageIds: new Map(),
    partTokenEstimates: new Map(),
    partTexts: new Map(),
    sessionAliases: new Map(),
    lastRequestSessionID: null,
  }
  const listeners = new Set<MetricsListener>()
  const hydrationApi = isHydrationApi(api) ? api : null
  const hydratedSessions = new Set<string>()
  const loggedFallbacks = new Set<string>()

  function notify(): void {
    for (const listener of listeners) listener()
  }

  function clearHoldTimer(sessionID: string): void {
    const timer = state.holdTimers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      state.holdTimers.delete(sessionID)
    }
  }

  const disposers = registerEventHandlers({
    api,
    config,
    log,
    state,
    actions: {
      notify,
      startSessionTiming: (sessionID, now) => startSessionTiming(state.sessionTimings, sessionID, now),
      stopSessionTiming: (sessionID, now) => stopSessionTiming(state.sessionTimings, sessionID, now),
      clearHoldTimer,
    },
  })

  function hydrate(sessionID: string): void {
    if (!hydrationApi) return
    const hydrated = hydrateSession({ api: hydrationApi, state, sessionID, now: performance.now() })
    const current = state.requests.get(sessionID)
    if (hydrated && current && !hydratedSessions.has(sessionID)) {
      hydratedSessions.add(sessionID)
      log(`hydrated session state: session=${sessionID} message=${current.messageID} in=${current.exactInputTokens} out=${current.exactOutputTokens}`)
    }
  }

  function normalizeSessionID(sessionID: string): string {
    return typeof sessionID === "string" ? sessionID : ""
  }

  function hasUsefulMetrics(metrics: readonly RequestMetrics[]): boolean {
    return metrics.some((item) => (
      getDisplayInputTokens(item) > 0
      || getDisplayOutputTokens(item) > 0
      || item.exactCacheReadTokens > 0
      || item.exactCacheWriteTokens > 0
      || item.firstTokenTime !== null
      || item.lastDeltaTime !== null
    ))
  }

  function usefulMetricsFor(ids: readonly string[]): readonly RequestMetrics[] {
    const metrics = ids
      .map((id) => state.requests.get(id))
      .filter((item): item is RequestMetrics => item !== undefined)
    return hasUsefulMetrics(metrics) ? metrics : []
  }

  function aliasScopeSessionIDs(sessionID: string, scope: MetricsScope): { readonly rootID: string; readonly ids: readonly string[] } | null {
    for (const aliasID of state.sessionAliases.get(sessionID) ?? []) {
      const aliasIDs = state.sessionTree.getScopeSessionIDs(aliasID, scope)
      if (usefulMetricsFor(aliasIDs).length > 0) {
        return { rootID: aliasID, ids: aliasIDs }
      }
    }
    return null
  }

  function resolveMetricsSessionID(sessionID: string): string {
    const requestedSessionID = normalizeSessionID(sessionID)
    const requested = state.requests.get(requestedSessionID)
    if (requested && hasUsefulMetrics([requested])) return requestedSessionID
    const alias = aliasScopeSessionIDs(requestedSessionID, "current")
    if (alias) return alias.rootID
    return requestedSessionID
  }

  function scopeSessionIDs(sessionID: string, scope: MetricsScope): { readonly rootID: string; readonly ids: readonly string[] } {
    const requestedSessionID = normalizeSessionID(sessionID)
    const requestedIDs = state.sessionTree.getScopeSessionIDs(requestedSessionID, scope)
    if (usefulMetricsFor(requestedIDs).length > 0) {
      return { rootID: requestedSessionID, ids: requestedIDs }
    }

    const alias = aliasScopeSessionIDs(requestedSessionID, scope)
    if (alias) {
      const fallbackKey = `${requestedSessionID}->${alias.rootID}`
      if (!loggedFallbacks.has(fallbackKey)) {
        loggedFallbacks.add(fallbackKey)
        log(`sidebar session alias: requested=${requestedSessionID || "(empty)"} metrics=${alias.rootID}`)
      }
      return alias
    }

    return { rootID: requestedSessionID, ids: requestedIDs }
  }

  return {
    getCurrent(sessionID: string): RequestMetrics | null {
      const requestedSessionID = normalizeSessionID(sessionID)
      hydrate(requestedSessionID)
      return state.requests.get(resolveMetricsSessionID(requestedSessionID)) ?? null
    },
    getAggregate(sessionID: string, scope: MetricsScope, now = performance.now()): MetricsAggregate | null {
      const requestedSessionID = normalizeSessionID(sessionID)
      hydrate(requestedSessionID)
      const { rootID, ids } = scopeSessionIDs(requestedSessionID, scope)
      const metrics = ids.map((id) => state.requests.get(id)).filter((m): m is RequestMetrics => m !== undefined)
      const aggregate = aggregateRequestMetrics(metrics, now)
      if (!aggregate) return null
      return {
        ...aggregate,
        childSessionCount: scope === "tree" ? state.sessionTree.getChildSessionCount(rootID) : 0,
      }
    },
    getSessionElapsedMs(sessionID: string, scope: MetricsScope = "current", now = performance.now()): number {
      const requestedSessionID = normalizeSessionID(sessionID)
      hydrate(requestedSessionID)
      const { ids } = scopeSessionIDs(requestedSessionID, scope)
      return ids.reduce((total, id) => total + getSessionElapsedMs(state.sessionTimings.get(id), now), 0)
    },
    getChildSessionCount(sessionID: string): number {
      return state.sessionTree.getChildSessionCount(sessionID)
    },
    subscribe(listener: MetricsListener): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose(): void {
      for (const dispose of disposers.splice(0)) dispose()
      for (const timer of state.holdTimers.values()) clearTimeout(timer)
      state.holdTimers.clear()
      state.requests.clear()
      state.sessionTree.clear()
      state.sessionModels.clear()
      state.sessionTimings.clear()
      state.userMessageIds.clear()
      state.assistantMessageIds.clear()
      state.partTokenEstimates.clear()
      state.partTexts.clear()
      state.sessionAliases.clear()
      state.lastRequestSessionID = null
      loggedFallbacks.clear()
      hydratedSessions.clear()
      listeners.clear()
    },
  }
}
