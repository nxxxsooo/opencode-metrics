## Why

OpenCode v2 drives the built-in OpenAI provider (and xAI/Azure Responses) over the Responses WebSocket transport. WebSocket traffic never passes through the `http.request`/`http.response` session hooks that opencode-metrics uses as its model-evidence capture boundary, so sessions on those models show `Request model: unknown`, `Response model: unknown`, and `Model evidence: not captured` while token metrics keep working. Users who prefer WebSocket (session connection reuse, incremental upload) currently have to choose between transport performance and evidence capture; the plugin should support both.

## What Changes

- Register the `model.request` session hook as a transport-independent fallback for the requested model (`Model.Ref.id`, primary kind only).
- Add a fail-open, passive WebSocket observer in the server entry: install one extra `message` listener and scan outgoing `send` payloads on sockets whose URL targets a Responses WebSocket route (`/responses`), reusing the bounded `createModelJsonScanner` for `response.model`/`model` paths.
- Attribute each observed socket to a session by correlating the socket URL with the `baseURL` of recent primary `model.request` events (WeakMap, computed once per socket).
- Extend `ModelIdentity` with a transport marker so the sidebar evidence line distinguishes `HTTP <source>` from `WS <source>`, and keep request-model precedence: HTTP body evidence > WS outgoing body > configured `model.request` value.
- Keep everything behind the existing `modelMonitor` opt-in; no capture, patching, or RPC exposure when disabled.

## Capabilities

### New Capabilities
- `model-evidence`: Capture, attribution, precedence, persistence, and display behavior of request/response model evidence across HTTP and WebSocket transports.

### Modified Capabilities
- None. Token metrics, scope rules, and the opt-in modelMonitor gate are unchanged.

## Impact

Affected areas include `src/server.ts`, a new `src/ws-observer.ts`, `src/model-identity.ts` (transport field), `src/model-evidence.ts`, `src/components/SidebarMetrics.tsx` (evidence-line rendering), `src/model-identity-rpc.ts` (pass-through of the new field), `tests/` mirrors, and TROUBLESHOOTING plus README evidence-level documentation. The RPC name, storage keys, and per-session retention limits stay unchanged; persisted evidence gains one optional field that older readers ignore.
