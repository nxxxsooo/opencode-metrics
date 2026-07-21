import { describe, expect, test } from "bun:test"
import { createCollector } from "../src/collector"
import {
  clearLiveSpeed,
  getLiveTps,
  LIVE_SPEED_MAX_SAMPLES,
  recordLiveTokens,
  resetLiveSpeed,
} from "../src/live-speed"
import { DEFAULT_CONFIG, type LiveSpeedState } from "../src/types"

function createEventHarness() {
  const handlers = new Map<string, Array<(event: unknown) => void>>()
  const api = {
    event: {
      on(type: string, handler: (event: unknown) => void) {
        const current = handlers.get(type) ?? []
        current.push(handler)
        handlers.set(type, current)
        return () => handlers.set(type, (handlers.get(type) ?? []).filter((item) => item !== handler))
      },
    },
  }
  return {
    api,
    emit(type: string, properties: Record<string, unknown>, id = `${type}:${Math.random()}`) {
      for (const handler of handlers.get(type) ?? []) handler({ id, type, properties })
    },
  }
}

function withPerformanceClock(run: (clock: { now: number }) => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(performance, "now")
  const clock = { now: 0 }
  Object.defineProperty(performance, "now", { configurable: true, value: () => clock.now })
  try {
    run(clock)
  } finally {
    if (descriptor) Object.defineProperty(performance, "now", descriptor)
    else delete (performance as unknown as { now?: () => number }).now
  }
}

describe("observable live speed", () => {
  test("calculates a recent sample-to-sample rate and becomes stale", () => {
    const states = new Map<string, LiveSpeedState>()
    recordLiveTokens(states, "ses", "msg", 10, 1000)
    expect(getLiveTps(states.get("ses"), 1000)).toBeNull()

    recordLiveTokens(states, "ses", "msg", 20, 2000)
    expect(getLiveTps(states.get("ses"), 2500)).toBe(20)
    expect(getLiveTps(states.get("ses"), 4000)).toBeNull()
  })

  test("step reset and clear never turn finalized usage into a live spike", () => {
    const states = new Map<string, LiveSpeedState>()
    recordLiveTokens(states, "ses", "msg_1", 10, 1000)
    recordLiveTokens(states, "ses", "msg_1", 10, 1500)
    expect(getLiveTps(states.get("ses"), 1500)).toBe(20)

    resetLiveSpeed(states, "ses", "msg_2")
    expect(getLiveTps(states.get("ses"), 1500)).toBeNull()
    clearLiveSpeed(states, "ses")
    expect(getLiveTps(states.get("ses"), 1500)).toBeNull()
  })

  test("bounds retained samples even during a dense stream", () => {
    const states = new Map<string, LiveSpeedState>()
    for (let index = 0; index < LIVE_SPEED_MAX_SAMPLES * 2; index += 1) {
      recordLiveTokens(states, "ses", "msg", 1, index)
    }
    expect(states.get("ses")?.samples).toHaveLength(LIVE_SPEED_MAX_SAMPLES)
    expect(getLiveTps(states.get("ses"), LIVE_SPEED_MAX_SAMPLES * 2)).toBeGreaterThan(0)
  })

  test("tree scope sums concurrent streams while time rows stay foreground-scoped", () => {
    withPerformanceClock((clock) => {
      const harness = createEventHarness()
      const collector = createCollector(harness.api, DEFAULT_CONFIG, () => {})

      clock.now = 1000
      harness.emit("session.created", { info: { id: "ses_root" } })
      harness.emit("session.created", { info: { id: "ses_child", parentID: "ses_root" } })
      harness.emit("session.status", { sessionID: "ses_root", status: { type: "busy" } })
      harness.emit("session.status", { sessionID: "ses_child", status: { type: "busy" } })
      harness.emit("session.next.step.started", { sessionID: "ses_root", assistantMessageID: "msg_root" })
      harness.emit("session.next.step.started", { sessionID: "ses_child", assistantMessageID: "msg_child" })

      clock.now = 1100
      harness.emit("session.next.text.delta", {
        sessionID: "ses_root",
        assistantMessageID: "msg_root",
        textID: "txt_root",
        delta: "aaaaaaaa",
      })
      harness.emit("session.next.text.delta", {
        sessionID: "ses_child",
        assistantMessageID: "msg_child",
        textID: "txt_child",
        delta: "aaaaaaaaaaaaaaaa",
      })

      clock.now = 1200
      harness.emit("session.next.text.delta", {
        sessionID: "ses_root",
        assistantMessageID: "msg_root",
        textID: "txt_root",
        delta: "aaaaaaaa",
      })
      harness.emit("session.next.text.delta", {
        sessionID: "ses_child",
        assistantMessageID: "msg_child",
        textID: "txt_child",
        delta: "aaaaaaaaaaaaaaaa",
      })

      const aggregate = collector.getAggregate("ses_root", "tree", clock.now)
      expect(aggregate?.liveTps).toBe(60)
      expect(aggregate?.ttft).toBe(100)
      expect((aggregate?.completeTime ?? clock.now) - (aggregate?.requestStartTime ?? 0)).toBe(200)

      clock.now = 1300
      harness.emit("session.status", { sessionID: "ses_child", status: { type: "idle" } })
      clock.now = 1400
      harness.emit("session.status", { sessionID: "ses_root", status: { type: "idle" } })
      expect(collector.getSessionElapsedMs("ses_root", "tree", clock.now)).toBe(400)
      expect(collector.getAggregate("ses_root", "tree", clock.now)?.liveTps).toBeNull()

      collector.dispose()
    })
  })
})
