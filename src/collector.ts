import type { BarConfig, CacheReadCompleteness, MetricsAggregate, MetricsScope, RequestMetrics } from "./types"
import { getDisplayInputTokens, getDisplayOutputTokens, getTtft } from "./metrics"
import { registerEventHandlers } from "./event-handlers"
import type { CollectorState } from "./collector-state"
import type { MetricsEventApi } from "./event-bus"
import { createOpenCodeHost, isMetricsHost, type MetricsHost } from "./opencode-compat"
import { hydrateSession } from "./session-hydration"
import { createSessionTree } from "./session-tree"
import { getScopeElapsedMs, getSessionElapsedMs, startSessionTiming, stopSessionTiming } from "./session-timing"
import { getLiveTps } from "./live-speed"
import { liveRequestOutput, turnInputTokens } from "./turn-state"

export type MetricsListener = () => void

export interface MetricsCollector {
  getCurrent(sessionID: string): RequestMetrics | null
  getAggregate(sessionID: string, scope: MetricsScope, now?: number): MetricsAggregate | null
  getSessionElapsedMs(sessionID: string, scope?: MetricsScope, now?: number): number
  getChildSessionCount(sessionID: string): number
  subscribe(listener: MetricsListener): () => void
  dispose(): void
}

export function createCollector(
  api: MetricsHost | MetricsEventApi | unknown,
  config: BarConfig,
  log: (msg: string) => void,
): MetricsCollector {
  const host = isMetricsHost(api) ? api : createOpenCodeHost(api, log)
  const state: CollectorState = {
    requests: new Map(),
    turns: new Map(),
    liveSpeeds: new Map(),
    holdTimers: new Map(),
    sessionTree: createSessionTree(),
    sessionModels: new Map(),
    sessionTimings: new Map(),
    userMessageIds: new Map(),
    assistantMessageIds: new Map(),
    partTokenEstimates: new Map(),
    sessionAliases: new Map(),
    seenEventKeys: new Set(),
    seenEventOrder: [],
    lastRequestSessionID: null,
  }
  const listeners = new Set<MetricsListener>()
  const hydratedSessions = new Set<string>()
  const hydratingSessions = new Set<string>()
  const hydrationRetryAfter = new Map<string, number>()
  const loggedFallbacks = new Set<string>()
  const hydratedTreeRoots = new Set<string>()
  const hydratingTreeRoots = new Set<string>()
  const treeRetryAfter = new Map<string, number>()
  let disposed = false

  function notify(): void {
    if (disposed) return
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
    api: host,
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

  function recordHydration(sessionID: string, hydrated: boolean, now: number): boolean {
    const current = state.requests.get(sessionID)
    if (hydrated && current) {
      hydratedSessions.add(sessionID)
      hydrationRetryAfter.delete(sessionID)
      log(`hydrated session state: session=${sessionID} message=${current.messageID} in=${current.exactInputTokens} out=${current.exactOutputTokens}`)
      return true
    }
    hydrationRetryAfter.set(sessionID, now + 2000)
    return false
  }

  function hydrate(sessionID: string): void {
    if (disposed || hydratedSessions.has(sessionID) || hydratingSessions.has(sessionID)) return
    const now = performance.now()
    if ((hydrationRetryAfter.get(sessionID) ?? 0) > now) return

    const stateApi = host.getStateHydrationApi()
    if (stateApi) {
      try {
        if (recordHydration(sessionID, hydrateSession({ api: stateApi, state, sessionID, now }), now)) return
      } catch (error) {
        log(`session state hydration failed: session=${sessionID} error=${String(error)}`)
      }
    }

    const requestAtStart = state.requests.get(sessionID)
    hydratingSessions.add(sessionID)
    void host.fetchHydrationApi(sessionID).then((fallbackApi) => {
      if (disposed || hydratedSessions.has(sessionID)) return
      const fallbackNow = performance.now()
      if (!fallbackApi) {
        hydrationRetryAfter.set(sessionID, fallbackNow + 2000)
        return
      }
      if (state.requests.get(sessionID) !== requestAtStart) {
        hydratedSessions.add(sessionID)
        hydrationRetryAfter.delete(sessionID)
        return
      }
      try {
        const hydrated = hydrateSession({ api: fallbackApi, state, sessionID, now: fallbackNow })
        if (recordHydration(sessionID, hydrated, fallbackNow)) notify()
      } catch (error) {
        hydrationRetryAfter.set(sessionID, fallbackNow + 2000)
        log(`session client hydration failed: session=${sessionID} error=${String(error)}`)
      }
    }).finally(() => {
      hydratingSessions.delete(sessionID)
    })
  }

  function hydrateTree(rootSessionID: string): void {
    if (hydratedTreeRoots.has(rootSessionID) || hydratingTreeRoots.has(rootSessionID)) return
    const now = performance.now()
    if ((treeRetryAfter.get(rootSessionID) ?? 0) > now) return
    hydratingTreeRoots.add(rootSessionID)

    void (async () => {
      try {
        let parents = [rootSessionID]
        const visited = new Set<string>(parents)
        while (parents.length > 0) {
          const responses = await Promise.all(parents.map(async (parentID) => ({
            parentID,
            children: await host.fetchChildren(parentID),
          })))
          if (disposed) return
          if (responses.some((item) => item.children === null)) {
            treeRetryAfter.set(rootSessionID, performance.now() + 2000)
            return
          }
          const next: string[] = []
          for (const { parentID, children } of responses) {
            for (const child of children ?? []) {
              const childID = child.id
              state.sessionTree.setParent(childID, child.parentID ?? parentID)
              hydrate(childID)
              if (!visited.has(childID)) {
                visited.add(childID)
                next.push(childID)
              }
            }
          }
          parents = next
        }
        hydratedTreeRoots.add(rootSessionID)
        treeRetryAfter.delete(rootSessionID)
        notify()
      } catch (error) {
        if (!disposed) {
          treeRetryAfter.set(rootSessionID, performance.now() + 2000)
          log(`tree hydration failed: session=${rootSessionID} error=${String(error)}`)
        }
      } finally {
        hydratingTreeRoots.delete(rootSessionID)
      }
    })()
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

  function hasUsefulSession(sessionID: string): boolean {
    const request = state.requests.get(sessionID)
    const turn = state.turns.get(sessionID)
    return Boolean(
      (request && hasUsefulMetrics([request]))
      || (turn && (
        turn.finalizedOutputTokens > 0
        || turn.hasStickyContextTokens
      )),
    )
  }

  function usefulMetricsFor(ids: readonly string[]): readonly RequestMetrics[] {
    const metrics = ids
      .map((id) => state.requests.get(id))
      .filter((item): item is RequestMetrics => item !== undefined)
    return metrics.length > 0 && ids.some(hasUsefulSession) ? metrics : []
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
    if ((requested && hasUsefulMetrics([requested])) || hasUsefulSession(requestedSessionID)) return requestedSessionID
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
      if (scope === "tree") hydrateTree(requestedSessionID)
      const { rootID, ids } = scopeSessionIDs(requestedSessionID, scope)
      const foregroundTurn = state.turns.get(rootID)
      const foregroundRequest = state.requests.get(rootID)
      if (!foregroundTurn && !foregroundRequest) return null

      const foregroundTurnStart = foregroundTurn?.turnStartTime ?? foregroundRequest!.requestStartTime
      let inputTokens = 0
      let outputTokens = 0
      let cacheReadTokens = 0
      let cacheExactCount = 0
      let contributingCount = 0
      let liveTps = 0
      let liveRateCount = 0
      let isStreaming = false
      const contributingSessionIDs: string[] = []

      for (const id of ids) {
        const turn = state.turns.get(id)
        const request = state.requests.get(id)
        if (!turn && !request) continue
        const belongsToForegroundTurn = id === rootID
          || Boolean(turn && (turn.turnStartTime >= foregroundTurnStart || !turn.isComplete))
        if (belongsToForegroundTurn) {
          const sessionInput = turn ? turnInputTokens(turn, request) : request ? getDisplayInputTokens(request) : 0
          const sessionOutput = turn
            ? turn.finalizedOutputTokens + liveRequestOutput(turn, request)
            : request ? getDisplayOutputTokens(request) : 0
          const hasContribution = sessionInput > 0 || sessionOutput > 0 || Boolean(request?.isStreaming)
          if (hasContribution) {
            inputTokens += sessionInput
            outputTokens += sessionOutput
            contributingCount += 1
            contributingSessionIDs.push(id)
            if (turn?.hasStickyCacheReadTokens) {
              cacheReadTokens += turn.stickyCacheReadTokens
              cacheExactCount += 1
            } else if (!turn && request?.hasExactCacheReadTokens) {
              cacheReadTokens += Math.max(0, request.exactCacheReadTokens)
              cacheExactCount += 1
            }
          }
        }

        const rate = getLiveTps(state.liveSpeeds.get(id), now)
        if (rate !== null) {
          liveTps += rate
          liveRateCount += 1
        }
        isStreaming = isStreaming || Boolean(request?.isStreaming)
      }

      const cacheReadCompleteness: CacheReadCompleteness = cacheExactCount === 0
        ? "unknown"
        : cacheExactCount === contributingCount ? "exact" : "partial"
      const requestStartTime = foregroundTurn?.turnStartTime ?? foregroundRequest!.requestStartTime
      const firstTokenTime = foregroundRequest?.firstTokenTime ?? null
      const isComplete = foregroundTurn?.isComplete ?? foregroundRequest?.isComplete ?? false
      const completeTime = foregroundTurn?.completeTime ?? foregroundRequest?.completeTime ?? null

      return {
        sessionIDs: contributingSessionIDs.length > 0 ? contributingSessionIDs : [rootID],
        childSessionCount: scope === "tree" ? state.sessionTree.getChildSessionCount(rootID) : 0,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheReadCompleteness,
        requestStartTime,
        firstTokenTime,
        completeTime: isComplete ? completeTime ?? now : null,
        ttft: foregroundRequest ? getTtft(foregroundRequest) : null,
        liveTps: liveRateCount > 0 ? Math.round(liveTps * 10) / 10 : null,
        isStreaming,
        isComplete,
      }
    },
    getSessionElapsedMs(sessionID: string, scope: MetricsScope = "current", now = performance.now()): number {
      const requestedSessionID = normalizeSessionID(sessionID)
      hydrate(requestedSessionID)
      if (scope === "tree") hydrateTree(requestedSessionID)
      const { rootID, ids } = scopeSessionIDs(requestedSessionID, scope)
      if (scope === "current") return getSessionElapsedMs(state.sessionTimings.get(rootID), now)
      return getScopeElapsedMs(state.sessionTimings, ids, now)
    },
    getChildSessionCount(sessionID: string): number {
      return state.sessionTree.getChildSessionCount(sessionID)
    },
    subscribe(listener: MetricsListener): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose(): void {
      disposed = true
      for (const dispose of disposers.splice(0)) dispose()
      for (const timer of state.holdTimers.values()) clearTimeout(timer)
      state.holdTimers.clear()
      state.requests.clear()
      state.turns.clear()
      state.liveSpeeds.clear()
      state.sessionTree.clear()
      state.sessionModels.clear()
      state.sessionTimings.clear()
      state.userMessageIds.clear()
      state.assistantMessageIds.clear()
      state.partTokenEstimates.clear()
      state.sessionAliases.clear()
      state.seenEventKeys.clear()
      state.seenEventOrder.length = 0
      state.lastRequestSessionID = null
      loggedFallbacks.clear()
      hydratedSessions.clear()
      hydratingSessions.clear()
      hydrationRetryAfter.clear()
      hydratedTreeRoots.clear()
      hydratingTreeRoots.clear()
      treeRetryAfter.clear()
      listeners.clear()
      host.dispose()
    },
  }
}
