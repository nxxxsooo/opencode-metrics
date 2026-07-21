# Fix Token Metrics Accuracy (tks 展示不准)

## Why

The sidebar Tokens/Speed/TTFT/Elapsed rows are per-step, but OpenCode creates **one assistant message per provider step** (per API call) and overwrites `tokens` per step — verified in source v1.18.3 (`packages/opencode/src/session/processor.ts#L435-L456`, `packages/core/src/session/runner/llm.ts`) and empirically in the local SQLite session store (a 28-step turn shows per-step outputs 422/78/968/…/24724, never accumulated).

Observable inaccuracies today:

1. **Tokens out resets on every tool call** — after a turn producing 30K+ output tokens the sidebar reads "↑ 29 out" (only the final step).
2. **Speed decays to junk** — denominator is wall time since the current step's first token, so t/s decays toward zero during tool execution, then resets (the recorded "3.2 t/s" artifact).
3. **Tokens in collapses at each step start** — fresh per-step metrics fall back to a user-text-only estimate (~11 tokens) until that step's exact usage arrives, then jumps back to ~90K context.
4. **TTFT/Elapsed are per-step** — they show the latest step's values, not the turn's.
5. **V1 double count** — on legacy runtimes `message.part.delta` accumulates estimates without the part-key dedup used by the other two text paths, double-counting with `message.part.updated`.

## What Changes

- Introduce a per-session **turn accumulator**: finalized per-step usage (deduped by `assistantMessageID`) is summed across the turn; a turn starts on user message / busy transition and ends on idle.
- **Tokens row**: `out` = turn-cumulative output+reasoning (finalized steps + live estimate of the in-flight step); `in` = sticky latest-known context size (`input + cache.read + cache.write`, matching OpenCode's own footer semantics).
- **Speed** = short-window, observable real-time throughput from recent text/reasoning-summary deltas. Tree scope sums the rates of descendants that are actively producing observable deltas. It shows unavailable (`—`) during tool execution, hidden-only reasoning, and idle time instead of decaying or freezing a stale average.
- Hidden reasoning that the provider reports only in final usage is intentionally excluded from live Speed; it remains included in finalized token totals.
- **TTFT** = foreground session's latest provider step start → first observable delta. **Elapsed** = foreground turn wall time. **Session** = foreground/tree busy-time union, never a sum that double-counts parallel descendants.
- **Cache row**: sticky latest finalized step's cache read (unchanged semantics, no per-step flicker).
- Fix V1 `message.part.delta` to share the part-level estimate dedup.
- Make event handling **idempotent under double delivery** (canonical + `.1`/`.2` versioned type names deliver the same event once to the totals).
- Hydration seeds the last turn's totals from history, runs its O(all-messages) parse **once per session** (success-gated + failure-throttled) instead of on every 200ms render tick.
- Tree hydration recursively discovers existing descendants so attaching after child creation does not silently omit active subagents.
- Drop `partTexts` full-text retention (estimates are additive; store counts only).
- CJK-aware streaming estimation (Han/kana/Hangul chars ≈ 0.6 token/char instead of 1/4) so live Chinese output does not undercount ~2-4x before exact usage arrives.

## Non-Goals

- No new sidebar rows (session-total tokens / cost row deferred until requested).
- No attempt to infer provider-hidden reasoning in real time; exact reasoning remains a finalized-usage metric.
- No changes to `formatBar`/`getTps` legacy status-bar helpers' external API.
- No release/publish in this change (working-tree implementation only unless the user asks).

## Impact

- Affected specs: `token-metrics` (new capability spec)
- Affected code: `src/types.ts`, `src/metrics.ts`, `src/collector.ts`, `src/collector-state.ts`, `src/event-handlers.ts`, `src/assistant-progress.ts`, `src/request-state.ts`, `src/session-hydration.ts`, `src/components/SidebarMetrics.tsx`, tests
- Affected behavior pins: `tests/collector-next-events.test.ts` per-step reset expectations (lines 88-109) are superseded by turn-cumulative expectations
- Dev hygiene: bump `@opencode-ai/plugin` / `@opencode-ai/sdk` devDeps from 1.14.28 toward the 1.17+ runtime line
