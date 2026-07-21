# Tasks — fix-token-metrics-accuracy

## 1. Data model & aggregation core

- [x] 1.1 `src/types.ts`: add `TurnMetrics` and bounded live-speed sample state; extend `MetricsAggregate` with `liveTps`; document step/turn/tree time semantics
- [x] 1.2 `src/metrics.ts`, `src/live-speed.ts`, and `src/turn-state.ts`: code-point-aware CJK estimation; turn-aware aggregate builder; rolling live-rate calculation with 3s window and 2s staleness
- [x] 1.3 `src/collector-state.ts`: add per-session turns/live samples and busy intervals; delete `partTexts`

## 2. Event ingestion (idempotent)

- [x] 2.1 `src/request-state.ts`: turn lifecycle — start on user message/busy (reset accumulator), end on idle (retire un-finalized live step with estimate, freeze)
- [x] 2.2 `src/event-handlers.ts` + `src/request-updates.ts`: step retirement into `TurnMetrics` keyed by assistantMessageID, first-wins across `session.next.step.ended` / positive-token `message.updated`; sticky context update on retirement
- [x] 2.3 `src/event-handlers.ts`: `message.part.delta` uses the shared part-estimate dedup (read `partID`, accumulate via `partTokenEstimates`)
- [x] 2.4 `src/assistant-progress.ts`: token-count-only part tracking; append deduped observable-token samples; reset the live window at each provider step

## 3. Read path

- [x] 3.1 `src/collector.ts`: compose foreground/descendant turn totals; sum only available per-session live rates; keep time rows rooted in the foreground session
- [x] 3.2 `src/session-hydration.ts`: success-gate + 2s failure throttle; seed trailing-turn totals; recursively discover existing descendants through `session.children`
- [x] 3.3 `src/components/SidebarMetrics.tsx`: render aggregate `liveTps` or `—`; Elapsed = foreground turn; TTFT = foreground latest step; Session = busy interval union

## 4. Tests (supersede per-step pins)

- [x] 4.1 Rewrite `tests/collector-next-events.test.ts` step-reset expectations → turn accumulation (second step adds, not replaces); keep alias/fallback/idle tests
- [x] 4.2 New: idempotency — same step.ended delivered via canonical and `.1` names counts once; step.ended + message.updated same messageID counts once
- [x] 4.3 New: rolling real-time speed — recent deltas produce a rate, concurrent children sum, and stale/tool/idle periods render unavailable
- [x] 4.4 New: sticky context — in-flight step start does not drop `inputTokens` to the user-text estimate
- [x] 4.5 New: turn end retires un-finalized streaming estimate; new user message resets turn totals
- [x] 4.6 New: hydration seeds trailing-turn totals and is not re-executed per tick after success (spy on `messages()` call count)
- [x] 4.7 Update metrics/integration/hydration tests for CJK estimator and removed `partTexts`
- [x] 4.8 V1 double-count regression: `message.part.delta` + `message.part.updated` same part counts once
- [x] 4.9 Time scope regressions: tree TTFT never mixes sessions; Elapsed uses foreground turn; overlapping child busy intervals do not double-count Session
- [x] 4.10 Tree attach regression: recursive child discovery restores descendants created before plugin startup

## 5. Hygiene & verification

- [x] 5.1 Bump devDeps `@opencode-ai/plugin` / `@opencode-ai/sdk` to the 1.17+ line; `bun install`; fix type drift if any
- [x] 5.2 `bun test`, `bunx tsc --noEmit`, `bun run build`, `npm pack --dry-run` all green
- [ ] 5.3 Live TUI QA: run a real multi-step agentic turn with concurrent children; verify out accumulates, Speed follows current deltas and becomes `—` during tools, tree rates sum, input stays at context scale, and time rows keep their documented scopes
