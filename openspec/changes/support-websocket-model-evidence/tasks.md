## 1. Transport-independent requested-model seed

- [x] 1.1 Register the `model.request` hook for `kind === "primary"` in `server.ts`, seeding the evidence's requested model and recording sessionID/baseURL/time for attribution
- [x] 1.2 Add optional `transport` to `ModelIdentity`, set it wherever evidence lands, and pass it through the RPC and storage round-trip
- [x] 1.3 Unit-test precedence: HTTP body evidence > WS outgoing frame > `model.request` configured value

## 2. Passive WebSocket observer

- [x] 2.1 Add `src/ws-observer.ts`: install-once prototype patch for the available registration primitives (`addEventListener`, inherited `on`/`once`, `onmessage` setter) and `send`; URL filter for `ws(s)://…/responses`; WeakSet dedup of the internal listener; fail-open delegation and dispose-restore
- [x] 2.2 Scan frames and outgoing payloads with a fresh bounded `createModelJsonScanner` per message; skip binary frames; swallow all observer errors
- [x] 2.3 Attribute sockets to sessions via baseURL correlation with recent primary `model.request` records (WeakMap, once per socket)
- [x] 2.4 Unit-test with fake WebSocket prototypes: patch/restore, double-install guard, observer exceptions never reach the original listeners, non-matching URLs ignored, EventEmitter-style inherited `on`/`once` shape

## 3. Rendering and persistence

- [x] 3.1 Render the evidence line as `HTTP <source>` / `WS <source>` in `SidebarMetrics.tsx`, keeping "not captured" for sessions with no boundary evidence
- [x] 3.2 Test persistence round-trip with and without the `transport` field (older records read as HTTP)

## 4. Verification and documentation

- [x] 4.1 Run typecheck, build, package check, and the full test suite
- [x] 4.2 Live smoke test on a real Responses WebSocket session: requested and reported models populated, evidence line shows `WS`; an HTTP session still shows `HTTP` (verified 2026-09-21 against OpenCode 2.0.11 with `openai/gpt-6-astra` via the sub2api relay: persisted evidence `{"requested":"gpt-6-astra","reported":"gpt-6-astra","source":"response.model","transport":"websocket"}`; title requests over the same provider ran through HTTP hooks)
- [x] 4.3 Update TROUBLESHOOTING and the English/Chinese README evidence-level sections (replace "WebSocket unsupported" with the opt-in observation behavior and its attribution caveat)
