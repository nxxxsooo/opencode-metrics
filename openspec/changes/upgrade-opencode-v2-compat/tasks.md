## 1. Reproducible compatibility baselines

- [x] 1.1 Pin the stable OpenCode plugin/SDK development baseline and regenerate the lockfile
- [x] 1.2 Add an isolated stable/V2 candidate compatibility check that does not mutate the release lockfile
- [x] 1.3 Add CI coverage for tests, typecheck, build, and package dry-run

## 2. Host compatibility boundary

- [x] 2.1 Add a narrow capability-detected host adapter for events, state snapshots, public-client fallbacks, child discovery, rendering, and disposal
- [x] 2.2 Rewire TUI initialization and collector code to consume the adapter without changing metric semantics
- [x] 2.3 Guard asynchronous hydration and tree results against disposal and stale live state

## 3. Compatibility behavior tests

- [x] 3.1 Test state-first hydration, public-client fallback, unavailable capability, empty response, and error throttling
- [x] 3.2 Test direct, data, and durable envelopes plus malformed/missing-session isolation
- [x] 3.3 Test disposal during pending hydration and preserve existing idempotency/session-tree regressions

## 4. Documentation and package readiness

- [x] 4.1 Update English and Chinese README support matrices, evidence levels, degradation behavior, and V2 release gate
- [x] 4.2 Verify package contents avoid duplicate host UI runtimes and include all compatibility source files
- [x] 4.3 Run the full stable and V2 candidate verification matrix and record any real-TUI smoke limitations
