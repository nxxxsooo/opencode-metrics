// src/metrics.ts
import type { BarConfig, CacheReadCompleteness, MetricsAggregate, RequestMetrics } from "./types"

/**
 * Token estimation consistent with OpenCode internals:
 * OpenCode uses CHARS_PER_TOKEN = 4
 * See opencode/packages/opencode/src/util/token.ts
 */
export function estimateTokens(text: string, ratio: number): number {
  if (!text) return 0
  return Math.max(0, Math.round(text.length / ratio))
}

/**
 * Get display output token count (output + reasoning).
 * Prefer exact value, fall back to estimation.
 */
export function getDisplayOutputTokens(m: RequestMetrics): number {
  if (m.hasExactTokens) {
    return Math.max(0, m.exactOutputTokens + m.exactReasoningTokens)
  }
  return Math.max(0, m.estimatedOutputTokens)
}

/**
 * Get display input token count (including cache).
 * Exact value = input + cache.read + cache.write (total actually sent to model).
 * Fall back to estimation.
 */
export function getDisplayInputTokens(m: RequestMetrics): number {
  if (m.hasExactTokens) {
    return Math.max(0, m.exactInputTokens + m.exactCacheReadTokens + m.exactCacheWriteTokens)
  }
  return Math.max(0, m.estimatedInputTokens)
}

export function formatCacheRead(n: number, completeness: CacheReadCompleteness): string {
  if (completeness === "unknown") return "—"
  return `${formatTokens(n)}${completeness === "partial" ? "+" : ""}`
}

export function aggregateRequestMetrics(
  metrics: readonly RequestMetrics[],
  now: number,
): MetricsAggregate | null {
  if (metrics.length === 0) return null

  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let exactCacheCount = 0
  let requestStartTime = Number.POSITIVE_INFINITY
  let firstTokenTime: number | null = null
  let completeTime: number | null = null
  let isStreaming = false
  let isComplete = true

  for (const m of metrics) {
    inputTokens += getDisplayInputTokens(m)
    outputTokens += getDisplayOutputTokens(m)
    if (m.hasExactCacheReadTokens) {
      cacheReadTokens += Math.max(0, m.exactCacheReadTokens)
      exactCacheCount += 1
    }
    requestStartTime = Math.min(requestStartTime, m.requestStartTime)
    if (m.firstTokenTime !== null) {
      firstTokenTime = firstTokenTime === null ? m.firstTokenTime : Math.min(firstTokenTime, m.firstTokenTime)
    }
    if (m.completeTime !== null) {
      completeTime = completeTime === null ? m.completeTime : Math.max(completeTime, m.completeTime)
    }
    isStreaming = isStreaming || m.isStreaming
    isComplete = isComplete && m.isComplete
  }

  const cacheReadCompleteness: CacheReadCompleteness =
    exactCacheCount === 0 ? "unknown" : exactCacheCount === metrics.length ? "exact" : "partial"
  const ttft = firstTokenTime === null ? null : Math.round(firstTokenTime - requestStartTime)
  const sessionIDs = [...new Set(metrics.map((m) => m.sessionID))]

  return {
    sessionIDs,
    childSessionCount: Math.max(0, sessionIDs.length - 1),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheReadCompleteness,
    requestStartTime,
    firstTokenTime,
    completeTime: completeTime ?? (isComplete ? now : null),
    ttft,
    isStreaming,
    isComplete,
  }
}

/**
 * Calculate time to first token (milliseconds)
 */
export function getTtft(m: RequestMetrics): number | null {
  if (m.firstTokenTime === null) return null
  return Math.round(m.firstTokenTime - m.requestStartTime)
}

/**
 * Calculate average token speed (tokens/second).
 * Based on cumulative streaming time (now - firstTokenTime).
 */
export function getTps(m: RequestMetrics, now: number): number {
  const baseTime = m.firstTokenTime ?? m.requestStartTime
  const elapsedMs = now - baseTime
  if (elapsedMs <= 0) return 0
  const tokens = getDisplayOutputTokens(m)
  return Math.round((tokens / (elapsedMs / 1000)) * 10) / 10
}

/**
 * Format token count: show raw below 1000, otherwise X.XK
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  return (n / 1000).toFixed(1) + "K"
}

/**
 * Format duration (general):
 * - < 1000ms: "312ms"
 * - < 60000ms: "1.5s" / "15.0s"
 * - >= 60000ms: "2m5s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m${seconds}s`
}

/**
 * Format elapsed time (always in whole seconds to avoid UI jitter):
 * - < 60000ms: "0s" / "15s"
 * - >= 60000ms: "2m5s"
 */
export function formatElapsed(ms: number): string {
  ms = Math.max(0, ms)
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m${seconds}s`
}

/**
 * Format session-level elapsed time from a stable session start timestamp.
 */
export function formatSessionElapsed(now: number, sessionStartTime: number): string {
  return formatElapsed(now - sessionStartTime)
}

/**
 * Format the full status bar string.
 * Format: ⚡ 42.5 t/s  ⏱ TTFT 312ms  ↓ 1.2K in  ↑ 639 out  ○ cr 200  ▹ 15.0s  [model]
 * Control visibility of each metric via config.visible.
 */
export function formatBar(m: RequestMetrics, now: number, config?: BarConfig): string {
  const tps = getTps(m, now)
  const ttft = getTtft(m)
  const inputTokens = getDisplayInputTokens(m)
  const outputTokens = getDisplayOutputTokens(m)
  const cacheRead = m.hasExactCacheReadTokens ? Math.max(0, m.exactCacheReadTokens) : 0
  const elapsedMs = now - m.requestStartTime
  const vis = config?.visible

  const parts: string[] = []

  if (!vis || vis.speed)   parts.push(`⚡ ${tps.toFixed(1)} t/s`)
  if (!vis || vis.ttft)    parts.push(`⏱ ${ttft !== null ? formatDuration(ttft) : "--"}`)
  if (!vis || vis.input)   parts.push(`↓ ${formatTokens(inputTokens)} in`)
  if (!vis || vis.output)  parts.push(`↑ ${formatTokens(outputTokens)} out`)
  if ((!vis || vis.cache) && (m.hasExactTokens || m.hasExactCacheReadTokens)) {
    parts.push(`○ ${formatCacheRead(cacheRead, m.hasExactCacheReadTokens ? "exact" : "unknown")}`)
  }
  if (!vis || vis.elapsed) parts.push(`▹ ${formatElapsed(elapsedMs)}`)

  if (!vis || vis.model) {
    const modelLabel = m.providerID && m.modelID
      ? `${m.providerID}/${m.modelID}`
      : m.modelID || "unknown"
    parts.push(`[${modelLabel}]`)
  }

  return parts.join("  ")
}

/**
 * Create initial RequestMetrics.
 */
export function createFreshMetrics(
  sessionID: string,
  messageID: string,
  modelID: string,
  providerID: string,
  now: number,
): RequestMetrics {
  return {
    sessionID,
    messageID,
    modelID,
    providerID,
    requestStartTime: now,
    firstTokenTime: null,
    lastDeltaTime: null,
    completeTime: null,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    exactInputTokens: 0,
    exactOutputTokens: 0,
    exactCacheReadTokens: 0,
    exactCacheWriteTokens: 0,
    exactReasoningTokens: 0,
    hasExactTokens: false,
    hasExactCacheReadTokens: false,
    hasExactCacheWriteTokens: false,
    isStreaming: false,
    isComplete: false,
  }
}
