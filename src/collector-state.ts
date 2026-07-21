import type { BarConfig, LiveSpeedState, RequestMetrics, TurnMetrics } from "./types"
import type { SessionTree } from "./session-tree"
import type { MetricsEventApi } from "./event-bus"
import type { SessionTiming } from "./session-timing"

export interface CollectorState {
  requests: Map<string, RequestMetrics>
  turns: Map<string, TurnMetrics>
  liveSpeeds: Map<string, LiveSpeedState>
  holdTimers: Map<string, ReturnType<typeof setTimeout>>
  sessionTree: SessionTree
  sessionModels: Map<string, { readonly modelID: string; readonly providerID: string }>
  sessionTimings: Map<string, SessionTiming>
  userMessageIds: Map<string, Set<string>>
  assistantMessageIds: Map<string, string>
  partTokenEstimates: Map<string, number>
  sessionAliases: Map<string, Set<string>>
  seenEventKeys: Set<string>
  seenEventOrder: string[]
  lastRequestSessionID: string | null
}

export interface CollectorActions {
  notify: () => void
  startSessionTiming: (sessionID: string, now: number) => void
  stopSessionTiming: (sessionID: string, now: number) => void
  clearHoldTimer: (sessionID: string) => void
}

export interface EventHandlerContext {
  readonly api: MetricsEventApi
  readonly config: BarConfig
  readonly log: (msg: string) => void
  readonly state: CollectorState
  readonly actions: CollectorActions
}
