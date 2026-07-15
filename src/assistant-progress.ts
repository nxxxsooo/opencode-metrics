import { estimateTokens } from "./metrics"
import { parseAssistantTextDelta } from "./event-shapes"
import { currentRequest } from "./request-state"
import { eventAggregateID, eventID, eventProperties, stringEventProperty } from "./event-bus"
import type { EventHandlerContext } from "./collector-state"

export interface AssistantProgressPart {
  readonly partID: string
  readonly messageID: string
  readonly text: string
}

function partEstimateKey(sessionID: string, partID: string): string {
  return `${sessionID}:${partID}`
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
  const current = currentRequest({ state, actions, sessionID, messageID, now })
  if (current.firstTokenTime === null) {
    current.firstTokenTime = now
  }

  const key = partEstimateKey(sessionID, partID)
  const nextTokens = estimateTokens(text, config.estimationRatio)
  const previousTokens = state.partTokenEstimates.get(key) ?? 0
  const deltaTokens = Math.max(0, nextTokens - previousTokens)
  state.partTexts.set(key, text)
  state.partTokenEstimates.set(key, nextTokens)
  if (deltaTokens > 0) {
    current.estimatedOutputTokens += deltaTokens
    current.lastDeltaTime = now
  }
  current.isStreaming = true
  actions.notify()
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
  const key = partEstimateKey(text.sessionID, text.partID)
  const previousText = state.partTexts.get(key) ?? ""
  applyAssistantText(ctx, text.sessionID, text.messageID, text.partID, `${previousText}${text.delta}`, now)
}
