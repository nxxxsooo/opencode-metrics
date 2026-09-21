## Purpose

Defines how opencode-metrics captures, attributes, persists, and displays request/response model evidence across provider HTTP and Responses WebSocket transports, under the existing opt-in modelMonitor gate.

## ADDED Requirements

### Requirement: Opt-in model evidence capture
The server entry SHALL capture request and response model evidence only when `modelMonitor` is explicitly enabled, and SHALL register no HTTP hooks, WebSocket observer, or model RPC when it is disabled.

#### Scenario: Monitoring disabled
- **WHEN** `modelMonitor` is not `true` in the plugin options or config file
- **THEN** no request body is read, no WebSocket prototype is patched, and no model RPC is exposed

### Requirement: Transport-independent requested model
The plugin SHALL seed the requested model from the `model.request` session hook for primary requests and SHALL prefer higher-fidelity sources in the order: HTTP request body, WebSocket outgoing frame, configured model reference.

#### Scenario: WebSocket session seeds from model.request
- **GIVEN** a primary request over the Responses WebSocket transport
- **WHEN** the `model.request` hook fires before any frame is observed
- **THEN** the requested model shows the configured model ID

#### Scenario: HTTP body evidence wins
- **GIVEN** a seeded requested model from `model.request`
- **WHEN** the HTTP request body contains a top-level `model`
- **THEN** the requested model reflects the body value, not the configured value

### Requirement: Passive WebSocket observation
While model evidence monitoring is enabled, the server entry MAY observe Responses WebSocket traffic by attaching one additional passive listener per matching socket and scanning outgoing payloads, and SHALL NOT alter, delay, or drop any frame, listener registration, or send operation.

#### Scenario: Observer cannot break traffic
- **GIVEN** a matching socket whose frames raise an exception inside the observer
- **WHEN** a frame arrives and a listener is registered
- **THEN** the original listeners still receive the frame and the exception is swallowed

#### Scenario: Non-provider sockets are ignored
- **GIVEN** a WebSocket whose URL path does not end with `/responses`
- **WHEN** messages arrive on it
- **THEN** no evidence is captured and no observer listener is attached

### Requirement: Honest transport labeling
The evidence line SHALL distinguish the transport a piece of evidence came from (`HTTP <source>` vs `WS <source>`) and SHALL show "not captured" only when no boundary evidence exists for either transport; a reported model remains boundary evidence, never a verified upstream identity.

#### Scenario: WebSocket session shows WS evidence
- **GIVEN** a Responses WebSocket session whose `response.created` frame contains `response.model`
- **WHEN** the sidebar renders the evidence line
- **THEN** it displays `WS response.model`

### Requirement: Bounded and fail-open observation
WebSocket observation SHALL be bounded per frame, SHALL restore all patched prototype members on disposal, SHALL guard against double installation, and SHALL leave HTTP capture and token metrics fully operational when the observer observes nothing.

#### Scenario: Disposal restores the prototype
- **GIVEN** an installed observer
- **WHEN** the server plugin is disposed
- **THEN** the patched prototype members are restored to their originals and later sockets attach no observer
