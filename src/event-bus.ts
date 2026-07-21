export interface MetricsEventApi {
  readonly event: {
    on(type: string, handler: (event: unknown) => void): () => void
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function syncEvent(event: unknown): Record<string, unknown> | null {
  if (!isRecord(event)) return null
  const sync = event.syncEvent
  return isRecord(sync) ? sync : null
}

export function eventProperties(event: unknown): unknown {
  if (!isRecord(event)) return null
  if (Object.prototype.hasOwnProperty.call(event, "properties")) return event.properties
  if (Object.prototype.hasOwnProperty.call(event, "data")) return event.data
  const sync = syncEvent(event)
  if (sync && Object.prototype.hasOwnProperty.call(sync, "data")) return sync.data
  return null
}

export function eventID(event: unknown): string {
  if (!isRecord(event)) return ""
  const sync = syncEvent(event)
  if (sync && typeof sync.id === "string") return sync.id
  return typeof event.id === "string" ? event.id : ""
}

export function eventAggregateID(event: unknown): string {
  const sync = syncEvent(event)
  if (sync && typeof sync.aggregateID === "string") return sync.aggregateID
  if (!isRecord(event) || !isRecord(event.durable)) return ""
  return typeof event.durable.aggregateID === "string" ? event.durable.aggregateID : ""
}

export function eventProperty(event: unknown, key: string): unknown {
  const properties = eventProperties(event)
  if (!isRecord(properties) || !Object.prototype.hasOwnProperty.call(properties, key)) return null
  return properties[key]
}

export function stringEventProperty(event: unknown, key: string): string {
  const value = eventProperty(event, key)
  return typeof value === "string" ? value : ""
}

export function statusType(event: unknown): string {
  const status = eventProperty(event, "status")
  if (!isRecord(status)) return ""
  return typeof status.type === "string" ? status.type : ""
}

export function isMetricsEventApi(value: unknown): value is MetricsEventApi {
  if (!isRecord(value)) return false
  const event = value.event
  return isRecord(event) && typeof event.on === "function"
}
