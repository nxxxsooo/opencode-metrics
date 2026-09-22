import { afterEach, describe, expect, test } from "bun:test"
import server from "../src/server"

type Hook = (event: any) => Promise<void> | void
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

async function location() {
  const hooks = new Map<string, Hook>()
  const saved = new Map<string, unknown>()
  const writes: unknown[] = []
  let get: (input: { sessionID: string }) => Promise<any>
  const dispose = await server.setup({
    app: { version: "2.0.12" },
    options: { modelMonitor: true },
    session: { hook: async (name: string, callback: Hook) => {
      hooks.set(name, callback)
      return { dispose: async () => { hooks.delete(name) } }
    } },
    storage: {
      get: async (key: string) => saved.get(key),
      set: async (key: string, value: unknown) => { saved.set(key, value); writes.push(value) },
    },
    rpc: { register: async (_definition: unknown, handlers: { get: typeof get }) => {
      get = handlers.get
      return { dispose: async () => {} }
    } },
  } as any)
  cleanups.push(dispose as () => Promise<void>)
  return { hooks, saved, writes, get: (sessionID: string) => get({ sessionID }) }
}

const request = (sessionID: string, model = "alias") => ({
  sessionID, kind: "primary", agent: "build", model: { providerID: "openai", id: model },
  baseURL: "https://shared-relay.test/v1", headers: {},
})

describe("server native WebSocket evidence", () => {
  test("two locations sharing a provider capture their own concurrent WS responses without prototype patches", async () => {
    const originalSend = Object.getOwnPropertyDescriptor(WebSocket.prototype, "send")
    const a = await location()
    const b = await location()
    expect(Object.getOwnPropertyDescriptor(WebSocket.prototype, "send")).toEqual(originalSend)
    for (const host of [a, b]) {
      expect(host.hooks.has("experimental.ws.send")).toBe(true)
      expect(host.hooks.has("experimental.ws.receive")).toBe(true)
    }
    await a.hooks.get("model.request")!(request("session-a", "configured-a"))
    await b.hooks.get("model.request")!(request("session-b", "configured-b"))
    const outgoing = Object.freeze({ ...request("session-a"), frame: '{"type":"response.create","model":"wire-a"}' })
    await a.hooks.get("experimental.ws.send")!(outgoing)
    const incoming = Object.freeze({ ...request("session-b"), frame: '{"type":"response.created","response":{"model":"actual-b"}}' })
    await b.hooks.get("experimental.ws.receive")!(incoming)
    await a.hooks.get("experimental.ws.receive")!({ ...request("session-a"), frame: '{"response":{"model":"actual-a"}}' })
    expect(await a.get("session-a")).toMatchObject({ requested: "wire-a", reported: "actual-a", source: "response.model", transport: "websocket", previous: false })
    expect(await b.get("session-b")).toMatchObject({ requested: "configured-b", reported: "actual-b", transport: "websocket", previous: false })
    expect(a.saved.has("model/session-b")).toBe(false)
    expect(b.saved.has("model/session-a")).toBe(false)
    expect(outgoing.frame).toBe('{"type":"response.create","model":"wire-a"}')
    expect(incoming.frame).toBe('{"type":"response.created","response":{"model":"actual-b"}}')
  })

  test("reused connections refresh evidence per request and ignore auxiliary or malformed frames", async () => {
    const host = await location()
    const receive = host.hooks.get("experimental.ws.receive")!
    expect(receive).toBeFunction()
    await host.hooks.get("model.request")!(request("s"))
    await receive({ ...request("s"), frame: '{"response":{"model":"first"}}' })
    await host.hooks.get("model.request")!(request("s", "new-alias"))
    expect(await host.get("s")).toMatchObject({ reported: "first", previous: true })
    await receive({ ...request("s"), kind: "title", frame: '{"model":"title-model"}' })
    await receive({ ...request("s"), frame: "not-json" })
    expect(host.writes).toHaveLength(1)
    expect(await host.get("s")).toMatchObject({ reported: "first", previous: true })
    await receive({ ...request("s"), frame: '{"response":{"model":"second"}}' })
    expect(await host.get("s")).toMatchObject({ requested: "new-alias", reported: "second", previous: false })
    expect(host.saved.get("model/s")).toMatchObject({ reported: "second", transport: "websocket" })
  })

  test("switching from HTTP to WS resets the request model and preserves passthrough HTTP capture", async () => {
    const host = await location()
    const event = { ...request("s", "http-alias"), request: new Request("https://relay.test/v1/responses", {
      method: "POST", body: '{"model":"http-wire"}',
    }), response: new Response('data: {"model":"http-actual"}\n\n', { headers: { "content-type": "text/event-stream" } }) }
    await host.hooks.get("model.request")!(event)
    await host.hooks.get("http.request")!(event)
    await host.hooks.get("http.response")!(event)
    expect(await event.response.text()).toBe('data: {"model":"http-actual"}\n\n')
    expect(await host.get("s")).toMatchObject({ requested: "http-wire", reported: "http-actual", previous: false })
    await host.hooks.get("model.request")!(request("s", "ws-alias"))
    await host.hooks.get("experimental.ws.receive")!({ ...request("s"), frame: '{"response":{"model":"ws-actual"}}' })
    expect(await host.get("s")).toMatchObject({ requested: "ws-alias", reported: "ws-actual", transport: "websocket", previous: false })
  })
})
