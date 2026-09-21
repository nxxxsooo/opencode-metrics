import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { LLMSpan } from "@traceloop/node-server-sdk"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createModelParser, modelIdentifier, readRequestModel, reportedModel } from "../src/model-identity"
import { resetConfig } from "../src/config"
import server from "../src/server"

const encoder = new TextEncoder()
const internal = "gpt-6-luna-exp-1p-arm2-codexswic-ev3"

describe("local model evidence", () => {
  test("reads actual request body, never a configured alias", async () => {
    expect(await readRequestModel(new Request("https://example.test/responses", {
      method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", input: "private" }),
    }))).toBe("gpt-5.6-luna")
    expect(await readRequestModel(new Request("https://example.test"))).toBeNull()
    expect(reportedModel({ modelID: internal })).toBeNull()
    expect(modelIdentifier("bad\x1b[31m")).toBeNull()
  })

  test("Responses, Chat Completions and Anthropic model fields", () => {
    expect(reportedModel({ response: { model: internal } })).toEqual({ model: internal, source: "response.model" })
    expect(reportedModel({ model: "chat-model" })?.source).toBe("model")
    expect(reportedModel({ message: { model: "claude-model" } })?.source).toBe("message.model")
    expect(reportedModel({ choices: [{ message: { content: internal } }] })).toBeNull()
  })

  test("fragmented UTF-8 / CRLF / multiline SSE preserves complete identifiers", () => {
    const found: string[] = []
    const parser = createModelParser(true, (model) => found.push(model))
    const bytes = encoder.encode(`event: response.created\r\ndata: {"response":\r\ndata: {"model":"${internal}","text":"中文"}}\r\n\r\ndata: [DONE]\n\n`)
    for (const byte of bytes) parser.push(new Uint8Array([byte]))
    parser.end()
    expect(found).toEqual([internal])
  })

  test("oversized events are discarded and subsequent model events recover", () => {
    const found: string[] = []
    const parser = createModelParser(true, (model) => found.push(model))
    parser.push(encoder.encode(`data: ${"x".repeat(100_000)}\n\ndata: {"model":"${internal}"}\n\n`))
    parser.end()
    expect(found).toEqual([internal])
  })

  test("extracts model after huge echoed instructions without retaining their content", () => {
    const found: string[] = []
    const parser = createModelParser(true, (model) => found.push(model))
    const bytes = encoder.encode(`data: {"response":{"instructions":"${"private ".repeat(200_000)}","model":"${internal}"}}\n\n`)
    for (let i = 0; i < bytes.length; i += 4096) parser.push(bytes.slice(i, i + 4096))
    parser.end()
    expect(found).toEqual([internal])
  })

  test("JSON, missing fields, invalid JSON and end-of-stream SSE", () => {
    for (const sse of [false, true]) {
      const found: string[] = []
      const parser = createModelParser(sse, (model) => found.push(model))
      parser.push(encoder.encode(`${sse ? "data: " : ""}{"model":"${internal}"}`))
      parser.end()
      expect(found).toEqual([internal])
    }
    const parser = createModelParser(false, () => { throw new Error("should not be called") })
    parser.push(encoder.encode("not json"))
    parser.end()
  })
})

interface HookEvent {
  sessionID: string
  kind: string
  request: Request
  response: Response
}

interface ModelRequestHookEvent {
  sessionID: string
  kind: string
  model: { id: string; providerID: string }
  baseURL?: string
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readonly url: string
  readonly listeners = new Map<string, Array<(event: unknown) => void>>()
  private handler: ((event: unknown) => void) | null = null
  constructor(url: string) { this.url = url; FakeWebSocket.instances.push(this) }
  addEventListener(type: string, listener: (event: unknown) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }
  get onmessage(): ((event: unknown) => void) | null { return this.handler }
  set onmessage(value: ((event: unknown) => void) | null) { this.handler = value }
  send(_data: unknown) {}
  receive(data: unknown) {
    for (const listener of this.listeners.get("message") ?? []) listener({ data })
    this.handler?.({ data })
  }
}

// Isolate HOME so a developer machine's global modelMonitor config cannot
// flip the config-file fallback in tests that rely on the option gate alone.
const originalHome = process.env.HOME
function isolateHome(): string {
  const root = mkdtempSync(join(tmpdir(), "opencode-metrics-home-"))
  process.env.HOME = root
  return root
}
afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
})

async function harness(saved = new Map<string, unknown>()) {
  const hooks = new Map<string, (event: HookEvent) => Promise<void>>()
  let get: (input: unknown) => Promise<unknown> = async () => null
  const cleanup = await server.setup({
    options: { modelMonitor: true },
    storage: { get: async (key: string) => saved.get(key), set: async (key: string, value: unknown) => { saved.set(key, value) } },
    rpc: { register: async (_definition: unknown, handlers: { get: typeof get }) => {
      get = handlers.get
      return { dispose: async () => {} }
    } },
    session: { hook: async (name: string, callback: (event: HookEvent) => Promise<void>) => {
      hooks.set(name, callback)
      return { dispose: async () => { hooks.delete(name) } }
    } },
  } as unknown as Parameters<typeof server.setup>[0])
  return { hooks, get: (sessionID: string) => get({ sessionID }), cleanup }
}

function event(sessionID: string, model: string, body: string, kind = "primary"): HookEvent {
  return {
    sessionID, kind,
    request: new Request("https://example.test/v1/responses", { method: "POST", body: JSON.stringify({ model, input: "SECRET" }) }),
    response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
  }
}

describe("server HTTP hooks", () => {
  test.each([
    ["application/json", '{"model":"replacement"}', "model"],
    ["text/event-stream", 'data: {"model":"replacement","choices":[]}\n\n', "model"],
    ["text/event-stream", 'data: {"response":{"model":"replacement","instructions":"PRIVATE"}}\n\n', "response.model"],
    ["text/event-stream", 'data: {"message":{"model":"replacement","content":[]}}\n\n', "message.model"],
  ])("OpenLLMetry records %s evidence from %s", async (contentType, body, source) => {
    const requestSpy = spyOn(LLMSpan.prototype, "reportRequest")
    const responseSpy = spyOn(LLMSpan.prototype, "reportResponse")
    const saved = new Map<string, unknown>()
    const h = await harness(saved)
    try {
      const e = event("upstream", "retired", body)
      // Supply fragmented bytes through the real HTTP-hook -> SDK -> RPC path.
      const bytes = encoder.encode(body)
      e.response = new Response(new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
          controller.close()
        },
      }), { headers: { "content-type": contentType, "x-test": "preserved" } })
      await h.hooks.get("http.request")!(e)
      // Verify the final rewritten request is also reported through the SDK.
      e.request = new Request(e.request.url, { method: "POST", body: '{"model":"final-alias","input":"PRIVATE"}' })
      await h.hooks.get("http.response")!(e)
      expect(await e.response.text()).toBe(body)
      expect(e.response.headers.get("x-test")).toBe("preserved")
      expect(requestSpy.mock.calls.map(([input]) => input)).toEqual([
        { model: "retired", messages: [] }, { model: "final-alias", messages: [] },
      ])
      expect(responseSpy.mock.calls.map(([input]) => input)).toEqual([{ model: "replacement" }])
      expect(await h.get("upstream")).toMatchObject({ requested: "final-alias", reported: "replacement", source })
      expect(saved.get("model/upstream")).toMatchObject({ requested: "final-alias", reported: "replacement", source })
      expect(Object.keys(saved.get("model/upstream") as object).sort()).toEqual([
        "observedAt", "reported", "requested", "source",
      ])
      expect(JSON.stringify([...saved])).not.toContain("PRIVATE")
    } finally {
      requestSpy.mockRestore()
      responseSpy.mockRestore()
      await h.cleanup?.()
    }
  })

  test("model monitoring is opt-in and disabled values touch no HTTP, RPC or storage", async () => {
    const home = isolateHome()
    resetConfig()
    try {
      for (const options of [undefined, {}, { modelMonitor: false }, { modelMonitor: "true" }, { modelMonitor: 1 }]) {
        // No other host capabilities are provided: any access fails the test.
        expect(await server.setup({ options } as Parameters<typeof server.setup>[0])).toBeUndefined()
      }
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  test("reports a provider's declared replacement model without guessing missing evidence", async () => {
    const h = await harness()
    try {
      const routed = event("routed", "retired-model-alias", '{"model":"replacement-flash"}')
      routed.response = new Response('{"model":"replacement-flash"}', {
        headers: { "content-type": "application/json" },
      })
      await h.hooks.get("http.request")!(routed)
      await h.hooks.get("http.response")!(routed)
      expect(await routed.response.text()).toBe('{"model":"replacement-flash"}')
      expect(await h.get("routed")).toMatchObject({
        requested: "retired-model-alias", reported: "replacement-flash", source: "model",
      })
      const hidden = event("hidden", "retired-model-alias", 'data: {"choices":[]}\n\n')
      await h.hooks.get("http.request")!(hidden)
      await h.hooks.get("http.response")!(hidden)
      await hidden.response.text()
      expect(await h.get("hidden")).toMatchObject({ requested: "retired-model-alias", reported: null })
    } finally { await h.cleanup?.() }
  })

  test("retains the last reported pair while waiting and restores it after reload", async () => {
    const saved = new Map<string, unknown>()
    const h = await harness(saved)
    const first = event("a", "alias", `data: {"model":"${internal}"}\n\n`)
    await h.hooks.get("http.request")!(first)
    await h.hooks.get("http.response")!(first)
    await first.response.text()
    const next = event("a", "next", "data: {}\n\n")
    await h.hooks.get("http.request")!(next)
    expect(await h.get("a")).toMatchObject({ requested: "alias", reported: internal, previous: true })
    await h.cleanup?.()
    // Turning collection off does not read or erase previously retained evidence.
    const beforeDisable = JSON.stringify([...saved])
    const home = isolateHome()
    resetConfig()
    try {
      await server.setup({ options: { modelMonitor: false } } as Parameters<typeof server.setup>[0])
    } finally {
      if (originalHome === undefined) delete process.env.HOME
      else process.env.HOME = originalHome
      rmSync(home, { recursive: true, force: true })
      resetConfig()
    }
    expect(JSON.stringify([...saved])).toBe(beforeDisable)
    const reloaded = await harness(saved)
    expect(await reloaded.get("a")).toMatchObject({ requested: "alias", reported: internal })
    expect(JSON.stringify([...saved.values()])).not.toContain("SECRET")
    await reloaded.cleanup?.()
  })
  test("passes through bytes, isolates sessions, excludes title calls and retains no content", async () => {
    const h = await harness()
    const body = `data: {"response":{"model":"${internal}"}}\n\ndata: {"delta":"SECRET"}\n\n`
    const a = event("a", "alias", body)
    const b = event("b", "other", "data: {}\n\n")
    const title = event("a", "title", 'data: {"model":"title"}\n\n', "title")
    for (const e of [a, b, title]) {
      await h.hooks.get("http.request")!(e)
      await h.hooks.get("http.response")!(e)
    }
    expect(await a.response.text()).toBe(body)
    await b.response.text()
    await title.response.text()
    expect(await h.get("a")).toMatchObject({ requested: "alias", reported: internal, source: "response.model" })
    expect(await h.get("b")).toMatchObject({ requested: "other", reported: null })
    expect(JSON.stringify(await h.get("a"))).not.toContain("SECRET")
    await h.cleanup?.()
  })

  test("new requests reset evidence; old streams cannot contaminate the next request", async () => {
    const h = await harness()
    const old = event("a", "old", 'data: {"model":"old-real"}\n\n')
    await h.hooks.get("http.request")!(old)
    await h.hooks.get("http.response")!(old)
    const next = event("a", "new", "data: {}\n\n")
    await h.hooks.get("http.request")!(next)
    await old.response.text()
    expect(await h.get("a")).toMatchObject({ requested: "new", reported: null })
    await h.hooks.get("http.response")!(next)
    await next.response.text()
    expect(await h.get("a")).toMatchObject({ requested: "new", reported: null })
    await h.cleanup?.()
  })

  test("error bodies are not model evidence; reads final rewritten request", async () => {
    const h = await harness()
    const e = event("a", "alias", "")
    await h.hooks.get("http.request")!(e)
    e.request = new Request("https://example.test", { method: "POST", body: '{"model":"rewritten"}' })
    e.response = new Response('{"model":"error-label"}', { status: 400, headers: { "content-type": "application/json" } })
    await h.hooks.get("http.response")!(e)
    expect(await h.get("a")).toMatchObject({ requested: "rewritten", reported: null })
    expect(await e.response.text()).toContain("error-label")
    await h.cleanup?.()
  })
})

describe("server WebSocket observation", () => {
  const realWebSocket = globalThis.WebSocket
  afterEach(() => {
    globalThis.WebSocket = realWebSocket
    FakeWebSocket.instances.length = 0
  })

  async function wsHarness(saved = new Map<string, unknown>()) {
    // The server installs its observer on globalThis.WebSocket at setup time.
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    type AnyHookEvent = HookEvent | ModelRequestHookEvent
    const hooks = new Map<string, (event: AnyHookEvent) => Promise<void>>()
    let get: (input: unknown) => Promise<unknown> = async () => null
    const cleanup = await server.setup({
      options: { modelMonitor: true },
      storage: { get: async (key: string) => saved.get(key), set: async (key: string, value: unknown) => { saved.set(key, value) } },
      rpc: { register: async (_definition: unknown, handlers: { get: typeof get }) => {
        get = handlers.get
        return { dispose: async () => {} }
      } },
      session: { hook: async (name: string, callback: (event: AnyHookEvent) => Promise<void>) => {
        hooks.set(name, callback)
        return { dispose: async () => { hooks.delete(name) } }
      } },
    } as unknown as Parameters<typeof server.setup>[0])
    return { hooks, get: (sessionID: string) => get({ sessionID }), cleanup }
  }

  function modelRequest(sessionID: string, model: string, baseURL?: string): ModelRequestHookEvent {
    return { sessionID, kind: "primary", model: { id: model, providerID: "openai" }, baseURL }
  }

  test("captures configured request model and frame evidence over a Responses socket", async () => {
    const saved = new Map<string, unknown>()
    const h = await wsHarness(saved)
    try {
      await h.hooks.get("model.request")!(modelRequest("ws", "gpt-6-astra", "https://sub2api.mjshao.fun:4438/v1"))
      expect(await h.get("ws")).toMatchObject({ requested: "gpt-6-astra", reported: null, source: null })

      const socket = new FakeWebSocket("wss://sub2api.mjshao.fun:4438/v1/responses")
      socket.addEventListener("message", () => {})
      socket.send(JSON.stringify({ type: "response.create", model: "gpt-6-astra", input: [{ role: "user", content: "SECRET" }] }))
      socket.receive(JSON.stringify({ type: "response.created", response: { model: "gpt-6-astra-x" } }))
      expect(await h.get("ws")).toMatchObject({
        requested: "gpt-6-astra", reported: "gpt-6-astra-x", source: "response.model", transport: "websocket",
      })
      expect(saved.get("model/ws")).toMatchObject({ requested: "gpt-6-astra", reported: "gpt-6-astra-x", transport: "websocket" })
      expect(JSON.stringify([...saved])).not.toContain("SECRET")

      // A later primary request resets live evidence but retains the last reported pair.
      await h.hooks.get("model.request")!(modelRequest("ws", "gpt-5.6-sol", "https://sub2api.mjshao.fun:4438/v1"))
      expect(await h.get("ws")).toMatchObject({ requested: "gpt-6-astra", reported: "gpt-6-astra-x", previous: true })
    } finally { await h.cleanup?.() }
  })

  test("frames without an attributable session and non-responses sockets are ignored", async () => {
    const h = await wsHarness()
    try {
      const unrelated = new FakeWebSocket("wss://internal.test/session/live")
      unrelated.addEventListener("message", () => {})
      unrelated.receive('{"model":"internal"}')
      expect(await h.get("none")).toMatchObject({ requested: null, reported: null, source: null })

      // A model.request whose baseURL does not match the socket leaves frames unattributed.
      await h.hooks.get("model.request")!(modelRequest("other", "some-model", "https://api.openai.test/v1"))
      const socket = new FakeWebSocket("wss://relay.test:4438/v1/responses")
      socket.addEventListener("message", () => {})
      socket.receive(JSON.stringify({ response: { model: "unattributed" } }))
      expect(await h.get("other")).toMatchObject({ requested: "some-model", reported: null, source: null })
    } finally { await h.cleanup?.() }
  })

  test("HTTP body evidence outranks the configured model seed", async () => {
    const h = await wsHarness()
    try {
      await h.hooks.get("model.request")!(modelRequest("mix", "configured-alias", "https://example.test/v1"))
      const e = event("mix", "body-model", 'data: {"response":{"model":"replacement"}}\n\n')
      await h.hooks.get("http.request")!(e)
      await h.hooks.get("http.response")!(e)
      await e.response.text()
      expect(await h.get("mix")).toMatchObject({
        requested: "body-model", reported: "replacement", source: "response.model",
      })
      // HTTP evidence carries no transport marker, preserving the persisted shape.
      expect(Object.keys(await h.get("mix") as object).sort()).toEqual([
        "observedAt", "previous", "reported", "requested", "source",
      ])
    } finally { await h.cleanup?.() }
  })
})
