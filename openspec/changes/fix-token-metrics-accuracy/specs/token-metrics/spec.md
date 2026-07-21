# token-metrics — Spec Delta

## ADDED Requirements

### Requirement: Turn-cumulative output tokens

The sidebar Tokens row SHALL display output tokens accumulated across all provider steps of the current turn (finalized steps summed exactly, plus the in-flight step's streaming estimate), where a turn starts at a user message or busy transition and ends at session idle.

#### Scenario: Output survives tool-call step boundaries

- **GIVEN** a turn whose first step ended with `tokens.output=422` and a second step is streaming
- **WHEN** the sidebar renders
- **THEN** displayed output tokens are `422 + <second step estimate>`, never resetting to the latest step alone

#### Scenario: New turn resets totals

- **WHEN** a new user message starts the next turn
- **THEN** turn totals reset and accumulation restarts

### Requirement: Sticky context input tokens

The Tokens row SHALL display input as the latest known request context size (`input + cache.read + cache.write`) and SHALL retain the previous step's context while a new step is in flight; the user-text estimate applies only before any exact context exists in the session.

#### Scenario: No collapse at step start

- **GIVEN** a finalized step with context 142,281 tokens
- **WHEN** the next step starts streaming and its exact usage has not arrived
- **THEN** displayed input remains 142,281 (not a user-text estimate)

### Requirement: Observable rolling real-time speed

Speed SHALL be calculated from observable token deltas in a rolling window of at most 3 seconds, SHALL become unavailable when no observable delta has arrived for 2 seconds, and SHALL never use turn, request, or session wall time as its denominator.

#### Scenario: Tool execution is not reported as generation

- **GIVEN** a step finished streaming and a tool is executing
- **WHEN** two seconds pass without an observable delta
- **THEN** Speed displays `—`, not a decaying or frozen t/s value

#### Scenario: Tree speed sums concurrent live streams

- **GIVEN** two descendant sessions have live observable rates of 24.0 t/s and 31.5 t/s
- **WHEN** the tree-scoped sidebar renders
- **THEN** Speed displays 55.5 t/s

#### Scenario: Hidden reasoning is not fabricated

- **GIVEN** final usage reports reasoning tokens that had no corresponding live delta
- **WHEN** the step finalizes
- **THEN** those tokens update finalized Tokens output but do not create a live-Speed spike

### Requirement: Correctly scoped time indicators

TTFT SHALL measure the foreground session's latest provider step start to its first observable delta. Elapsed SHALL measure the foreground turn's wall time and freeze at foreground idle. Session SHALL measure selected-scope busy wall time using interval union in tree scope.

#### Scenario: TTFT never mixes descendants

- **GIVEN** a foreground step and child step have different starts and first-token timestamps
- **WHEN** tree scope renders TTFT
- **THEN** TTFT uses the foreground step's matching start and first-token timestamps

#### Scenario: Parallel children do not double-count Session

- **GIVEN** two children are busy over the same 10-second interval
- **WHEN** tree-scoped Session is calculated
- **THEN** the overlapping interval contributes 10 seconds, not 20 seconds

#### Scenario: Elapsed follows the foreground turn

- **GIVEN** stale completed descendant metrics from an earlier turn remain hydrated
- **WHEN** a new foreground turn runs for 30 seconds
- **THEN** Elapsed reports 30 seconds rather than the age of the oldest descendant metric

### Requirement: Idempotent step finalization

Each provider step SHALL be counted into turn totals exactly once, keyed by `assistantMessageID`, regardless of duplicate delivery across canonical and versioned (`.1`/`.2`) event names or across `session.next.step.ended` and positive-token `message.updated` for the same message.

#### Scenario: Double delivery counts once

- **WHEN** the same step's usage arrives via `session.next.step.ended` and again via `message.updated`
- **THEN** turn output increases by that step's output exactly once

#### Scenario: Un-finalized step retires on idle

- **GIVEN** a step streamed an estimate but no exact usage arrived
- **WHEN** the session goes idle
- **THEN** the estimate is retired into turn totals (not lost)

### Requirement: Single-count streaming estimates across event families

Streaming text/reasoning estimates SHALL be deduplicated per part across `message.part.delta`, `message.part.updated`, and `session.next.*.delta`, and estimates SHALL be replaced by exact usage upon step finalization.

#### Scenario: V1 delta plus part update counts once

- **WHEN** `message.part.delta` fragments and a `message.part.updated` snapshot describe the same part text
- **THEN** the part contributes its estimate once

### Requirement: Hydration outside the render hot path

Session hydration SHALL parse history at most once per session on success, retry no more often than every 2 seconds on failure, and SHALL seed the trailing turn's totals (steps since the last user message) plus sticky context.

#### Scenario: Reopened session shows last turn

- **GIVEN** a TUI restart on an idle session whose last turn spanned 28 steps
- **WHEN** the sidebar first renders
- **THEN** Tokens show the summed last-turn output and latest context, frozen

#### Scenario: No per-tick reparse

- **WHEN** the sidebar polls the collector every 200ms after successful hydration
- **THEN** session history is not reparsed

#### Scenario: Existing descendants are discovered after attach

- **GIVEN** child sessions existed before the TUI attached
- **WHEN** tree scope first hydrates
- **THEN** the collector recursively restores their parent links without waiting for new session-created events
