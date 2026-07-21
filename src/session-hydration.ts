import { createFreshMetrics } from "./metrics"
import { parseAssistantMessage, parseUserMessage } from "./event-shapes"
import { applyAssistantTokens, hasPositiveAssistantTokens } from "./request-updates"
import type { RequestMetrics, TurnMetrics } from "./types"
import type { SessionTiming } from "./session-timing"
import { completeTurn, createTurnMetrics, retireRequestIntoTurn } from "./turn-state"

export interface HydrationApi {
  readonly state: {
    readonly session: {
      messages(sessionID: string): readonly unknown[]
      status(sessionID: string): unknown
    }
    readonly part?: (messageID: string) => readonly unknown[]
  }
}

export interface HydrationState {
  readonly requests: Map<string, RequestMetrics>
  readonly turns: Map<string, TurnMetrics>
  readonly sessionModels: Map<string, { readonly modelID: string; readonly providerID: string }>
  readonly sessionTimings: Map<string, SessionTiming>
  lastRequestSessionID: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function timestampOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
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

function observablePartTimes(api: HydrationApi, messageID: string, now: number): {
  readonly first: number | null
  readonly last: number | null
} {
  if (typeof api.state.part !== "function") return { first: null, last: null }
  let firstWall: number | null = null
  let lastWall: number | null = null
  for (const value of api.state.part(messageID)) {
    if (!isRecord(value) || (value.type !== "text" && value.type !== "reasoning")) continue
    const time = isRecord(value.time) ? value.time : null
    const start = timestampOrNull(time?.start)
    const end = timestampOrNull(time?.end)
    if (start !== null) firstWall = firstWall === null ? start : Math.min(firstWall, start)
    if (end !== null) lastWall = lastWall === null ? end : Math.max(lastWall, end)
  }
  return { first: toPerformanceTime(firstWall, now), last: toPerformanceTime(lastWall, now) }
}

function hydrateSessionTiming(
  rawMessages: readonly unknown[],
  status: string,
  now: number,
): SessionTiming {
  const intervals: Array<{ start: number; end: number }> = []
  const hasUserBoundary = rawMessages.some((raw) => parseUserMessage(messageInfo(raw)) !== null)
  if (!hasUserBoundary) {
    for (const raw of rawMessages) {
      const assistant = parseAssistantMessage(messageInfo(raw))
      const start = toPerformanceTime(assistant?.createdTime ?? null, now)
      const end = toPerformanceTime(assistant?.completedTime ?? null, now)
      if (start !== null && end !== null && end >= start) intervals.push({ start, end })
    }
    const elapsedMs = Math.round(intervals.reduce((total, interval) => total + Math.max(0, interval.end - interval.start), 0))
    return { elapsedMs, activeSince: null, intervals }
  }
  let groupStartWall: number | null = null
  let groupEndWall: number | null = null

  function closeGroup(): void {
    const start = toPerformanceTime(groupStartWall, now)
    const end = toPerformanceTime(groupEndWall, now)
    if (start !== null && end !== null && end >= start) intervals.push({ start, end })
  }

  for (const raw of rawMessages) {
    const info = messageInfo(raw)
    const user = parseUserMessage(info)
    if (user) {
      if (groupStartWall !== null) closeGroup()
      groupStartWall = user.createdTime
      groupEndWall = null
      continue
    }
    const assistant = parseAssistantMessage(info)
    if (!assistant) continue
    groupStartWall ??= assistant.createdTime
    if (assistant.completedTime !== null) {
      groupEndWall = groupEndWall === null
        ? assistant.completedTime
        : Math.max(groupEndWall, assistant.completedTime)
    }
  }

  const activeSince = status === "idle" ? null : toPerformanceTime(groupStartWall, now)
  if (activeSince === null && groupStartWall !== null) closeGroup()
  const elapsedMs = Math.round(intervals.reduce((total, interval) => total + Math.max(0, interval.end - interval.start), 0))
  return { elapsedMs, activeSince, intervals }
}

export interface HydrateSessionInput {
  readonly api: HydrationApi
  readonly state: HydrationState
  readonly sessionID: string
  readonly now: number
}

export function hydrateSession(input: HydrateSessionInput): boolean {
  const rawMessages = input.api.state.session.messages(input.sessionID)
  const infos = rawMessages.map(messageInfo)
  const assistants = infos
    .map(parseAssistantMessage)
    .filter((message): message is NonNullable<typeof message> => message !== null && hasPositiveAssistantTokens(message.tokens))
  const assistant = assistants.at(-1)
  if (!assistant || !hasPositiveAssistantTokens(assistant.tokens)) return false

  let lastUserIndex = -1
  for (let index = infos.length - 1; index >= 0; index -= 1) {
    if (parseUserMessage(infos[index])) {
      lastUserIndex = index
      break
    }
  }
  const trailingAssistants = infos
    .slice(lastUserIndex + 1)
    .map(parseAssistantMessage)
    .filter((message): message is NonNullable<typeof message> => message !== null && hasPositiveAssistantTokens(message.tokens))
  const lastUser = lastUserIndex >= 0 ? parseUserMessage(infos[lastUserIndex]) : null

  const existing = input.state.requests.get(input.sessionID)
  if (existing && !existing.isComplete && existing.messageID !== assistant.messageID) return false
  const requestStartTime = toPerformanceTime(assistant.createdTime, input.now) ?? input.now
  const completedTime = toPerformanceTime(assistant.completedTime, input.now)
  const sessionStatus = statusKind(input.api.state.session.status(input.sessionID))
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
  const partTimes = observablePartTimes(input.api, assistant.messageID, input.now)
  current.firstTokenTime = current.firstTokenTime ?? partTimes.first
  current.lastDeltaTime = current.lastDeltaTime ?? partTimes.last ?? completedTime ?? input.now
  current.isStreaming = !assistant.completed && sessionStatus !== "idle"
  current.isComplete = assistant.completed || !current.isStreaming
  if (current.isComplete && current.completeTime === null) {
    current.completeTime = completedTime ?? input.now
  }
  if (!current.isComplete) {
    current.completeTime = null
    current.lastDeltaTime = input.now
  }
  applyAssistantTokens(current, assistant.tokens)

  const turnStartTime = toPerformanceTime(
    lastUser?.createdTime ?? trailingAssistants[0]?.createdTime ?? assistant.createdTime,
    input.now,
  ) ?? requestStartTime
  const turn = createTurnMetrics(input.sessionID, turnStartTime)
  for (const step of trailingAssistants) {
    if (!step.tokens || !hasPositiveAssistantTokens(step.tokens)) continue
    const stepStart = toPerformanceTime(step.createdTime, input.now) ?? turnStartTime
    const stepMetrics = createFreshMetrics(
      input.sessionID,
      step.messageID,
      step.modelID,
      step.providerID,
      stepStart,
    )
    applyAssistantTokens(stepMetrics, step.tokens)
    retireRequestIntoTurn(turn, stepMetrics)
  }
  if (sessionStatus === "idle") completeTurn(turn, completedTime ?? input.now)
  input.state.turns.set(input.sessionID, turn)

  input.state.requests.set(input.sessionID, current)
  input.state.lastRequestSessionID = input.sessionID
  if (assistant.modelID || assistant.providerID) {
    input.state.sessionModels.set(input.sessionID, { modelID: assistant.modelID, providerID: assistant.providerID })
  }
  if (!input.state.sessionTimings.has(input.sessionID)) {
    input.state.sessionTimings.set(
      input.sessionID,
      hydrateSessionTiming(rawMessages, sessionStatus, input.now),
    )
  }
  return true
}
