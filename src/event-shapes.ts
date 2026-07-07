export interface SessionInfoEvent {
  readonly id: string
  readonly parentID: string | null
  readonly hasParentID: boolean
}

export interface TextPartEvent {
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
  readonly modelID: string
  readonly providerID: string
  readonly tokens: AssistantTokenUpdate | null
}

export interface UserMessageEvent {
  readonly messageID: string
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
  const messageID = stringOrEmpty(value.messageID)
  const text = stringOrEmpty(value.text)
  if (messageID.length === 0 || text.length === 0) return null
  return { messageID, text }
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
  if (!isRecord(value) || value.role !== "assistant") return null
  return {
    modelID: stringOrEmpty(value.modelID),
    providerID: stringOrEmpty(value.providerID),
    tokens: parseAssistantTokens(value.tokens),
  }
}

export function parseUserMessage(value: unknown): UserMessageEvent | null {
  if (!isRecord(value) || value.role !== "user") return null
  return { messageID: stringOrEmpty(value.id) }
}
