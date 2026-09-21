import { afterEach, describe, expect, test } from "bun:test"
import { installWebSocketModelObserver, type WebSocketFrameInput } from "../src/ws-observer"

interface Frame {
  socket: object
  url: string
  direction: "in" | "out"
  text: string
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readonly url: string
  readonly listeners = new Map<string, Array<(event: unknown) => void>>()
  sent: unknown[] = []
  private handler: ((event: unknown) => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }
  get onmessage(): ((event: unknown) => void) | null { return this.handler }
  set onmessage(value: ((event: unknown) => void) | null) { this.handler = value }
  send(data: unknown) { this.sent.push(data) }
  receive(data: unknown) {
    for (const listener of this.listeners.get("message") ?? []) listener({ data })
    this.handler?.({ data })
  }
}

const responsesUrl = "wss://relay.test:4438/v1/responses"
const isResponsesSocket = (url: string) => /\/responses\/?$/.test(url)

function collect(): { frames: Frame[]; cleanup: () => void } {
  const frames: Frame[] = []
  const observer = installWebSocketModelObserver({
    isModelSocket: isResponsesSocket,
    onFrame: (input: WebSocketFrameInput) => { frames.push({ ...input }) },
    webSocketConstructor: FakeWebSocket,
  })
  expect(observer).not.toBeNull()
  return { frames, cleanup: () => observer!.dispose() }
}

let restore: (() => void) | null = null
afterEach(() => { restore?.(); restore = null; FakeWebSocket.instances.length = 0 })

describe("WebSocket model observer", () => {
  test("observes inbound frames and outgoing sends only on matching sockets", () => {
    const { frames, cleanup } = collect()
    try {
      const socket = new FakeWebSocket(responsesUrl)
      socket.addEventListener("message", () => {})
      socket.send(JSON.stringify({ type: "response.create", model: "gpt-6-astra", input: [] }))
      socket.receive(JSON.stringify({ type: "response.created", response: { model: "gpt-6-astra-live" } }))
      expect(frames).toEqual([
        { socket, url: responsesUrl, direction: "out", text: JSON.stringify({ type: "response.create", model: "gpt-6-astra", input: [] }) },
        { socket, url: responsesUrl, direction: "in", text: JSON.stringify({ type: "response.created", response: { model: "gpt-6-astra-live" } }) },
      ])
    } finally { cleanup() }
  })

  test("onmessage assignment observes without touching the host handler", () => {
    const { frames, cleanup } = collect()
    try {
      const socket = new FakeWebSocket(responsesUrl)
      let hostRuns = 0
      socket.onmessage = () => { hostRuns++ }
      socket.receive('{"model":"via-onmessage"}')
      expect(hostRuns).toBe(1)
      expect(frames.map((frame) => frame.text)).toEqual(['{"model":"via-onmessage"}'])
    } finally { cleanup() }
  })

  test("non-matching URLs attach no observer and emit nothing", () => {
    const { frames, cleanup } = collect()
    try {
      const internal = new FakeWebSocket("wss://internal.test/session/live")
      internal.addEventListener("message", () => {})
      internal.send("{}")
      internal.receive("{}")
      expect(frames).toEqual([])
      expect([...internal.listeners.get("message")!]).toHaveLength(1)
    } finally { cleanup() }
  })

  test("observer exceptions never reach host listeners or sends", () => {
    const observer = installWebSocketModelObserver({
      isModelSocket: isResponsesSocket,
      onFrame: () => { throw new Error("observer crash") },
      webSocketConstructor: FakeWebSocket,
    })
    expect(observer).not.toBeNull()
    try {
      const socket = new FakeWebSocket(responsesUrl)
      let hostRuns = 0
      socket.addEventListener("message", () => { hostRuns++ })
      expect(() => {
        socket.receive('{"model":"crash-guard"}')
        socket.send('{"model":"out"}')
      }).not.toThrow()
      expect(hostRuns).toBe(1)
      expect(socket.sent).toEqual(['{"model":"out"}'])
    } finally { observer!.dispose() }
  })

  test("double install is rejected; dispose restores the prototype and allows reinstall", () => {
    const before = Object.getOwnPropertyDescriptor(FakeWebSocket.prototype, "send")!
    const first = installWebSocketModelObserver({
      isModelSocket: isResponsesSocket, onFrame: () => {}, webSocketConstructor: FakeWebSocket,
    })
    expect(first).not.toBeNull()
    expect(installWebSocketModelObserver({ isModelSocket: isResponsesSocket, onFrame: () => {}, webSocketConstructor: FakeWebSocket })).toBeNull()
    first!.dispose()
    expect(Object.getOwnPropertyDescriptor(FakeWebSocket.prototype, "send")).toEqual(before)
    const socket = new FakeWebSocket(responsesUrl)
    socket.addEventListener("message", () => {})
    const reinstalled = installWebSocketModelObserver({
      isModelSocket: isResponsesSocket, onFrame: () => {}, webSocketConstructor: FakeWebSocket,
    })
    expect(reinstalled).not.toBeNull()
    reinstalled!.dispose()
  })

  test("null for unusable constructors", () => {
    expect(installWebSocketModelObserver({ isModelSocket: () => true, onFrame: () => {}, webSocketConstructor: {} })).toBeNull()
    // No listener-registration primitive anywhere on the chain.
    class Bare { url = "wss://relay.test/v1/responses"; send(_data: unknown) {} }
    expect(installWebSocketModelObserver({ isModelSocket: isResponsesSocket, onFrame: () => {}, webSocketConstructor: Bare })).toBeNull()
  })

  test("defaults to the global WebSocket and tolerates its absence", () => {
    const real = globalThis.WebSocket
    ;(globalThis as { WebSocket?: unknown }).WebSocket = undefined
    try {
      expect(installWebSocketModelObserver({ isModelSocket: () => true, onFrame: () => {} })).toBeNull()
    } finally {
      ;(globalThis as { WebSocket?: unknown }).WebSocket = real
    }
  })

  test("EventEmitter-style hosts with inherited on/once are observed and restored", () => {
    // Mirror Bun's server-side shape: on/once inherited from a base class,
    // no own addEventListener, onmessage and send on the WebSocket prototype.
    class EventEmitterBase {
      readonly handlers = new Map<string, Array<(event: unknown) => void>>()
      on(type: string, listener: (event: unknown) => void) {
        const list = this.handlers.get(type) ?? []
        list.push(listener)
        this.handlers.set(type, list)
        return this
      }
    }
    class BunStyleSocket extends EventEmitterBase {
      static instances: BunStyleSocket[] = []
      readonly url: string
      private handler: ((event: unknown) => void) | null = null
      sent: unknown[] = []
      constructor(url: string) { super(); this.url = url; BunStyleSocket.instances.push(this) }
      get onmessage(): ((event: unknown) => void) | null { return this.handler }
      set onmessage(value: ((event: unknown) => void) | null) { this.handler = value }
      send(data: unknown) { this.sent.push(data) }
      receive(data: unknown) {
        for (const listener of this.handlers.get("message") ?? []) listener({ data })
        this.handler?.({ data })
      }
    }
    const beforeSend = Object.getOwnPropertyDescriptor(BunStyleSocket.prototype, "send")!
    const frames: Frame[] = []
    const observer = installWebSocketModelObserver({
      isModelSocket: isResponsesSocket,
      onFrame: (input) => { frames.push({ ...input }) },
      webSocketConstructor: BunStyleSocket,
    })
    expect(observer).not.toBeNull()
    try {
      const socket = new BunStyleSocket("wss://relay.test:4438/v1/responses")
      socket.on("message", () => {})
      socket.send(JSON.stringify({ type: "response.create", model: "gpt-6-astra" }))
      socket.receive(JSON.stringify({ type: "response.created", response: { model: "gpt-6-astra-x" } }))
      socket.onmessage = () => {}
      socket.receive('{"model":"via-onmessage"}')
      expect(frames.map((frame) => [frame.direction, frame.text])).toEqual([
        ["out", JSON.stringify({ type: "response.create", model: "gpt-6-astra" })],
        ["in", JSON.stringify({ type: "response.created", response: { model: "gpt-6-astra-x" } })],
        ["in", '{"model":"via-onmessage"}'],
      ])
    } finally {
      observer!.dispose()
      // Shadowing inherited on/once is undone by deleting the own properties.
      expect(Object.hasOwnProperty.call(BunStyleSocket.prototype, "on")).toBe(false)
      expect(Object.hasOwnProperty.call(BunStyleSocket.prototype, "once")).toBe(false)
      expect(Object.getOwnPropertyDescriptor(BunStyleSocket.prototype, "send")).toEqual(beforeSend)
    }
  })
})
