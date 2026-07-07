// tests/integration.test.ts
import { describe, test, expect } from "bun:test"
import { createFreshMetrics, estimateTokens, formatBar, getDisplayOutputTokens } from "../src/metrics"
import type { RequestMetrics } from "../src/types"

/**
 * Simulate complete event flow:
 * 1. User message → initialize metrics
 * 2. Delta arrives → accumulate estimated tokens
 * 3. Assistant message → overwrite with exact tokens
 * 4. Idle → mark complete
 */
function simulateEventFlow(): {
  metrics: RequestMetrics
  now: () => number
  advanceTime: (ms: number) => void
} {
  let currentTime = 1000
  const now = () => currentTime
  const advanceTime = (ms: number) => { currentTime += ms }

  let metrics = createFreshMetrics("ses_test", "msg_assist_1", "", "", now())

  // Event 1: delta arrives (multiple)
  advanceTime(500)
  metrics.firstTokenTime = now()
  metrics.estimatedOutputTokens += estimateTokens("Hello, how can I", 4)
  advanceTime(200)
  metrics.estimatedOutputTokens += estimateTokens(" help you today?", 4)
  metrics.lastDeltaTime = now()

  advanceTime(300)

  // Event 2: assistant message update → exact tokens
  metrics.exactInputTokens = 1500
  metrics.exactOutputTokens = 450
  metrics.exactReasoningTokens = 50
  metrics.exactCacheReadTokens = 200
  metrics.hasExactTokens = true
  metrics.modelID = "claude-sonnet-4"
  metrics.providerID = "anthropic"

  advanceTime(2000)

  // Event 3: idle
  metrics.isStreaming = false
  metrics.isComplete = true
  metrics.completeTime = now()

  return { metrics, now, advanceTime }
}

describe("Complete event flow", () => {
  test("simulates a complete request event sequence", () => {
    const { metrics } = simulateEventFlow()

    expect(metrics.sessionID).toBe("ses_test")
    expect(metrics.firstTokenTime).not.toBeNull()
    expect(metrics.hasExactTokens).toBe(true)
    expect(metrics.isComplete).toBe(true)

    expect(getDisplayOutputTokens(metrics)).toBe(500)
    expect(metrics.exactInputTokens).toBe(1500)
    expect(metrics.exactCacheReadTokens).toBe(200)
  })

  test("formatBar output is complete after idle", () => {
    const { metrics, now } = simulateEventFlow()

    const result = formatBar(metrics, now())
    expect(result).toContain("⚡")
    expect(result).toContain("t/s")
    expect(result).toContain("⏱")
    expect(result).toContain("↓")
    expect(result).toContain("in")
    expect(result).toContain("↑")
    expect(result).toContain("out")
    expect(result).toContain("○")
    expect(result).toContain("▹")
    expect(result).toContain("claude-sonnet-4")
    expect(result).not.toContain("undefined")
    expect(result).not.toContain("NaN")
  })
})

describe("Edge cases", () => {
  test("does not crash when firstTokenTime is null", () => {
    const m = createFreshMetrics("ses_err", "msg_err", "", "", 1000)
    const result = formatBar(m, 2000)
    expect(result).toContain("⏱ --")
  })

  test("shows unknown when modelID is empty", () => {
    const m = createFreshMetrics("ses_err", "msg_err", "", "", 1000)
    const result = formatBar(m, 5000)
    expect(result).toContain("[unknown]")
  })

  test("negative token values are clamped to 0", () => {
    const m = createFreshMetrics("ses_err", "msg_err", "", "", 1000)
    m.exactInputTokens = -100
    m.exactOutputTokens = -50
    m.exactCacheReadTokens = -200
    m.hasExactTokens = true
    m.hasExactCacheReadTokens = true
    expect(getDisplayOutputTokens(m)).toBe(0)
    const result = formatBar(m, 5000)
    expect(result).toContain("↓ 0 in")
    expect(result).toContain("↑ 0 out")
    expect(result).toContain("○ 0")
  })

  test("child session events remain available for tree scope", () => {
    const isChildSession = (session: { readonly id: string; readonly parentID?: string }) => Boolean(session.parentID)

    expect(isChildSession({ id: "ses_main" })).toBe(false)
    expect(isChildSession({ id: "ses_child", parentID: "ses_main" })).toBe(true)
  })
})

describe("Concurrent requests", () => {
  test("new request discards old request metrics", () => {
    const m1 = createFreshMetrics("ses_1", "msg_1", "gpt-4o", "openai", 1000)
    m1.estimatedOutputTokens = 200
    m1.firstTokenTime = 1200

    const m2 = createFreshMetrics("ses_2", "msg_2", "claude-sonnet-4", "anthropic", 5000)

    expect(m2.estimatedOutputTokens).toBe(0)
    expect(m2.firstTokenTime).toBeNull()
    expect(m2.requestStartTime).toBe(5000)
    expect(m1.estimatedOutputTokens).toBe(200)
  })
})
