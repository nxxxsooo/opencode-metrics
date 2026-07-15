import { describe, expect, test } from "bun:test"
import { createCollector } from "../src/collector"
import { DEFAULT_CONFIG } from "../src/types"

function createEventHarness() {
  const handlers = new Map<string, Array<(event: unknown) => void>>()
  const api = {
    event: {
      on(type: string, handler: (event: unknown) => void) {
        const current = handlers.get(type) ?? []
        current.push(handler)
        handlers.set(type, current)
        return () => {
          const next = handlers.get(type)?.filter((item) => item !== handler) ?? []
          handlers.set(type, next)
        }
      },
    },
  }

  return {
    api,
    emit(type: string, properties: Record<string, unknown>, id = type) {
      const event = { id, type, properties }
      for (const handler of handlers.get(type) ?? []) handler(event)
    },
  }
}

function createStateHarness(messages: readonly unknown[], status: unknown) {
  const harness = createEventHarness()
  return {
    ...harness.api,
    emit: harness.emit,
    state: {
      session: {
        messages() {
          return messages
        },
        status() {
          return status
        },
      },
    },
  }
}

describe("collector fresh-start hydration", () => {
  test("hydrates exact tokens from existing session state on fresh startup", () => {
    const harness = createStateHarness([
      {
        id: "msg_existing",
        sessionID: "ses_existing",
        role: "assistant",
        time: { created: Date.now() - 1000, completed: Date.now() - 500 },
        modelID: "gpt-5.5",
        providerID: "openai",
        tokens: {
          input: 21,
          output: 34,
          reasoning: 5,
          cache: { read: 8, write: 0 },
        },
      },
    ], { type: "idle" })
    const collector = createCollector(harness, DEFAULT_CONFIG, () => {})

    const aggregate = collector.getAggregate("ses_existing", "current", performance.now())

    expect(collector.getCurrent("ses_existing")?.messageID).toBe("msg_existing")
    expect(aggregate?.inputTokens).toBe(29)
    expect(aggregate?.outputTokens).toBe(39)
    expect(aggregate?.isComplete).toBe(true)

    collector.dispose()
  })

  test("hydrates exact tokens from TUI message wrappers on fresh startup", () => {
    const harness = createStateHarness([
      {
        info: {
          id: "msg_wrapped",
          sessionID: "ses_wrapped",
          role: "assistant",
          time: { created: Date.now() - 1000, completed: Date.now() - 500 },
          modelID: "gpt-5.5",
          providerID: "openai",
          tokens: {
            input: 88022,
            output: 7,
            reasoning: 26,
            cache: { read: 0, write: 0 },
          },
        },
        parts: [],
      },
    ], { type: "idle" })
    const collector = createCollector(harness, DEFAULT_CONFIG, () => {})

    const aggregate = collector.getAggregate("ses_wrapped", "current", performance.now())

    expect(collector.getCurrent("ses_wrapped")?.messageID).toBe("msg_wrapped")
    expect(aggregate?.inputTokens).toBe(88022)
    expect(aggregate?.outputTokens).toBe(33)
    expect(aggregate?.isComplete).toBe(true)

    collector.dispose()
  })

  test("keeps hydrated completed request time stable across reads", () => {
    const harness = createStateHarness([
      {
        info: {
          id: "msg_stable",
          sessionID: "ses_stable",
          role: "assistant",
          time: { created: Date.now() - 1000, completed: Date.now() - 500 },
          modelID: "gpt-5.5",
          providerID: "openai",
          tokens: {
            input: 10,
            output: 5,
            reasoning: 2,
            cache: { read: 0, write: 0 },
          },
        },
        parts: [],
      },
    ], { type: "idle" })
    const collector = createCollector(harness, DEFAULT_CONFIG, () => {})

    const first = collector.getAggregate("ses_stable", "current", performance.now())
    const second = collector.getAggregate("ses_stable", "current", performance.now() + 10_000)

    expect(first?.completeTime).toBe(second?.completeTime)
    expect(first?.requestStartTime).toBe(second?.requestStartTime)

    collector.dispose()
  })

  test("hydrates historical timing from assistant timestamps", () => {
    const wallNow = Date.now()
    const harness = createStateHarness([
      {
        info: {
          id: "msg_timed",
          sessionID: "ses_timed",
          role: "assistant",
          time: { created: wallNow - 30_000, completed: wallNow - 20_000 },
          modelID: "gpt-5.5",
          providerID: "openai",
          tokens: {
            input: 100,
            output: 20,
            reasoning: 5,
            cache: { read: 0, write: 0 },
          },
        },
        parts: [],
      },
    ], { type: "idle" })
    const collector = createCollector(harness, DEFAULT_CONFIG, () => {})

    const aggregate = collector.getAggregate("ses_timed", "current", performance.now())
    const requestStartTime = aggregate?.requestStartTime ?? null
    const elapsed = (aggregate?.completeTime ?? 0) - (requestStartTime ?? 0)

    expect(elapsed).toBeGreaterThanOrEqual(9_950)
    expect(elapsed).toBeLessThanOrEqual(10_050)
    expect(collector.getSessionElapsedMs("ses_timed")).toBeGreaterThanOrEqual(9_950)
    expect(collector.getSessionElapsedMs("ses_timed")).toBeLessThanOrEqual(10_050)

    collector.dispose()
  })

  test("restores cumulative active time without counting historical idle gaps", () => {
    const wallNow = Date.now()
    const harness = createStateHarness([
      {
        info: {
          id: "msg_first",
          sessionID: "ses_cumulative",
          role: "assistant",
          time: { created: wallNow - 60_000, completed: wallNow - 58_000 },
          modelID: "gpt-5.5",
          providerID: "openai",
          tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [],
      },
      {
        info: {
          id: "msg_second",
          sessionID: "ses_cumulative",
          role: "assistant",
          time: { created: wallNow - 10_000, completed: wallNow - 7_000 },
          modelID: "gpt-5.5",
          providerID: "openai",
          tokens: { input: 20, output: 8, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [],
      },
    ], { type: "idle" })
    const collector = createCollector(harness, DEFAULT_CONFIG, () => {})

    expect(collector.getSessionElapsedMs("ses_cumulative")).toBe(5_000)

    collector.dispose()
  })

  test("replaces stale completed request when hydration sees a newer assistant", () => {
    const wallNow = Date.now()
    let messages: readonly unknown[] = [
      {
        info: {
          id: "msg_old",
          sessionID: "ses_replace",
          role: "assistant",
          time: { created: wallNow - 60_000, completed: wallNow - 50_000 },
          modelID: "gpt-5.5",
          providerID: "openai",
          tokens: {
            input: 10,
            output: 5,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
      },
    ]
    const eventHarness = createEventHarness()
    const harness = {
      ...eventHarness.api,
      emit: eventHarness.emit,
      state: {
        session: {
          messages() {
            return messages
          },
          status() {
            return { type: "idle" }
          },
        },
      },
    }
    const collector = createCollector(harness, DEFAULT_CONFIG, () => {})

    const oldAggregate = collector.getAggregate("ses_replace", "current", performance.now())
    messages = [
      ...messages,
      {
        info: {
          id: "msg_new",
          sessionID: "ses_replace",
          role: "assistant",
          time: { created: wallNow - 20_000, completed: wallNow - 10_000 },
          modelID: "gpt-5.5",
          providerID: "openai",
          tokens: {
            input: 30,
            output: 7,
            reasoning: 2,
            cache: { read: 0, write: 0 },
          },
        },
      },
    ]

    const nextAggregate = collector.getAggregate("ses_replace", "current", performance.now())

    expect(collector.getCurrent("ses_replace")?.messageID).toBe("msg_new")
    expect(nextAggregate?.inputTokens).toBe(30)
    expect(nextAggregate?.outputTokens).toBe(9)
    expect(nextAggregate?.requestStartTime).not.toBe(oldAggregate?.requestStartTime)

    collector.dispose()
  })

  test("does not replace live exact metrics with zero-token session state", () => {
    const harness = createStateHarness([
      {
        info: {
          id: "msg_zero_state",
          sessionID: "ses_zero_state",
          role: "assistant",
          time: { created: Date.now() - 1000, completed: Date.now() - 500 },
          modelID: "gpt-5.5",
          providerID: "openai",
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
      },
    ], { type: "idle" })
    const collector = createCollector(harness, DEFAULT_CONFIG, () => {})

    harness.emit("session.next.step.ended", {
      sessionID: "ses_zero_state",
      assistantMessageID: "msg_exact_state",
      tokens: {
        input: 42,
        output: 6,
        reasoning: 1,
        cache: { read: 8, write: 0 },
      },
    })

    const aggregate = collector.getAggregate("ses_zero_state", "current", performance.now())

    expect(collector.getCurrent("ses_zero_state")?.messageID).toBe("msg_exact_state")
    expect(aggregate?.inputTokens).toBe(50)
    expect(aggregate?.outputTokens).toBe(7)

    collector.dispose()
  })
})
