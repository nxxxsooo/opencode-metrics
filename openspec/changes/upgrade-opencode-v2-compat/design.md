## Context

The plugin currently accepts a full `TuiPluginApi` in its collector and probes `api.state` for synchronous message hydration while probing `api.client.session.children` separately for asynchronous tree discovery. Event parsing already accepts legacy properties, direct V2 data, and durable envelopes, and step finalization is message-ID idempotent. The stable 1.18.16 and inspected TUI-V2 snapshot expose the same current TUI type surface, so compile-only snapshot testing is necessary but insufficient evidence of future runtime compatibility.

The working tree contained an intentional but unreproducible experiment changing SDK dependencies from 1.18.4 to `latest`; this change retains the upgrade intent while replacing the floating baseline with exact versions.

## Goals / Non-Goals

**Goals:**
- Isolate host API shape detection from metrics domain logic.
- Prefer synchronous TUI state, fall back to the public SDK client, and distinguish unavailable capabilities from empty results.
- Keep event ingestion structural, session-scoped, idempotent, and tolerant of envelope/version differences.
- Make stable and V2 candidate compatibility checks repeatable without mutating the release lockfile.
- Preserve clean disposal and controlled diagnostics.

**Non-Goals:**
- Supporting the Desktop UI, inventing metrics absent from the host, branching primarily on version strings, or maintaining two collector implementations.
- Redesigning metrics, configuration, or sidebar presentation.
- Claiming final V2 runtime support before a runnable official release passes the smoke gate.

## Decisions

### D1. One capability-detected host adapter

Introduce `MetricsHost`, a narrow interface covering event subscription, optional synchronous session snapshots, asynchronous message fallback, asynchronous child discovery, render requests, and disposal. `createOpenCodeHost(api)` performs structural capability checks once. Collector and hydration code consume this interface rather than the full TUI API.

Version-string dispatch was rejected because snapshots and stable releases can share or backport surfaces independently. Duplicating V1/V2 collectors was rejected because it would fork metric semantics and idempotency.

### D2. State-first hydration with client fallback

A synchronous TUI-state snapshot remains the fastest path and preserves first-paint behavior. When it is unavailable or not ready, the adapter calls the public client `session.messages` endpoint and normalizes `{ data, error }`. A successful empty result is different from capability absence or an error. Successful hydration remains once-per-session; failures remain throttled to one attempt per two seconds.

The async fallback applies its result only while the collector is alive and only if live state has not made the snapshot stale. This prevents historical data from overwriting an in-flight request.

### D3. Shared response normalization

Client messages and children use one response normalization contract: arrays may be direct or under `data`; a non-null `error` rejects the result; unsupported capability returns `null`. Parent links are accepted only from structurally valid child records.

### D4. Structural event parsing and bounded diagnostics

Event parsing continues to accept `properties`, direct `data`, and `syncEvent.data`. Canonical and `.1`/`.2` subscriptions continue to converge on message-ID finalization and bounded event-key deduplication. Missing session identity is ignored rather than assigned to the most recent session. Unknown or malformed payloads do not throw and are not dumped in logs.

### D5. Reproducible dependency and CI baselines

Pin stable dev dependencies exactly to 1.18.16 and keep host SDK/plugin packages as peers. Add a compatibility script that copies the package manifest and lock-independent source into a temporary directory, installs either the stable pair or an explicit V2 candidate, and runs typecheck/build/tests there. The main lockfile remains the release baseline. The V2 candidate is explicit rather than `latest`.

### D6. Evidence levels and release language

Automated tests and candidate compilation prove API-contract readiness; they do not prove a future runtime. README language distinguishes stable support from V2 readiness until the same package passes a real TUI load, current-session multi-attach, and tree-child smoke test on an official runnable V2 release.

## Risks / Trade-offs

- [Future V2 removes an essential public capability] → Keep realtime collection operational and render unavailable historical/tree values conservatively.
- [Async hydration races with live events] → Apply only through collector lifecycle/race guards and preserve live useful metrics.
- [Plugin resolves a second OpenTUI/Solid runtime] → Keep UI runtimes external/peer-backed and validate package contents plus real-host smoke tests.
- [Candidate snapshots disappear from npm] → Pin the candidate identifier in CI and update it deliberately; stable validation remains independent.
- [Compile matrix gives false confidence] → Gate any final V2 support claim on real runtime smoke evidence.

## Migration Plan

1. Pin the stable dependency baseline and establish the compatibility matrix.
2. Introduce the host adapter without changing metric semantics.
3. Add fallback and malformed/unavailable capability tests.
4. Run stable and candidate automated checks, then perform isolated TUI smoke tests where a runnable host exists.
5. Publish only after separate authorization. Roll back the adapter wiring independently if stable runtime behavior regresses; do not roll back the metric-accuracy implementation.
