// tests/metrics.test.ts
import { describe, test, expect } from "bun:test"
import {
  estimateTokens,
  getDisplayOutputTokens,
  getDisplayInputTokens,
  getTtft,
  getTps,
  formatTokens,
  formatDuration,
  formatElapsed,
  formatSessionElapsed,
  formatBar,
  createFreshMetrics,
  aggregateRequestMetrics,
  formatCacheRead,
} from "../src/metrics"

describe("estimateTokens", () => {
  test("empty string returns 0", () => {
    expect(estimateTokens("", 4)).toBe(0)
  })

  test("English text estimated by ratio", () => {
    expect(estimateTokens("Hello World!", 4)).toBe(3)
  })

  test("Chinese text estimated by ratio", () => {
    expect(estimateTokens("你好世界", 4)).toBeCloseTo(2.4)
  })

  test("ratio 3 is more conservative", () => {
    expect(estimateTokens("Hello World!", 3)).toBe(4)
  })
})

describe("getDisplayOutputTokens", () => {
  test("returns exact value when available", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    m.exactOutputTokens = 500
    m.exactReasoningTokens = 100
    m.hasExactTokens = true
    m.estimatedOutputTokens = 200
    expect(getDisplayOutputTokens(m)).toBe(600)
  })

  test("falls back to estimation when no exact value", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    m.estimatedOutputTokens = 350
    expect(getDisplayOutputTokens(m)).toBe(350)
  })
})

describe("getDisplayInputTokens", () => {
  test("returns exact input tokens when available", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    m.exactInputTokens = 1200
    m.exactCacheReadTokens = 300
    m.hasExactCacheReadTokens = true
    m.hasExactTokens = true
    expect(getDisplayInputTokens(m)).toBe(1500)
  })

  test("returns 0 when no exact value", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    expect(getDisplayInputTokens(m)).toBe(0)
  })
})

describe("getTtft", () => {
  test("returns difference when firstTokenTime exists", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    m.firstTokenTime = 1500
    expect(getTtft(m)).toBe(500)
  })

  test("returns null when firstTokenTime is missing", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    expect(getTtft(m)).toBeNull()
  })
})

describe("getTps", () => {
  test("keeps the legacy status-bar average token speed helper", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    m.firstTokenTime = 1500
    m.exactOutputTokens = 450
    m.exactReasoningTokens = 50
    m.hasExactTokens = true
    expect(getTps(m, 11500)).toBe(50)
  })

  test("uses estimation during streaming", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    m.firstTokenTime = 1500
    m.estimatedOutputTokens = 300
    expect(getTps(m, 4500)).toBe(100)
  })

  test("returns 0 when elapsed is 0", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    m.firstTokenTime = 1000
    m.estimatedOutputTokens = 100
    expect(getTps(m, 1000)).toBe(0)
  })
})

describe("formatTokens", () => {
  test("below 1000 no scaling", () => expect(formatTokens(999)).toBe("999"))
  test("1000+ shows K", () => expect(formatTokens(1200)).toBe("1.2K"))
  test("10000+ shows K", () => expect(formatTokens(42500)).toBe("42.5K"))
})

describe("formatDuration", () => {
  test("below 1000ms shows milliseconds", () => expect(formatDuration(312)).toBe("312ms"))
  test("1000ms+ shows seconds", () => expect(formatDuration(1500)).toBe("1.5s"))
  test("10000ms+ shows seconds", () => expect(formatDuration(15000)).toBe("15.0s"))
  test("60000ms+ shows minutes:seconds", () => expect(formatDuration(125000)).toBe("2m5s"))
})

describe("formatElapsed", () => {
  test("300ms shows 0s", () => expect(formatElapsed(300)).toBe("0s"))
  test("1500ms shows 1s", () => expect(formatElapsed(1500)).toBe("1s"))
  test("15000ms shows 15s", () => expect(formatElapsed(15000)).toBe("15s"))
  test("125000ms shows 2m5s", () => expect(formatElapsed(125000)).toBe("2m5s"))
})

describe("formatSessionElapsed", () => {
  test("computes elapsed from session start timestamp", () => {
    expect(formatSessionElapsed(61000, 1000)).toBe("1m0s")
  })

  test("formats sub-minute durations", () => {
    expect(formatSessionElapsed(16000, 1000)).toBe("15s")
  })

  test("zero elapsed shows 0s", () => {
    expect(formatSessionElapsed(5000, 5000)).toBe("0s")
  })

  test("negative difference clamped to 0s", () => {
    expect(formatSessionElapsed(1000, 5000)).toBe("0s")
  })
})

describe("formatBar", () => {
  test("full format output", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    m.firstTokenTime = 1312
    m.exactInputTokens = 1200
    m.exactOutputTokens = 600
    m.exactReasoningTokens = 39
    m.exactCacheReadTokens = 200
    m.hasExactCacheReadTokens = true
    m.hasExactTokens = true
    m.modelID = "claude-sonnet-4"
    m.providerID = "anthropic"

    const result = formatBar(m, 16000)
    expect(result).toContain("⚡")
    expect(result).toContain("t/s")
    expect(result).toContain("⏱")
    expect(result).not.toContain("TTFT")
    expect(result).toContain("↓ 1.4K in")
    expect(result).toContain("↑")
    expect(result).toContain("out")
    expect(result).toContain("○ 200")
    expect(result).toContain("▹")
    expect(result).toContain("[anthropic/claude-sonnet-4]")
  })

  test("TTFT shows -- when no first token", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    const result = formatBar(m, 2000)
    expect(result).toContain("⏱ --")
  })

  test("still shows input line when input tokens is 0", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    const result = formatBar(m, 2000)
    expect(result).toContain("↓ 0 in")
  })

  test("visible config can hide metrics", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "claude-sonnet-4", "anthropic", 1000)
    m.firstTokenTime = 1100
    m.estimatedOutputTokens = 100
    const config = {
      refreshIntervalMs: 200, holdDurationMs: 5000, estimationRatio: 4, enableLogging: false,
      visible: { speed: true, ttft: false, input: false, output: true, cache: false, elapsed: false, session: false, model: false },
    }
    const result = formatBar(m, 2000, config)
    expect(result).toContain("⚡")
    expect(result).toContain("↑")
    expect(result).not.toContain("⏱")
    expect(result).not.toContain("↓")
    expect(result).not.toContain("○")
    expect(result).not.toContain("▹")
    expect(result).not.toContain("[")
  })
})

describe("createFreshMetrics", () => {
  test("initializes default values", () => {
    const m = createFreshMetrics("ses_1", "msg_1", "gpt-4o", "openai", 1000)
    expect(m.sessionID).toBe("ses_1")
    expect(m.messageID).toBe("msg_1")
    expect(m.modelID).toBe("gpt-4o")
    expect(m.providerID).toBe("openai")
    expect(m.requestStartTime).toBe(1000)
    expect(m.firstTokenTime).toBeNull()
    expect(m.lastDeltaTime).toBeNull()
    expect(m.completeTime).toBeNull()
    expect(m.estimatedOutputTokens).toBe(0)
    expect(m.exactInputTokens).toBe(0)
    expect(m.exactOutputTokens).toBe(0)
    expect(m.exactCacheReadTokens).toBe(0)
    expect(m.exactCacheWriteTokens).toBe(0)
    expect(m.hasExactCacheReadTokens).toBe(false)
    expect(m.hasExactCacheWriteTokens).toBe(false)
    expect(m.exactReasoningTokens).toBe(0)
    expect(m.hasExactTokens).toBe(false)
    expect(m.isStreaming).toBe(false)
    expect(m.isComplete).toBe(false)
  })
})

describe("aggregateRequestMetrics", () => {
  test("sums in/out/cache-read across a session tree", () => {
    // Given: main session + child-agent latest request metrics.
    const main = createFreshMetrics("ses_main", "msg_main", "claude", "anthropic", 1000)
    main.firstTokenTime = 1100
    main.exactInputTokens = 12800
    main.exactOutputTokens = 4000
    main.exactReasoningTokens = 100
    main.exactCacheReadTokens = 38200
    main.hasExactTokens = true
    main.hasExactCacheReadTokens = true

    const child = createFreshMetrics("ses_child", "msg_child", "claude", "anthropic", 2000)
    child.firstTokenTime = 2100
    child.exactInputTokens = 5000
    child.exactOutputTokens = 900
    child.exactCacheReadTokens = 1200
    child.hasExactTokens = true
    child.hasExactCacheReadTokens = true

    // When: aggregating in tree scope.
    const aggregate = aggregateRequestMetrics([main, child], 4100)

    // Then: input/output/cache-read are summed without cache de-dupe or subtraction.
    expect(aggregate).not.toBeNull()
    expect(aggregate?.inputTokens).toBe(57200)
    expect(aggregate?.outputTokens).toBe(5000)
    expect(aggregate?.cacheReadTokens).toBe(39400)
    expect(aggregate?.cacheReadCompleteness).toBe("exact")
  })

  test("marks cache-read as partial when some tree requests lack cache fields", () => {
    // Given: one exact cache-read and one provider response with no cache field.
    const known = createFreshMetrics("ses_main", "msg_main", "claude", "anthropic", 1000)
    known.exactInputTokens = 1000
    known.exactOutputTokens = 200
    known.exactCacheReadTokens = 38200
    known.hasExactTokens = true
    known.hasExactCacheReadTokens = true

    const missing = createFreshMetrics("ses_child", "msg_child", "claude", "anthropic", 1200)
    missing.exactInputTokens = 2000
    missing.exactOutputTokens = 300
    missing.hasExactTokens = true

    // When: aggregating mixed cache precision.
    const aggregate = aggregateRequestMetrics([known, missing], 2000)

    // Then: known cache is preserved as a lower bound.
    expect(aggregate?.cacheReadTokens).toBe(38200)
    expect(aggregate?.cacheReadCompleteness).toBe("partial")
    expect(formatCacheRead(aggregate?.cacheReadTokens ?? 0, aggregate?.cacheReadCompleteness ?? "unknown")).toBe("38.2K+")
  })

  test("marks cache-read as unknown when no request has cache fields", () => {
    // Given: exact token usage without cache fields.
    const request = createFreshMetrics("ses_main", "msg_main", "claude", "anthropic", 1000)
    request.exactInputTokens = 1000
    request.exactOutputTokens = 200
    request.hasExactTokens = true

    // When: aggregating cache.
    const aggregate = aggregateRequestMetrics([request], 2000)

    // Then: display uses the compact unknown marker.
    expect(aggregate?.cacheReadCompleteness).toBe("unknown")
    expect(formatCacheRead(aggregate?.cacheReadTokens ?? 0, aggregate?.cacheReadCompleteness ?? "unknown")).toBe("—")
  })
})
