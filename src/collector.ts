import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BarConfig, CacheReadCompleteness, MetricsAggregate, MetricsScope, RequestMetrics } from "./types"
import { getDisplayInputTokens, getDisplayOutputTokens, getTtft } from "./metrics"
import { registerEventHandlers } from "./event-handlers"
import type { CollectorState } from "./collector-state"
import type { MetricsEventApi } from "./event-bus"
import { hydrateSession, isHydrationApi, type HydrationApi } from "./session-hydration"
import { createSessionTree } from "./session-tree"
import { getScopeElapsedMs, getSessionElapsedMs, startSessionTiming, stopSessionTiming } from "./session-timing"
import { getLiveTps } from "./live-speed"
import { liveRequestOutput, turnInputTokens } from "./turn-state"

export type MetricsListener = () => void
type MetricsHydrationApi = MetricsEventApi & HydrationApi

interface TreeHydrationApi {
  readonly client: {
    readonly session: {
      children(input: { sessionID: string }): Promise<unknown>
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isTreeHydrationApi(value: unknown): value is TreeHydrationApi {
  if (!isRecord(value) || !isRecord(value.client)) return false
  const session = isRecord(value.client.session) ? value.client.session : null
  return session !== null && typeof session.children === "function"
}

function childSessions(value: unknown): Array<{ id: string; parentID: string | null }> {
  if (isRecord(value) && value.error !== undefined && value.error !== null) {
    throw new Error(`session.children returned an error: ${String(value.error)}`)
  }
  const data = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data) ? value.data : []
  return data.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0) return []
    return [{ id: item.id, parentID: typeof item.parentID === "string" ? item.parentID : null }]
  })
}

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
  const hydrationApi = isHydrationApi(api) ? api : null
  const treeHydrationApi = isTreeHydrationApi(api) ? api : null
  const hydratedSessions = new Set<string>()
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
    if (!hydrationApi || hydratedSessions.has(sessionID)) return
    const now = performance.now()
    if ((hydrationRetryAfter.get(sessionID) ?? 0) > now) return
    let hydrated = false
    try {
      hydrated = hydrateSession({ api: hydrationApi, state, sessionID, now })
    } catch (error) {
      log(`session hydration failed: session=${sessionID} error=${String(error)}`)
    }
    const current = state.requests.get(sessionID)
    if (hydrated && current) {
      hydratedSessions.add(sessionID)
      hydrationRetryAfter.delete(sessionID)
      log(`hydrated session state: session=${sessionID} message=${current.messageID} in=${current.exactInputTokens} out=${current.exactOutputTokens}`)
    } else {
      hydrationRetryAfter.set(sessionID, now + 2000)
    }
  }

  function hydrateTree(rootSessionID: string): void {
    if (!treeHydrationApi || hydratedTreeRoots.has(rootSessionID) || hydratingTreeRoots.has(rootSessionID)) return
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
            response: await treeHydrationApi.client.session.children({ sessionID: parentID }),
          })))
          if (disposed) return
          const next: string[] = []
          for (const { parentID, response } of responses) {
            for (const child of childSessions(response)) {
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
      hydrationRetryAfter.clear()
      hydratedTreeRoots.clear()
      hydratingTreeRoots.clear()
      treeRetryAfter.clear()
      listeners.clear()
    },
  }
}
