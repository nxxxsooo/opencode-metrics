import { describe, expect, test } from "bun:test"
import { createModelParser, modelIdentifier, readRequestModel, reportedModel } from "../src/model-identity"
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
  test("model monitoring is opt-in and disabled values touch no HTTP, RPC or storage", async () => {
    for (const options of [undefined, {}, { modelMonitor: false }, { modelMonitor: "true" }, { modelMonitor: 1 }]) {
      // No other host capabilities are provided: any access fails the test.
      expect(await server.setup({ options } as Parameters<typeof server.setup>[0])).toBeUndefined()
    }
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
    await server.setup({ options: { modelMonitor: false } } as Parameters<typeof server.setup>[0])
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
