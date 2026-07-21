export interface SessionInfoEvent {
  readonly id: string
  readonly parentID: string | null
  readonly hasParentID: boolean
}

export interface TextPartEvent {
  readonly partID: string
  readonly messageID: string
  readonly text: string
}

export interface AssistantTokenUpdate {
  readonly hasAny: boolean
  readonly hasCacheRead: boolean
  readonly hasCacheWrite: boolean
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

export interface AssistantMessageEvent {
  readonly messageID: string
  readonly modelID: string
  readonly providerID: string
  readonly tokens: AssistantTokenUpdate | null
  readonly completed: boolean
  readonly createdTime: number | null
  readonly completedTime: number | null
}

export interface UserMessageEvent {
  readonly messageID: string
  readonly createdTime: number | null
}

export interface AssistantStepStartedEvent {
  readonly sessionID: string
  readonly messageID: string
  readonly modelID: string
  readonly providerID: string
}

export interface AssistantTextDeltaEvent {
  readonly sessionID: string
  readonly messageID: string
  readonly partID: string
  readonly delta: string
}

export interface AssistantStepEndedEvent {
  readonly sessionID: string
  readonly messageID: string
  readonly tokens: AssistantTokenUpdate
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0
}

function timestampOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

export function parseSessionInfo(value: unknown): SessionInfoEvent | null {
  if (!isRecord(value)) return null
  const id = stringOrEmpty(value.id)
  if (id.length === 0) return null
  const hasParentID = hasOwn(value, "parentID")
  return {
    id,
    parentID: typeof value.parentID === "string" ? value.parentID : null,
    hasParentID,
  }
}

export function parseTextPart(value: unknown): TextPartEvent | null {
  if (!isRecord(value)) return null
  if (value.type !== "text") return null
  const partID = stringOrEmpty(value.id)
  const messageID = stringOrEmpty(value.messageID)
  const text = stringOrEmpty(value.text)
  if (partID.length === 0 || messageID.length === 0 || text.length === 0) return null
  return { partID, messageID, text }
}

export function parseAssistantProgressPart(value: unknown): TextPartEvent | null {
  if (!isRecord(value)) return null
  if (value.type !== "text" && value.type !== "reasoning") return null
  const partID = stringOrEmpty(value.id)
  const messageID = stringOrEmpty(value.messageID)
  const text = stringOrEmpty(value.text)
  if (partID.length === 0 || messageID.length === 0 || text.length === 0) return null
  return { partID, messageID, text }
}

function parseAssistantTokens(value: unknown): AssistantTokenUpdate | null {
  if (!isRecord(value)) return null
  const cache = isRecord(value.cache) ? value.cache : null
  const hasInput = hasOwn(value, "input")
  const hasOutput = hasOwn(value, "output")
  const hasReasoning = hasOwn(value, "reasoning")
  const hasCacheRead = cache !== null && hasOwn(cache, "read")
  const hasCacheWrite = cache !== null && hasOwn(cache, "write")

  return {
    hasAny: hasInput || hasOutput || hasReasoning || hasCacheRead || hasCacheWrite,
    hasCacheRead,
    hasCacheWrite,
    input: nonNegativeNumber(value.input),
    output: nonNegativeNumber(value.output),
    reasoning: nonNegativeNumber(value.reasoning),
    cacheRead: nonNegativeNumber(cache?.read),
    cacheWrite: nonNegativeNumber(cache?.write),
  }
}

export function parseAssistantMessage(value: unknown): AssistantMessageEvent | null {
  if (!isRecord(value)) return null
  const time = isRecord(value.time) ? value.time : null
  const createdTime = timestampOrNull(time?.created)
  const completedTime = timestampOrNull(time?.completed)
  if (value.role === "assistant") {
    return {
      messageID: stringOrEmpty(value.id),
      modelID: stringOrEmpty(value.modelID),
      providerID: stringOrEmpty(value.providerID),
      tokens: parseAssistantTokens(value.tokens),
      completed: completedTime !== null,
      createdTime,
      completedTime,
    }
  }
  if (value.type !== "assistant") return null
  const model = isRecord(value.model) ? value.model : null
  return {
    messageID: stringOrEmpty(value.id),
    modelID: stringOrEmpty(model?.id),
    providerID: stringOrEmpty(model?.providerID),
    tokens: parseAssistantTokens(value.tokens),
    completed: completedTime !== null,
    createdTime,
    completedTime,
  }
}

export function parseUserMessage(value: unknown): UserMessageEvent | null {
  if (!isRecord(value) || value.role !== "user") return null
  const time = isRecord(value.time) ? value.time : null
  return { messageID: stringOrEmpty(value.id), createdTime: timestampOrNull(time?.created) }
}

export function parseAssistantStepStarted(value: unknown, fallbackMessageID = ""): AssistantStepStartedEvent | null {
  if (!isRecord(value)) return null
  const sessionID = stringOrEmpty(value.sessionID)
  const messageID = stringOrEmpty(value.assistantMessageID) || fallbackMessageID
  const model = isRecord(value.model) ? value.model : null
  if (sessionID.length === 0 || messageID.length === 0) return null
  return {
    sessionID,
    messageID,
    modelID: stringOrEmpty(model?.id),
    providerID: stringOrEmpty(model?.providerID),
  }
}

export function parseAssistantTextDelta(value: unknown, fallbackMessageID = ""): AssistantTextDeltaEvent | null {
  if (!isRecord(value)) return null
  const sessionID = stringOrEmpty(value.sessionID)
  const messageID = stringOrEmpty(value.assistantMessageID) || fallbackMessageID
  const partID = stringOrEmpty(value.textID) || stringOrEmpty(value.reasoningID) || `${messageID}:stream`
  const delta = stringOrEmpty(value.delta)
  if (sessionID.length === 0 || messageID.length === 0 || partID.length === 0 || delta.length === 0) return null
  return { sessionID, messageID, partID, delta }
}

export function parseAssistantStepEnded(value: unknown, fallbackMessageID = ""): AssistantStepEndedEvent | null {
  if (!isRecord(value)) return null
  const sessionID = stringOrEmpty(value.sessionID)
  const messageID = stringOrEmpty(value.assistantMessageID) || fallbackMessageID
  const tokens = parseAssistantTokens(value.tokens)
  if (sessionID.length === 0 || messageID.length === 0 || tokens === null) return null
  return { sessionID, messageID, tokens }
}
