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
    emitSync(type: string, data: Record<string, unknown>, id = type, aggregateID = typeof data.sessionID === "string" ? data.sessionID : "") {
      const event = {
        id: `sync_${id}`,
        type: "sync",
        syncEvent: {
          id,
          type,
          seq: 1,
          aggregateID,
          data,
        },
      }
      for (const handler of handlers.get(type) ?? []) handler(event)
    },
    emitData(type: string, data: Record<string, unknown>, id = type, aggregateID = typeof data.sessionID === "string" ? data.sessionID : "") {
      const event = {
        id,
        type,
        durable: { aggregateID, seq: 1, version: 1 },
        data,
      }
      for (const handler of handlers.get(type) ?? []) handler(event)
    },
  }
}

describe("collector session.next events", () => {
  test("reads the direct V2 event data and durable envelope", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emitData("session.next.step.started", {
      sessionID: "ses_typed",
      assistantMessageID: "msg_typed",
      model: { id: "gpt-5.6", providerID: "openai" },
    }, "typed_started")
    harness.emitData("session.next.step.ended", {
      sessionID: "ses_typed",
      assistantMessageID: "msg_typed",
      tokens: {
        input: 40,
        output: 8,
        reasoning: 2,
        cache: { read: 60, write: 0 },
      },
    }, "typed_ended")

    const aggregate = collector.getAggregate("ses_typed", "current", performance.now())
    expect(collector.getCurrent("ses_typed")?.modelID).toBe("gpt-5.6")
    expect(aggregate?.inputTokens).toBe(100)
    expect(aggregate?.outputTokens).toBe(10)

    collector.dispose()
  })

  test("applies exact tokens from a completed assistant step", () => {
    // Given: the OpenCode 1.17 session.next stream for one assistant step.
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emit("session.next.step.started", {
      sessionID: "ses_next",
      assistantMessageID: "msg_assistant",
      model: { id: "claude-sonnet", providerID: "anthropic" },
    })
    harness.emit("session.next.text.delta", {
      sessionID: "ses_next",
      assistantMessageID: "msg_assistant",
      textID: "txt_1",
      delta: "hello from the new stream",
    })

    // When: exact tokens arrive on step end rather than message.updated.
    harness.emit("session.next.step.ended", {
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

    // Then: the sidebar aggregate reads the exact OpenCode usage values.
    const aggregate = collector.getAggregate("ses_next", "current", performance.now())
    const current = collector.getCurrent("ses_next")

    expect(current?.hasExactTokens).toBe(true)
    expect(current?.modelID).toBe("claude-sonnet")
    expect(current?.providerID).toBe("anthropic")
    expect(aggregate?.inputTokens).toBe(10112)
    expect(aggregate?.outputTokens).toBe(412)
    expect(aggregate?.cacheReadTokens).toBe(8900)
    expect(aggregate?.cacheReadCompleteness).toBe("exact")

    harness.emit("session.next.step.started", {
      sessionID: "ses_next",
      assistantMessageID: "msg_assistant_2",
      model: { id: "claude-sonnet", providerID: "anthropic" },
    })
    harness.emit("session.next.step.ended", {
      sessionID: "ses_next",
      assistantMessageID: "msg_assistant_2",
      finish: "stop",
      cost: 0.01,
      tokens: {
        input: 10,
        output: 20,
        reasoning: 3,
        cache: { read: 0, write: 0 },
      },
    })

    const secondAggregate = collector.getAggregate("ses_next", "current", performance.now())
    expect(collector.getCurrent("ses_next")?.messageID).toBe("msg_assistant_2")
    expect(secondAggregate?.inputTokens).toBe(10)
    expect(secondAggregate?.outputTokens).toBe(435)

    collector.dispose()
  })

  test("uses public session.next events when assistant message ids are omitted", () => {
    // Given: OpenCode's public TUI event type carries session and token data,
    // but not assistantMessageID on session.next events.
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emit("session.next.step.started", {
      sessionID: "ses_public",
      agent: "build",
      model: { id: "gpt-5.5", providerID: "openai" },
    }, "evt_step_started")
    harness.emit("session.next.text.delta", {
      sessionID: "ses_public",
      delta: "streaming text from public event",
    }, "evt_text_delta")

    // When: exact token usage arrives without an assistantMessageID.
    harness.emit("session.next.step.ended", {
      sessionID: "ses_public",
      finish: "stop",
      cost: 0.01,
      tokens: {
        input: 30,
        output: 40,
        reasoning: 5,
        cache: { read: 7, write: 0 },
      },
    }, "evt_step_ended")

    // Then: the sidebar still shows active metrics instead of staying idle.
    const current = collector.getCurrent("ses_public")
    const aggregate = collector.getAggregate("ses_public", "current", performance.now())

    expect(current?.messageID).toBe("evt_step_started")
    expect(current?.hasExactTokens).toBe(true)
    expect(current?.modelID).toBe("gpt-5.5")
    expect(aggregate?.inputTokens).toBe(37)
    expect(aggregate?.outputTokens).toBe(45)
    expect(aggregate?.cacheReadTokens).toBe(7)

    collector.dispose()
  })

  test("does not fall back to an unrelated latest metrics session", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emit("session.next.step.started", {
      sessionID: "ses_runtime",
      assistantMessageID: "msg_runtime",
      model: { id: "gpt-5.5", providerID: "openai" },
    })
    harness.emit("session.next.step.ended", {
      sessionID: "ses_runtime",
      assistantMessageID: "msg_runtime",
      finish: "stop",
      tokens: {
        input: 88,
        output: 13,
        reasoning: 2,
        cache: { read: 7, write: 0 },
      },
    })

    const aggregate = collector.getAggregate("sidebar_slot", "current", performance.now())

    expect(collector.getCurrent("sidebar_slot")).toBeNull()
    expect(aggregate).toBeNull()
    expect(collector.getSessionElapsedMs("sidebar_slot")).toBe(0)

    collector.dispose()
  })

  test("falls back only when a sync aggregate aliases the sidebar session to runtime metrics", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emitSync("session.status.1", {
      sessionID: "ses_sidebar",
      status: { type: "busy" },
    })
    harness.emitSync("session.next.step.ended.1", {
      sessionID: "ses_runtime",
      assistantMessageID: "msg_runtime",
      tokens: {
        input: 88068,
        output: 12,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    }, "runtime_metrics", "ses_sidebar")

    const aggregate = collector.getAggregate("ses_sidebar", "current", performance.now())

    expect(aggregate?.sessionIDs).toEqual(["ses_runtime"])
    expect(aggregate?.inputTokens).toBe(88068)
    expect(aggregate?.outputTokens).toBe(12)

    collector.dispose()
  })

  test("does not inherit another active session when the requested session only has a placeholder", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emitSync("session.status.1", {
      sessionID: "slot_a",
      status: { type: "busy" },
    })
    harness.emit("session.next.step.started", {
      sessionID: "slot_b",
      assistantMessageID: "msg_b",
    })
    harness.emit("session.next.step.ended", {
      sessionID: "slot_b",
      assistantMessageID: "msg_b",
      tokens: {
        input: 321,
        output: 7,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    })

    const current = collector.getCurrent("slot_a")
    const aggregate = collector.getAggregate("slot_a", "current", performance.now())

    expect(current?.sessionID).toBe("slot_a")
    expect(aggregate?.sessionIDs).toEqual(["slot_a"])
    expect(aggregate?.inputTokens).toBe(0)
    expect(aggregate?.outputTokens).toBe(0)

    collector.dispose()
  })

  test("prefers the requested session when it already has metrics", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emit("session.next.step.started", {
      sessionID: "ses_requested",
      assistantMessageID: "msg_requested",
    })
    harness.emit("session.next.step.ended", {
      sessionID: "ses_requested",
      assistantMessageID: "msg_requested",
      tokens: {
        input: 11,
        output: 5,
        reasoning: 1,
        cache: { read: 2, write: 0 },
      },
    })
    harness.emit("session.next.step.started", {
      sessionID: "ses_latest",
      assistantMessageID: "msg_latest",
    })
    harness.emit("session.next.step.ended", {
      sessionID: "ses_latest",
      assistantMessageID: "msg_latest",
      tokens: {
        input: 99,
        output: 30,
        reasoning: 3,
        cache: { read: 4, write: 0 },
      },
    })

    const aggregate = collector.getAggregate("ses_requested", "current", performance.now())

    expect(aggregate?.sessionIDs).toEqual(["ses_requested"])
    expect(aggregate?.inputTokens).toBe(13)
    expect(aggregate?.outputTokens).toBe(6)

    collector.dispose()
  })

  test("clears aliased sidebar fallback when the metrics session is deleted", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emitSync("session.next.step.started.1", {
      sessionID: "ses_deleted_fallback",
      assistantMessageID: "msg_deleted_fallback",
    }, "deleted_started", "sidebar_slot")
    harness.emitSync("session.next.step.ended.1", {
      sessionID: "ses_deleted_fallback",
      assistantMessageID: "msg_deleted_fallback",
      tokens: {
        input: 20,
        output: 8,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    }, "deleted_ended", "sidebar_slot")

    expect(collector.getAggregate("sidebar_slot", "current", performance.now())).not.toBeNull()

    harness.emit("session.deleted", { sessionID: "ses_deleted_fallback" })

    expect(collector.getCurrent("sidebar_slot")).toBeNull()
    expect(collector.getAggregate("sidebar_slot", "current", performance.now())).toBeNull()

    collector.dispose()
  })

  test("marks next-event requests complete on session idle events", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emit("session.next.step.started", {
      sessionID: "ses_idle",
      model: { id: "gpt-5.5", providerID: "openai" },
    }, "idle_step_started")
    harness.emit("session.next.text.delta", {
      sessionID: "ses_idle",
      delta: "still streaming",
    }, "idle_text_delta")

    harness.emit("session.idle", { sessionID: "ses_idle" })

    const aggregate = collector.getAggregate("ses_idle", "current", performance.now())

    expect(aggregate?.isStreaming).toBe(false)
    expect(aggregate?.isComplete).toBe(true)
    expect(aggregate?.completeTime).not.toBeNull()

    collector.dispose()
  })

  test("freezes session timing while idle and resumes without counting the idle gap", async () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emit("session.status", { sessionID: "ses_timing", status: { type: "busy" } })
    await Bun.sleep(10)
    harness.emit("session.status", { sessionID: "ses_timing", status: { type: "idle" } })
    const frozen = collector.getSessionElapsedMs("ses_timing")

    await Bun.sleep(15)
    expect(collector.getSessionElapsedMs("ses_timing")).toBeCloseTo(frozen, 5)

    harness.emit("session.status", { sessionID: "ses_timing", status: { type: "busy" } })
    await Bun.sleep(10)
    expect(collector.getSessionElapsedMs("ses_timing")).toBeGreaterThan(frozen)

    collector.dispose()
  })

  test("reads OpenCode versioned message events", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emitSync("session.status.1", {
      sessionID: "ses_versioned",
      status: { type: "busy" },
    })
    harness.emitSync("message.updated.1", {
      sessionID: "ses_versioned",
      info: {
        id: "msg_versioned_assistant",
        sessionID: "ses_versioned",
        role: "assistant",
        time: { created: Date.now() - 1200 },
        modelID: "gpt-5.5",
        providerID: "openai",
        tokens: {
          input: 123,
          output: 45,
          reasoning: 6,
          cache: { read: 789, write: 0 },
        },
      },
    })

    const aggregate = collector.getAggregate("ses_versioned", "current", performance.now())

    expect(collector.getCurrent("ses_versioned")?.messageID).toBe("msg_versioned_assistant")
    expect(aggregate?.inputTokens).toBe(912)
    expect(aggregate?.outputTokens).toBe(51)
    expect(aggregate?.cacheReadTokens).toBe(789)

    collector.dispose()
  })

  test("reads OpenCode .2 session.next step ended events", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emitSync("session.next.step.started.1", {
      sessionID: "ses_step_v2",
      assistantMessageID: "msg_step_v2",
      model: { id: "gpt-5.5", providerID: "openai" },
    })
    harness.emitSync("session.next.step.ended.2", {
      sessionID: "ses_step_v2",
      assistantMessageID: "msg_step_v2",
      finish: "stop",
      cost: 0.01,
      tokens: {
        input: 101,
        output: 17,
        reasoning: 9,
        cache: { read: 203, write: 0 },
      },
    })

    const aggregate = collector.getAggregate("ses_step_v2", "current", performance.now())

    expect(collector.getCurrent("ses_step_v2")?.hasExactTokens).toBe(true)
    expect(aggregate?.inputTokens).toBe(304)
    expect(aggregate?.outputTokens).toBe(26)
    expect(aggregate?.cacheReadTokens).toBe(203)

    collector.dispose()
  })

  test("estimates output speed from session.next reasoning deltas", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emitSync("session.next.step.started.1", {
      sessionID: "ses_reasoning_delta",
      assistantMessageID: "msg_reasoning_delta",
      model: { id: "gpt-5.5", providerID: "openai" },
    })
    harness.emitSync("session.next.reasoning.delta.1", {
      sessionID: "ses_reasoning_delta",
      assistantMessageID: "msg_reasoning_delta",
      reasoningID: "rsn_delta",
      delta: "Reviewing runtime event stream evidence",
    })

    const aggregate = collector.getAggregate("ses_reasoning_delta", "current", performance.now() + 1000)

    expect(collector.getCurrent("ses_reasoning_delta")?.hasExactTokens).toBe(false)
    expect(aggregate?.outputTokens).toBeGreaterThan(0)
    expect(aggregate?.firstTokenTime).not.toBeNull()
    expect(aggregate?.isStreaming).toBe(true)

    collector.dispose()
  })

  test("estimates output speed from reasoning part updates before exact tokens arrive", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emitSync("session.status.1", {
      sessionID: "ses_reasoning",
      status: { type: "busy" },
    })
    harness.emitSync("message.updated.1", {
      sessionID: "ses_reasoning",
      info: {
        id: "msg_reasoning_assistant",
        sessionID: "ses_reasoning",
        role: "assistant",
        time: { created: Date.now() - 5000 },
        modelID: "gpt-5.5",
        providerID: "openai",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      },
    })
    harness.emitSync("message.part.updated.1", {
      sessionID: "ses_reasoning",
      part: {
        id: "prt_reasoning",
        sessionID: "ses_reasoning",
        messageID: "msg_reasoning_assistant",
        type: "reasoning",
        text: "Confirming filtered record discrepancy",
      },
    })

    const current = collector.getCurrent("ses_reasoning")
    const aggregate = collector.getAggregate("ses_reasoning", "current", performance.now() + 1000)

    expect(current?.hasExactTokens).toBe(false)
    expect(current?.messageID).toBe("msg_reasoning_assistant")
    expect(aggregate?.outputTokens).toBeGreaterThan(0)
    expect(aggregate?.firstTokenTime).not.toBeNull()
    expect(aggregate?.isStreaming).toBe(true)

    collector.dispose()
  })

  test("does not double count when next delta and part update describe the same assistant text", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emitSync("session.next.step.started.1", {
      sessionID: "ses_dedupe",
      assistantMessageID: "msg_dedupe",
      model: { id: "gpt-5.5", providerID: "openai" },
    })
    harness.emitSync("session.next.text.delta.1", {
      sessionID: "ses_dedupe",
      assistantMessageID: "msg_dedupe",
      textID: "txt_dedupe",
      delta: "hello world",
    })
    harness.emitSync("message.part.updated.1", {
      sessionID: "ses_dedupe",
      part: {
        id: "txt_dedupe",
        sessionID: "ses_dedupe",
        messageID: "msg_dedupe",
        type: "text",
        text: "hello world",
      },
    })

    const aggregate = collector.getAggregate("ses_dedupe", "current", performance.now() + 1000)

    expect(aggregate?.outputTokens).toBeCloseTo(2.75)
    expect(aggregate?.isStreaming).toBe(true)

    collector.dispose()
  })

  test("late replayed user message does not wipe completed assistant metrics", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emitSync("message.updated.1", {
      sessionID: "ses_late_user",
      info: {
        id: "msg_user_late",
        sessionID: "ses_late_user",
        role: "user",
      },
    })
    harness.emitSync("message.updated.1", {
      sessionID: "ses_late_user",
      info: {
        id: "msg_assistant_late",
        sessionID: "ses_late_user",
        role: "assistant",
        modelID: "gpt-5.5",
        providerID: "openai",
        tokens: {
          input: 100,
          output: 12,
          reasoning: 3,
          cache: { read: 200, write: 0 },
        },
      },
    })
    harness.emitSync("session.status.1", {
      sessionID: "ses_late_user",
      status: { type: "idle" },
    })
    harness.emitSync("message.updated.1", {
      sessionID: "ses_late_user",
      info: {
        id: "msg_user_late",
        sessionID: "ses_late_user",
        role: "user",
      },
    })

    const current = collector.getCurrent("ses_late_user")
    const aggregate = collector.getAggregate("ses_late_user", "current", performance.now())

    expect(current?.messageID).toBe("msg_assistant_late")
    expect(current?.hasExactTokens).toBe(true)
    expect(aggregate?.inputTokens).toBe(300)
    expect(aggregate?.outputTokens).toBe(15)
    expect(aggregate?.isComplete).toBe(true)

    collector.dispose()
  })

  test("zero-token assistant updates do not wipe input estimates before exact tokens arrive", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emitSync("message.updated.1", {
      sessionID: "ses_zero_assistant",
      info: {
        id: "msg_user_zero_assistant",
        sessionID: "ses_zero_assistant",
        role: "user",
      },
    })
    harness.emitSync("message.part.updated.1", {
      sessionID: "ses_zero_assistant",
      part: {
        id: "prt_user_zero_assistant",
        sessionID: "ses_zero_assistant",
        messageID: "msg_user_zero_assistant",
        type: "text",
        text: "Reply with exactly six short English words.",
      },
    })
    harness.emitSync("message.updated.1", {
      sessionID: "ses_zero_assistant",
      info: {
        id: "msg_assistant_zero_assistant",
        sessionID: "ses_zero_assistant",
        role: "assistant",
        modelID: "gpt-5.5",
        providerID: "openai",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      },
    })

    const estimated = collector.getAggregate("ses_zero_assistant", "current", performance.now())

    expect(collector.getCurrent("ses_zero_assistant")?.messageID).toBe("msg_user_zero_assistant")
    expect(estimated?.inputTokens).toBeCloseTo(10.75)
    expect(estimated?.outputTokens).toBe(0)

    harness.emitSync("session.next.step.ended.1", {
      sessionID: "ses_zero_assistant",
      assistantMessageID: "msg_assistant_zero_assistant",
      tokens: {
        input: 101,
        output: 12,
        reasoning: 2,
        cache: { read: 300, write: 0 },
      },
    })

    const exact = collector.getAggregate("ses_zero_assistant", "current", performance.now())

    expect(collector.getCurrent("ses_zero_assistant")?.messageID).toBe("msg_assistant_zero_assistant")
    expect(exact?.inputTokens).toBe(401)
    expect(exact?.outputTokens).toBe(14)
    expect(exact?.cacheReadTokens).toBe(300)

    collector.dispose()
  })

  test("deleting one session keeps other session part progress deltas scoped", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    for (const sessionID of ["ses_deleted", "ses_kept"]) {
      harness.emitSync("message.updated.1", {
        sessionID,
        info: {
          id: `msg_${sessionID}`,
          sessionID,
          role: "assistant",
          modelID: "gpt-5.5",
          providerID: "openai",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      })
      harness.emitSync("message.part.updated.1", {
        sessionID,
        part: {
          id: "shared_part_id",
          sessionID,
          messageID: `msg_${sessionID}`,
          type: "reasoning",
          text: "initial reasoning text",
        },
      })
    }

    const beforeDelete = collector.getAggregate("ses_kept", "current", performance.now())

    harness.emit("session.deleted", { sessionID: "ses_deleted" })
    harness.emitSync("message.part.updated.1", {
      sessionID: "ses_kept",
      part: {
        id: "shared_part_id",
        sessionID: "ses_kept",
        messageID: "msg_ses_kept",
        type: "reasoning",
        text: "initial reasoning text with a little more",
      },
    })

    const afterDelete = collector.getAggregate("ses_kept", "current", performance.now())

    expect(beforeDelete?.outputTokens).toBeGreaterThan(0)
    expect(afterDelete?.outputTokens).toBeGreaterThan(beforeDelete?.outputTokens ?? 0)
    expect(afterDelete?.outputTokens).toBeLessThan((beforeDelete?.outputTokens ?? 0) * 2)

    collector.dispose()
  })

  test("keeps finalized steps cumulative, sticky context stable, and resets on a new user turn", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emit("message.updated", {
      sessionID: "ses_turn",
      info: { id: "msg_user_1", role: "user", time: { created: Date.now() } },
    }, "user_1")
    harness.emit("session.next.step.ended", {
      sessionID: "ses_turn",
      assistantMessageID: "msg_step_1",
      tokens: { input: 100, output: 10, reasoning: 2, cache: { read: 900, write: 0 } },
    }, "step_1")
    harness.emit("session.next.step.started", {
      sessionID: "ses_turn",
      assistantMessageID: "msg_step_2",
    }, "step_2_start")

    const inFlight = collector.getAggregate("ses_turn", "current", performance.now())
    expect(inFlight?.inputTokens).toBe(1000)
    expect(inFlight?.outputTokens).toBe(12)

    harness.emit("session.next.step.ended", {
      sessionID: "ses_turn",
      assistantMessageID: "msg_step_2",
      tokens: { input: 150, output: 20, reasoning: 3, cache: { read: 950, write: 0 } },
    }, "step_2_end")
    expect(collector.getAggregate("ses_turn", "current", performance.now())?.outputTokens).toBe(35)

    harness.emit("message.updated", {
      sessionID: "ses_turn",
      info: { id: "msg_user_2", role: "user", time: { created: Date.now() } },
    }, "user_2")
    expect(collector.getAggregate("ses_turn", "current", performance.now())?.outputTokens).toBe(0)

    collector.dispose()
  })

  test("finalizes each exact step once across event families and corrects an idle estimate", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emit("session.next.step.started", {
      sessionID: "ses_idempotent",
      assistantMessageID: "msg_same",
    }, "same_start")
    harness.emit("session.next.text.delta", {
      sessionID: "ses_idempotent",
      assistantMessageID: "msg_same",
      textID: "txt_same",
      delta: "abcdefgh",
    }, "same_delta")
    harness.emit("session.idle", { sessionID: "ses_idempotent" }, "same_idle")
    expect(collector.getAggregate("ses_idempotent", "current", performance.now())?.outputTokens).toBe(2)

    const tokens = { input: 50, output: 5, reasoning: 1, cache: { read: 10, write: 0 } }
    harness.emit("session.next.step.ended", {
      sessionID: "ses_idempotent",
      assistantMessageID: "msg_same",
      tokens,
    }, "same_end")
    harness.emitSync("session.next.step.ended.1", {
      sessionID: "ses_idempotent",
      assistantMessageID: "msg_same",
      tokens,
    }, "same_end", "ses_idempotent")
    harness.emit("message.updated", {
      sessionID: "ses_idempotent",
      info: {
        id: "msg_same",
        role: "assistant",
        time: { created: Date.now() - 100, completed: Date.now() },
        tokens,
      },
    }, "same_message")

    const aggregate = collector.getAggregate("ses_idempotent", "current", performance.now())
    expect(aggregate?.outputTokens).toBe(6)
    expect(aggregate?.liveTps).toBeNull()

    collector.dispose()
  })

  test("deduplicates V1 delta fragments against the matching part snapshot", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

    harness.emit("message.part.delta", {
      sessionID: "ses_v1_dedupe",
      messageID: "msg_v1_dedupe",
      partID: "prt_v1_dedupe",
      field: "text",
      delta: "abcdefgh",
    }, "v1_delta")
    harness.emit("message.part.updated", {
      sessionID: "ses_v1_dedupe",
      part: {
        id: "prt_v1_dedupe",
        messageID: "msg_v1_dedupe",
        type: "text",
        text: "abcdefgh",
      },
    }, "v1_snapshot")

    expect(collector.getAggregate("ses_v1_dedupe", "current", performance.now())?.outputTokens).toBe(2)
    collector.dispose()
  })

  test("does not recount a part snapshot after it temporarily shrinks", () => {
    const harness = createEventHarness()
    const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})
    const base = {
      sessionID: "ses_part_rewrite",
      part: {
        id: "prt_part_rewrite",
        messageID: "msg_part_rewrite",
        type: "text",
        text: "abcdefgh",
      },
    }

    harness.emit("message.part.updated", base, "part_full")
    harness.emit("message.part.updated", {
      ...base,
      part: { ...base.part, text: "abcd" },
    }, "part_short")
    harness.emit("message.part.updated", base, "part_full_again")

    expect(collector.getAggregate("ses_part_rewrite", "current", performance.now())?.outputTokens).toBe(2)
    collector.dispose()
  })

})
