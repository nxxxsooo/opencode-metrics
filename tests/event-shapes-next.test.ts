import { describe, expect, test } from "bun:test"
import { parseAssistantStepEnded } from "../src/event-shapes"

describe("session.next token events", () => {
  test("parses exact tokens from step ended properties", () => {
    // Given: OpenCode 1.17 emits exact usage on session.next.step.ended.
    const parsed = parseAssistantStepEnded({
      sessionID: "ses_next",
      assistantMessageID: "msg_assistant",
      finish: "stop",
      cost: 0.01,
      tokens: {
        input: 1200,
        output: 345,
        reasoning: 67,
        cache: { read: 8900, write: 12 },
      },
    })

    // Then: the metrics collector can reuse the same token application path.
    expect(parsed?.sessionID).toBe("ses_next")
    expect(parsed?.messageID).toBe("msg_assistant")
    expect(parsed?.tokens.input).toBe(1200)
    expect(parsed?.tokens.output).toBe(345)
    expect(parsed?.tokens.reasoning).toBe(67)
    expect(parsed?.tokens.cacheRead).toBe(8900)
    expect(parsed?.tokens.cacheWrite).toBe(12)
    expect(parsed?.tokens.hasAny).toBe(true)
  })
})
