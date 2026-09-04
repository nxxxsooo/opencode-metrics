import { describe, expect, test } from "bun:test"
import { createCollector } from "../src/collector"
import { createOpenCodeHost } from "../src/opencode-compat"
import { DEFAULT_CONFIG } from "../src/types"

function createEventApi(extra: Record<string, unknown> = {}) {
  const handlers = new Map<string, Array<(event: unknown) => void>>()
  return {
    handlers,
    api: {
      event: {
        on(type: string, handler: (event: unknown) => void) {
          const current = handlers.get(type) ?? []
          current.push(handler)
          handlers.set(type, current)
          return () => handlers.set(type, (handlers.get(type) ?? []).filter((item) => item !== handler))
        },
      },
      ...extra,
    },
    emit(type: string, properties: Record<string, unknown>) {
      for (const handler of handlers.get(type) ?? []) handler({ id: type, type, properties })
    },
  }
}

const completedMessage = {
  id: "msg_fallback",
  sessionID: "ses_fallback",
  role: "assistant",
  time: { created: Date.now() - 1000, completed: Date.now() - 500 },
  modelID: "gpt-5.5",
  providerID: "openai",
  tokens: { input: 20, output: 6, reasoning: 2, cache: { read: 5, write: 0 } },
}

describe("OpenCode host compatibility", () => {
  test("prefers synchronous TUI state over the public client", async () => {
    let clientCalls = 0
    const harness = createEventApi({
      state: {
        session: {
          messages() { return [{ ...completedMessage, id: "msg_state" }] },
          status() { return { type: "idle" } },
        },
      },
      client: {
        session: {
          async messages() {
            clientCalls += 1
            return { data: [completedMessage] }
          },
        },
      },
    })
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    expect(collector.getCurrent("ses_fallback")?.messageID).toBe("msg_state")
    await Bun.sleep(0)
    expect(clientCalls).toBe(0)
    collector.dispose()
  })

  test("falls back to public client messages when TUI state is unavailable", async () => {
    let clientCalls = 0
    const harness = createEventApi({
      client: {
        session: {
          async messages({ sessionID }: { sessionID: string }) {
            clientCalls += 1
            expect(sessionID).toBe("ses_fallback")
            return { data: [completedMessage] }
          },
        },
      },
    })
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    expect(collector.getAggregate("ses_fallback", "current")).toBeNull()
    await Bun.sleep(0)
    const aggregate = collector.getAggregate("ses_fallback", "current")

    expect(clientCalls).toBe(1)
    expect(collector.getCurrent("ses_fallback")?.messageID).toBe("msg_fallback")
    expect(aggregate?.inputTokens).toBe(25)
    expect(aggregate?.outputTokens).toBe(8)
    collector.dispose()
  })

  test("treats a successful empty history as no metrics and throttles immediate retries", async () => {
    let clientCalls = 0
    const harness = createEventApi({
      client: {
        session: {
          async messages() {
            clientCalls += 1
            return { data: [] }
          },
        },
      },
    })
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    expect(collector.getCurrent("ses_empty")).toBeNull()
    await Bun.sleep(0)
    expect(collector.getCurrent("ses_empty")).toBeNull()
    expect(clientCalls).toBe(1)
    collector.dispose()
  })

  test("throttles public-client errors instead of retrying on every getter", async () => {
    let clientCalls = 0
    const harness = createEventApi({
      client: {
        session: {
          async messages() {
            clientCalls += 1
            return { error: "temporarily unavailable" }
          },
        },
      },
    })
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    collector.getAggregate("ses_error", "current")
    await Bun.sleep(0)
    collector.getAggregate("ses_error", "current")
    expect(clientCalls).toBe(1)
    collector.dispose()
  })

  test("keeps realtime metrics working when all hydration capabilities are unavailable", () => {
    const harness = createEventApi()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emit("session.next.step.ended", {
      sessionID: "ses_live",
      assistantMessageID: "msg_live",
      tokens: { input: 9, output: 4, reasoning: 1, cache: { read: 2, write: 0 } },
    })

    expect(collector.getAggregate("ses_live", "current")?.inputTokens).toBe(11)
    expect(collector.getAggregate("ses_live", "current")?.outputTokens).toBe(5)
    collector.dispose()
  })

  test("does not let delayed history overwrite newer live metrics", async () => {
    let resolveMessages: ((value: unknown) => void) | undefined
    const harness = createEventApi({
      client: {
        session: {
          messages() {
            return new Promise((resolve) => { resolveMessages = resolve })
          },
        },
      },
    })
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    collector.getCurrent("ses_fallback")
    harness.emit("session.next.step.ended", {
      sessionID: "ses_fallback",
      assistantMessageID: "msg_live_newer",
      tokens: { input: 40, output: 9, reasoning: 1, cache: { read: 3, write: 0 } },
    })
    resolveMessages?.({ data: [completedMessage] })
    await Bun.sleep(0)

    expect(collector.getCurrent("ses_fallback")?.messageID).toBe("msg_live_newer")
    expect(collector.getAggregate("ses_fallback", "current")?.outputTokens).toBe(10)
    collector.dispose()
  })

  test("does not apply a pending client hydration result after disposal", async () => {
    let resolveMessages: ((value: unknown) => void) | undefined
    let renders = 0
    const harness = createEventApi({
      renderer: { requestRender() { renders += 1 } },
      client: {
        session: {
          messages() {
            return new Promise((resolve) => { resolveMessages = resolve })
          },
        },
      },
    })
    const host = createOpenCodeHost(harness.api)
    const collector = createCollector(host, DEFAULT_CONFIG, () => {})

    collector.getCurrent("ses_fallback")
    collector.dispose()
    resolveMessages?.({ data: [completedMessage] })
    await Bun.sleep(0)

    expect(renders).toBe(0)
    expect(collector.getCurrent("ses_fallback")).toBeNull()
  })

  test("ignores malformed and missing-session events without poisoning valid delivery", () => {
    const harness = createEventApi()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emit("session.next.step.ended", { tokens: { input: 100, output: 100 } })
    harness.emit("session.next.step.ended", { sessionID: 123, tokens: "invalid" })
    harness.emit("session.next.step.ended", {
      sessionID: "ses_valid",
      assistantMessageID: "msg_valid",
      tokens: { input: 7, output: 3, reasoning: 0, cache: { read: 1, write: 0 } },
    })

    expect(collector.getAggregate("", "current")).toBeNull()
    expect(collector.getAggregate("ses_valid", "current")?.outputTokens).toBe(3)
    collector.dispose()
  })

  test("normalizes direct and wrapped children while rejecting client errors", async () => {
    const direct = createOpenCodeHost(createEventApi({
      client: { session: { children: async () => [{ id: "child", parentID: "root" }, { nope: true }] } },
    }).api)
    expect(await direct.fetchChildren("root")).toEqual([{ id: "child", parentID: "root" }])

    const logs: string[] = []
    const failed = createOpenCodeHost(createEventApi({
      client: { session: { children: async () => ({ error: "unavailable" }) } },
    }).api, (message) => logs.push(message))
    expect(await failed.fetchChildren("root")).toBeNull()
    expect(logs[0]).toContain("session children fallback failed")
  })
})
