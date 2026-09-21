## Context

The server entry captures model evidence exclusively at the HTTP boundary: `http.request` clones and reads the request body for a top-level `model`, and `http.response` pipes the response stream through a bounded incremental scanner that recognizes `model`, `response.model`, and `message.model`. OpenCode v2 exposes exactly five session hooks (`session.prompt`, `session.context`, `model.request`, `http.request`, `http.response`) and none of them observe WebSocket traffic. The Responses WebSocket protocol sends `{"type":"response.create","model":...}` frames out and receives events such as `response.created`/`response.completed` whose `response.model` names the model the relay served — the same evidence the HTTP scanner already extracts, arriving on a transport the hooks never see.

Verified locally: Bun's `globalThis.WebSocket.prototype` exposes patchable `addEventListener`, `send`, and an `onmessage` descriptor, and OpenCode v2's executor consumes standard `globalThis.WebSocket`. OpenCode keeps one WebSocket connection open per session and reuses it across steps, which makes per-socket session attribution viable.

## Goals / Non-Goals

**Goals:**
- Capture request and response model evidence for Responses WebSocket sessions with the same honesty rules as HTTP evidence: the reported model is boundary evidence, never a verified upstream identity.
- Never alter provider traffic: observation adds listeners and reads copies; every layer is fail-open.
- Keep the `modelMonitor` opt-in gate and the existing RPC/storage identity unchanged.

**Non-Goals:**
- Supporting transports other than the Responses WebSocket route, or intercepting OpenCode's internal session/MCP WebSockets.
- Causally proving which session produced a frame when concurrent same-provider sessions race socket attribution.
- Changing token metrics, scope semantics, or the default-off monitoring posture.

## Decisions

### D1. `model.request` as the transport-independent requested-model fallback

The `model.request` hook fires for every session request before transport selection and carries `Model.Ref` (`id`, `providerID`), `kind`, and `baseURL`. For `kind === "primary"` it seeds the requested model with the configured ID and records the session/baseURL pair used later for socket attribution. HTTP body evidence and WS outgoing frames take precedence over this configured value because they reflect what was actually sent.

### D2. Passive prototype observer instead of listener wrapping

Do not wrap user listeners. Patch `WebSocket.prototype` once (only while modelMonitor is on) so that every available listener-registration primitive — `addEventListener`, EventEmitter-style `on`/`once` (often inherited, so originals are resolved through the prototype chain), and the `onmessage` setter — attaches one internal observer listener per socket (WeakSet dedup), while `send` scans a bounded copy of the outgoing text payload. The real OpenCode 2.0.11 server runtime exposes `addEventListener` only as an inherited method with no own descriptor, which is why registration originals must be chain-resolved. The observer is filtered by `this.url` to `ws(s)://` URLs whose path ends with `/responses`, which excludes internal session transport and MCP sockets. Every patched method delegates to the original inside `try/finally`; observer exceptions are swallowed; disposal restores saved own descriptors and deletes shadowing properties over inherited methods. A double-install guard prevents stacking observers.

### D3. Per-socket session attribution by baseURL correlation

Each observed socket is mapped once (WeakMap) to the session of the most recent primary `model.request` whose `baseURL` origin+path matches the socket URL with the `/responses` suffix removed. Sockets are pooled per session and reused across steps, so first-observation attribution is stable; the concurrent-same-provider race is documented rather than solved, and mis-attribution can only ever surface a genuinely observed model from the same provider.

### D4. Frame scanning reuses the bounded scanner

Each incoming frame and outgoing `send` payload is fed through a fresh `createModelJsonScanner` (the existing bounded parser), capped per frame, never buffered across frames. `response.created`/`response.completed` yield `response.model`; the outgoing `response.create` frame yields root `model`. Binary frames are skipped.

### D5. Transport marker on the identity, not a new RPC

`ModelIdentity` gains optional `transport?: "http" | "websocket"` set wherever evidence lands; the RPC and storage payloads pass it through untouched (older persisted records simply lack it). The sidebar evidence line renders `HTTP <source>` or `WS <source>`, and "not captured" remains the state where no boundary evidence of either transport exists.

## Risks / Trade-offs

- [Prototype patch in the shared server process] → Patch only under the explicit `modelMonitor` opt-in, delegate to originals in `try/finally`, swallow observer errors, restore on dispose, and guard double installation.
- [OpenCode switches to a non-global WebSocket implementation] → The observer silently observes nothing (no frames match); HTTP behavior is untouched. A live smoke test on a real WS session gates the release claim.
- [`model.request` hook shape differs at runtime] → Defensive parsing like every other boundary; a malformed record degrades to HTTP-only behavior.
- [Concurrent same-provider sessions cross-attribute sockets] → Documented heuristic; evidence stays real, only the session label can be wrong; per-socket WeakMap limits the window to socket creation time.
- [Oversized or malformed frames] → Per-frame bounded scan, exceptions swallowed, `[DONE]`/non-JSON frames ignored by the scanner.

## Migration Plan

1. Add `model.request` seeding and the transport field with tests, without touching HTTP capture behavior.
2. Add `src/ws-observer.ts` with unit tests against a fake WebSocket prototype; wire it into `server.ts` behind the modelMonitor gate.
3. Extend sidebar rendering and persistence round-trip tests for `transport`.
4. Live smoke test against a real Responses WebSocket session (e.g. `gpt-6-astra` via the sub2api relay) verifying requested/reported models and the `WS` evidence line; verify HTTP sessions still show `HTTP` evidence.
5. Update TROUBLESHOOTING and both READMEs' evidence-level sections; publish separately.
