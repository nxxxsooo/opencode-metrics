## Purpose

Defines how one opencode-metrics TUI package remains session-correct, diagnosable, and safely degradable across supported OpenCode stable and V2 host generations.

## ADDED Requirements

### Requirement: One package supports both host generations
The plugin SHALL use the same package entry, installation configuration, and preferences schema on the supported OpenCode 1.18.x line and the selected V2 validation line.

#### Scenario: Stable host loads the plugin
- **WHEN** the package is installed in a supported OpenCode 1.18.x TUI
- **THEN** the Metrics sidebar registers and uses the attached session ID

#### Scenario: V2 host loads the plugin
- **WHEN** the same package is installed in the selected V2 TUI baseline
- **THEN** the Metrics sidebar registers without requiring a version-specific package or configuration

### Requirement: Host capabilities are detected without guessing by version
The plugin SHALL select event, hydration, child-discovery, and render facilities by structural capability and SHALL NOT assign data to a fallback session merely because a host capability or session identifier is missing.

#### Scenario: Event lacks session identity
- **WHEN** an otherwise recognized event contains no verifiable session ID
- **THEN** the event is ignored and does not update the most recently active session

#### Scenario: Historical state capability is unavailable
- **WHEN** synchronous TUI state is unavailable but a public session-message client is available
- **THEN** the plugin attempts hydration through that client

### Requirement: Missing capabilities degrade honestly
The plugin SHALL distinguish unsupported capabilities, temporary errors, and successful empty results and SHALL keep independent realtime metrics operational when historical or tree hydration is unavailable.

#### Scenario: All historical hydration paths are unavailable
- **WHEN** neither TUI state nor the public messages client can provide history
- **THEN** live events can still populate current-session metrics and no historical total is invented

#### Scenario: Child discovery is unavailable
- **WHEN** no public child-session relationship source is available
- **THEN** tree scope contains only relationships already verified from events and never guesses unrelated sessions

### Requirement: Cross-generation event delivery is safe
The plugin SHALL accept supported legacy, direct-data, and durable event envelopes and SHALL count a provider step at most once across canonical, versioned, and projected event deliveries.

#### Scenario: Equivalent usage arrives through two event families
- **WHEN** a step usage is delivered through both a session-next event and a message projection
- **THEN** output and cache totals increase exactly once

#### Scenario: Malformed event is followed by a valid event
- **WHEN** a malformed or unknown event is received before a valid session event
- **THEN** the malformed event does not crash the plugin or prevent the valid event from being processed

### Requirement: Host resources are disposed safely
The plugin SHALL release host event subscriptions, timers, watchers, and pending-result effects when its TUI lifecycle is disposed.

#### Scenario: TUI window detaches during asynchronous hydration
- **WHEN** the plugin is disposed before an asynchronous hydration request completes
- **THEN** the completed request does not mutate collector state or request a render

### Requirement: Compatibility claims match evidence
The project SHALL keep reproducible stable and explicit V2 candidate validation baselines and SHALL reserve a final V2 support claim for a runnable official V2 host that passes real plugin-load and session-isolation smoke tests.

#### Scenario: Candidate only passes compile and contract tests
- **WHEN** no official runnable V2 release has completed the smoke gate
- **THEN** documentation describes V2 readiness rather than verified final runtime support
