## MODIFIED Requirements

### Requirement: Hydration outside the render hot path
Session hydration SHALL prefer available TUI state, fall back to the public session-message client when state is unavailable, parse history at most once per session on success, retry no more often than every 2 seconds on failure, and SHALL seed the trailing turn's totals (steps since the last user message) plus sticky context. An unavailable history capability SHALL NOT prevent later live events from populating metrics.

#### Scenario: Reopened session shows last turn
- **GIVEN** a TUI restart on an idle session whose last turn spanned 28 steps
- **WHEN** the sidebar first renders
- **THEN** Tokens show the summed last-turn output and latest context, frozen

#### Scenario: Public client fallback restores history
- **GIVEN** synchronous TUI state is unavailable and the public messages client returns the session history
- **WHEN** the sidebar first renders
- **THEN** Tokens show the same trailing-turn totals that state hydration would produce

#### Scenario: No per-tick reparse
- **WHEN** the sidebar polls the collector every 200ms after successful hydration
- **THEN** session history is not reparsed

#### Scenario: Existing descendants are discovered after attach
- **GIVEN** child sessions existed before the TUI attached
- **WHEN** tree scope first hydrates
- **THEN** the collector recursively restores their parent links without waiting for new session-created events

#### Scenario: History unavailable but live events arrive
- **GIVEN** neither history source is available
- **WHEN** valid live events arrive for the attached session
- **THEN** current metrics update from those events without invented historical values
