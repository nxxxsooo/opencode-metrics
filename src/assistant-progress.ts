import { estimateTokens } from "./metrics"
import { parseAssistantTextDelta } from "./event-shapes"
import { currentRequest } from "./request-state"
import { eventAggregateID, eventID, eventProperties, stringEventProperty } from "./event-bus"
import type { EventHandlerContext } from "./collector-state"
import { recordLiveTokens } from "./live-speed"

export interface AssistantProgressPart {
  readonly partID: string
  readonly messageID: string
  readonly text: string
}

function partEstimateKey(sessionID: string, messageID: string, partID: string): string {
  return `${sessionID}:${messageID}:${partID}`
}

function applyTokenDelta(
  ctx: EventHandlerContext,
  sessionID: string,
  messageID: string,
  deltaTokens: number,
  now: number,
): void {
  const { actions, state } = ctx
  if (state.turns.get(sessionID)?.finalizedSteps.has(messageID)) return
  const current = currentRequest({ state, actions, sessionID, messageID, now })
  if (current.firstTokenTime === null) current.firstTokenTime = now
  if (deltaTokens > 0) {
    current.estimatedOutputTokens += deltaTokens
    current.lastDeltaTime = now
    recordLiveTokens(state.liveSpeeds, sessionID, messageID, deltaTokens, now)
  }
  current.isStreaming = true
  actions.notify()
}

function applyAssistantText(
  ctx: EventHandlerContext,
  sessionID: string,
  messageID: string,
  partID: string,
  text: string,
  now: number,
): void {
  const { actions, config, state } = ctx
  const key = partEstimateKey(sessionID, messageID, partID)
  const nextTokens = estimateTokens(text, config.estimationRatio)
  const previousTokens = state.partTokenEstimates.get(key) ?? 0
  const deltaTokens = Math.max(0, nextTokens - previousTokens)
  state.partTokenEstimates.set(key, Math.max(previousTokens, nextTokens))
  applyTokenDelta(ctx, sessionID, messageID, deltaTokens, now)
}

export function applyAssistantProgress(
  ctx: EventHandlerContext,
  sessionID: string,
  part: AssistantProgressPart,
  now: number,
): void {
  applyAssistantText(ctx, sessionID, part.messageID, part.partID, part.text, now)
}

export function applyAssistantDelta(ctx: EventHandlerContext, event: unknown): void {
  const { actions, state } = ctx
  const sessionID = stringEventProperty(event, "sessionID")
  const fallbackMessageID = sessionID.length > 0 ? state.assistantMessageIds.get(sessionID) ?? eventID(event) : eventID(event)
  const text = parseAssistantTextDelta(eventProperties(event), fallbackMessageID)
  if (!text) return
  const aggregateID = eventAggregateID(event)
  if (aggregateID.length > 0 && aggregateID !== text.sessionID) {
    const aggregateAliases = state.sessionAliases.get(aggregateID) ?? new Set<string>()
    aggregateAliases.add(text.sessionID)
    state.sessionAliases.set(aggregateID, aggregateAliases)
    const sessionAliases = state.sessionAliases.get(text.sessionID) ?? new Set<string>()
    sessionAliases.add(aggregateID)
    state.sessionAliases.set(text.sessionID, sessionAliases)
  }
  const now = performance.now()
  actions.startSessionTiming(text.sessionID, now)
  const key = partEstimateKey(text.sessionID, text.messageID, text.partID)
  const deltaTokens = estimateTokens(text.delta, ctx.config.estimationRatio)
  state.partTokenEstimates.set(key, (state.partTokenEstimates.get(key) ?? 0) + deltaTokens)
  applyTokenDelta(ctx, text.sessionID, text.messageID, deltaTokens, now)
}

export function applyAssistantPartDelta(
  ctx: EventHandlerContext,
  sessionID: string,
  messageID: string,
  partID: string,
  delta: string,
  now: number,
): void {
  const key = partEstimateKey(sessionID, messageID, partID)
  const deltaTokens = estimateTokens(delta, ctx.config.estimationRatio)
  ctx.state.partTokenEstimates.set(key, (ctx.state.partTokenEstimates.get(key) ?? 0) + deltaTokens)
  applyTokenDelta(ctx, sessionID, messageID, deltaTokens, now)
}
