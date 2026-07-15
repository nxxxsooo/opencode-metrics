import { createFreshMetrics } from "./metrics"
import { parseAssistantMessage } from "./event-shapes"
import { applyAssistantTokens, hasPositiveAssistantTokens } from "./request-updates"
import type { RequestMetrics } from "./types"
import type { SessionTiming } from "./session-timing"

export interface HydrationApi {
  readonly state: {
    readonly session: {
      messages(sessionID: string): readonly unknown[]
      status(sessionID: string): unknown
    }
  }
}

export interface HydrationState {
  readonly requests: Map<string, RequestMetrics>
  readonly sessionModels: Map<string, { readonly modelID: string; readonly providerID: string }>
  readonly sessionTimings: Map<string, SessionTiming>
  lastRequestSessionID: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isHydrationApi(value: unknown): value is HydrationApi {
  if (!isRecord(value)) return false
  const state = value.state
  if (!isRecord(state)) return false
  const session = state.session
  return isRecord(session) && typeof session.messages === "function" && typeof session.status === "function"
}

function statusKind(value: unknown): string {
  if (typeof value === "string") return value
  if (!isRecord(value)) return ""
  return typeof value.type === "string" ? value.type : ""
}

function messageInfo(value: unknown): unknown {
  if (!isRecord(value)) return value
  return isRecord(value.info) ? value.info : value
}

function toPerformanceTime(wallTime: number | null, now: number): number | null {
  if (wallTime === null) return null
  return now - Math.max(0, Date.now() - wallTime)
}

export interface HydrateSessionInput {
  readonly api: HydrationApi
  readonly state: HydrationState
  readonly sessionID: string
  readonly now: number
}

export function hydrateSession(input: HydrateSessionInput): boolean {
  const assistants = input.api.state.session
    .messages(input.sessionID)
    .map(messageInfo)
    .map(parseAssistantMessage)
    .filter((message): message is NonNullable<typeof message> => message !== null && hasPositiveAssistantTokens(message.tokens))
  const assistant = assistants.at(-1)
  if (!assistant || !hasPositiveAssistantTokens(assistant.tokens)) return false

  const existing = input.state.requests.get(input.sessionID)
  if (existing && !existing.isComplete && existing.messageID !== assistant.messageID) return false
  const requestStartTime = toPerformanceTime(assistant.createdTime, input.now) ?? input.now
  const completedTime = toPerformanceTime(assistant.completedTime, input.now)
  const shouldReuseExisting = existing?.messageID === assistant.messageID

  const current = shouldReuseExisting ? existing : createFreshMetrics(
    input.sessionID,
    assistant.messageID,
    assistant.modelID,
    assistant.providerID,
    requestStartTime,
  )
  if (!shouldReuseExisting || !current.isComplete) {
    current.requestStartTime = requestStartTime
  }
  current.messageID = assistant.messageID
  current.modelID = assistant.modelID
  current.providerID = assistant.providerID
  current.lastDeltaTime = current.lastDeltaTime ?? completedTime ?? input.now
  current.isStreaming = !assistant.completed && statusKind(input.api.state.session.status(input.sessionID)) !== "idle"
  current.isComplete = assistant.completed || !current.isStreaming
  if (current.isComplete && current.completeTime === null) {
    current.completeTime = completedTime ?? input.now
  }
  if (!current.isComplete) {
    current.completeTime = null
    current.lastDeltaTime = input.now
  }
  applyAssistantTokens(current, assistant.tokens)

  input.state.requests.set(input.sessionID, current)
  input.state.lastRequestSessionID = input.sessionID
  if (assistant.modelID || assistant.providerID) {
    input.state.sessionModels.set(input.sessionID, { modelID: assistant.modelID, providerID: assistant.providerID })
  }
  if (!input.state.sessionTimings.has(input.sessionID)) {
    const completedElapsedMs = assistants.reduce((total, message) => {
      if (message.createdTime === null || message.completedTime === null) return total
      return total + Math.max(0, message.completedTime - message.createdTime)
    }, 0)
    input.state.sessionTimings.set(input.sessionID, {
      elapsedMs: completedElapsedMs,
      activeSince: current.isComplete ? null : requestStartTime,
    })
  }
  return true
}
