import type { RequestMetrics } from "./types"
import { createFreshMetrics } from "./metrics"
import { applySessionModel } from "./request-updates"
import { clearLiveSpeed, resetLiveSpeed } from "./live-speed"
import { completeTurn, ensureTurn, retireRequestIntoTurn, startTurn } from "./turn-state"
import type { LiveSpeedState, TurnMetrics } from "./types"

export interface RequestState {
  readonly requests: Map<string, RequestMetrics>
  readonly turns: Map<string, TurnMetrics>
  readonly liveSpeeds: Map<string, LiveSpeedState>
  readonly sessionModels: Map<string, { readonly modelID: string; readonly providerID: string }>
  lastRequestSessionID: string | null
}

export interface RequestActions {
  readonly clearHoldTimer: (sessionID: string) => void
  readonly startSessionTiming: (sessionID: string, now: number) => void
  readonly stopSessionTiming: (sessionID: string, now: number) => void
  readonly notify: () => void
}

export interface CurrentRequestInput {
  readonly state: RequestState
  readonly actions: RequestActions
  readonly sessionID: string
  readonly messageID: string
  readonly now: number
}

export function currentRequest(input: CurrentRequestInput): RequestMetrics {
  const existing = input.state.requests.get(input.sessionID)
  const isDifferentMessage = existing?.messageID.length ? existing.messageID !== input.messageID : false
  if (!existing || isDifferentMessage) {
    const priorTurn = input.state.turns.get(input.sessionID)
    const startsAfterCompletedTurn = Boolean(priorTurn?.isComplete && isDifferentMessage)
    const turn = startsAfterCompletedTurn
      ? startTurn(input.state.turns, input.sessionID, input.now)
      : ensureTurn(input.state.turns, input.sessionID, existing?.requestStartTime ?? input.now)
    if (existing && isDifferentMessage && !startsAfterCompletedTurn) retireRequestIntoTurn(turn, existing)
    const current = createFreshMetrics(
      input.sessionID,
      input.messageID,
      existing?.modelID ?? "",
      existing?.providerID ?? "",
      input.now,
    )
    applySessionModel(current, input.state.sessionModels.get(input.sessionID))
    input.state.requests.set(input.sessionID, current)
    resetLiveSpeed(input.state.liveSpeeds, input.sessionID, input.messageID)
    input.state.lastRequestSessionID = input.sessionID
    input.actions.clearHoldTimer(input.sessionID)
    return current
  }
  if (existing.messageID.length === 0) {
    existing.messageID = input.messageID
  }
  input.state.lastRequestSessionID = input.sessionID
  return existing
}

export interface CompleteRequestInput {
  readonly state: RequestState & { readonly holdTimers: Map<string, ReturnType<typeof setTimeout>> }
  readonly actions: RequestActions
  readonly sessionID: string
  readonly now: number
  readonly holdDurationMs: number
  readonly log: (msg: string) => void
}

export function completeRequest(input: CompleteRequestInput): void {
  const current = input.state.requests.get(input.sessionID)
  input.actions.stopSessionTiming(input.sessionID, input.now)
  const turn = input.state.turns.get(input.sessionID)
  if (current && turn) retireRequestIntoTurn(turn, current)
  if (turn) completeTurn(turn, input.now)
  clearLiveSpeed(input.state.liveSpeeds, input.sessionID)
  if (!current) return
  current.isStreaming = false
  current.isComplete = true
  current.completeTime = input.now
  input.log(`request complete: session=${input.sessionID}`)
  input.actions.notify()
  if (input.holdDurationMs <= 0) return
  input.actions.clearHoldTimer(input.sessionID)
  input.state.holdTimers.set(input.sessionID, setTimeout(() => {
    input.state.holdTimers.delete(input.sessionID)
    if (input.state.requests.get(input.sessionID)?.sessionID === input.sessionID) {
      input.state.requests.delete(input.sessionID)
      input.actions.notify()
    }
  }, input.holdDurationMs))
}
