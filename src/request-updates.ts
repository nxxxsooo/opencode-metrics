import type { AssistantMessageEvent, AssistantTokenUpdate } from "./event-shapes"
import type { RequestMetrics } from "./types"

export interface SessionModel {
  readonly modelID: string
  readonly providerID: string
}

export function mergeAssistantModel(
  existing: SessionModel | undefined,
  message: AssistantMessageEvent,
): SessionModel | null {
  const modelID = message.modelID || existing?.modelID || ""
  const providerID = message.providerID || existing?.providerID || ""
  return modelID || providerID ? { modelID, providerID } : null
}

export function applySessionModel(metrics: RequestMetrics, model: SessionModel | undefined): void {
  if (!model) return
  metrics.modelID = model.modelID
  metrics.providerID = model.providerID
}

export function hasPositiveAssistantTokens(tokens: AssistantTokenUpdate | null | undefined): tokens is AssistantTokenUpdate {
  if (!tokens?.hasAny) return false
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite > 0
}

export function applyAssistantTokens(metrics: RequestMetrics, tokens: AssistantTokenUpdate): boolean {
  if (!hasPositiveAssistantTokens(tokens)) return false
  metrics.exactInputTokens = tokens.input
  metrics.exactOutputTokens = tokens.output
  metrics.exactReasoningTokens = tokens.reasoning
  metrics.exactCacheReadTokens = tokens.cacheRead
  metrics.exactCacheWriteTokens = tokens.cacheWrite
  metrics.hasExactTokens = true
  metrics.hasExactCacheReadTokens = tokens.hasCacheRead
  metrics.hasExactCacheWriteTokens = tokens.hasCacheWrite
  return true
}
