# Design — Turn-Scoped Token Metrics

## Context

Verified facts (source v1.18.3 commit `127bdb3` + local `opencode.db` evidence):

- One assistant message per provider step; `AssistantMessage.tokens` is overwritten per step (`cost` accumulates, `tokens` does not).
- `session.next.step.ended.tokens` = that single step's usage; no cumulative field exists.
- `tokens.input` excludes cache (Anthropic semantics normalized upstream); request context = `input + cache.read + cache.write`.
- OpenCode's own footer shows the latest assistant message's full sum (context), not turn/session totals.
- V1 (`message.part.delta`) and V2 (`session.next.*`) event families never coexist for the same runtime; `message.part.updated` coexists with V2 deltas (already deduped by shared part key).
- `.1`/`.2` type suffixes are durable-storage version keys; live delivery may surface either canonical or versioned names depending on path — treat double delivery as possible, never assume it.

## Goals / Non-Goals

- Goals: truthful Tokens/Speed/TTFT/Elapsed during and after multi-step turns; idempotent event ingestion; bounded memory; hydration off the render hot path.
- Non-Goals: cost display, session-total row, statusbar (`formatBar`) redesign.

## Decisions

### D1. Scope of `Tokens out` = turn-cumulative (not session-cumulative, not per-step)

- Per-step (status quo): factually a real number but reads as broken; rejected.
- Session-cumulative: monotonic and matches `/usage` conventions, but conflates many turns and diverges from the other rows' turn scoping.
- **Turn-cumulative (chosen)**: coherent with Speed/TTFT/Elapsed which are inherently per-turn; the "Session" row already covers whole-session framing. A session-total row is a possible future addition, not part of this fix.

### D2. `Tokens in` = sticky latest-known context

`Σ input` across steps double-counts re-sent context and means nothing; the only honest scalar is the latest request's context size — the same quantity OpenCode's footer shows. Sticky: retain the previous step's context during an in-flight step until its exact usage arrives (kills the ~11-token flicker). The user-text estimate applies only before any exact context exists.

### D3. Speed = observable rolling real-time throughput

Speed is not a turn average. Each session retains a bounded sequence of cumulative observable-token samples from text and reasoning-summary deltas. The displayed per-session rate is calculated over the newest samples spanning at most 3 seconds and becomes unavailable when the newest sample is older than 2 seconds. Tree speed is the sum of the available rates for currently producing sessions.

The rate uses sample-to-sample token deltas, not `now - firstTokenTime`, so tool execution and waiting neither dilute the value nor leave a stale number frozen on screen. A single sample is insufficient to establish a rate. Step start resets the live sample window; step end and idle clear availability.

Provider-hidden reasoning is not observable before final usage. It MUST NOT be invented or injected as a step-end spike. Observable reasoning summaries participate in the live estimate; exact `output + reasoning` continues to replace estimates in finalized turn totals.

### D4. Step finalization with `assistantMessageID` dedup (idempotent by construction)

A step retires into the turn accumulator exactly once, keyed by messageID, triggered by whichever arrives first:

1. `session.next.step.ended` (V2), or
2. `message.updated` with positive tokens (legacy / durable projection), or
3. turn end (idle) while still un-finalized → retire with its streaming estimate.

First-wins; later duplicates for the same messageID are ignored (upstream guarantees they carry identical usage). This single mechanism also makes canonical + `.1`/`.2` double delivery and V2+projection overlap safe.

### D5. Estimation

Keep upstream parity `chars/4` as the base, but count CJK code points (Han, Hiragana/Katakana, Hangul) at 0.6 token/char. Iterate Unicode code points rather than UTF-16 code units. Additive per-character classification keeps part-level estimates additive, which permits dropping `partTexts` (store per-part token counts only). Positive estimate deltas also append live-speed samples. Estimates only bridge until step finalization, then exact usage replaces them.

### D6. Hydration off the hot path

`hydrateSession` currently reparses every session message on each 200ms tick × 3 getters. Change: success-gated (`hydratedSessions`) + failure-throttled (retry at most every 2s per session). Hydration now also seeds the turn accumulator with the trailing turn: walk messages backward to the last user-message boundary, summing assistant step usages; sticky context from the last assistant message with tokens.

For tree scope, use the TUI client's `session.children` endpoint recursively and dedupe concurrent discovery. This restores parent links for descendants created before the sidebar attached. Historical child turns may seed token totals, but never seed live-speed samples: live Speed requires live deltas.

### D7. Aggregate interface

`MetricsAggregate` gains `liveTps: number | null`. Tree scope sums turn outputs and available per-session `liveTps`; `in` remains Σ of per-session sticky contexts. Tree token aggregation includes the foreground turn and descendant turns that started during it, plus any currently active descendant, so stale children from earlier foreground turns do not remain in the numerator forever.

The sidebar renders `—` when `liveTps` is null. Exact finalized usage never mutates the live sample window.

### D8. Time scopes do not follow token aggregation

- **TTFT** is the foreground session's latest provider step start to first observable text/reasoning-summary delta. It is never computed by independently minimizing starts and first-token timestamps across a tree.
- **Elapsed** is the foreground session's current turn wall time, from the latest user/busy turn boundary to foreground idle, and freezes at turn end.
- **Session** is selected-scope busy wall time. Current scope uses the foreground session. Tree scope uses the union of descendant busy intervals so parallel children do not double-count time. This is user-perceived active wall time, not agent-seconds.
- Live Speed has its own rolling sample clock and MUST NOT use TTFT, Elapsed, or Session as its denominator.

## Risks / Trade-offs

- **Estimate→exact snap** in token totals at each step end (small, self-correcting; live Speed is unaffected).
- **Delta batching jitter**: a 3-second rolling sample window smooths normal batching while retaining responsiveness; stale-after-2-seconds prevents old values masquerading as live throughput.
- **Hidden reasoning**: exact real-time total throughput is impossible when the provider withholds reasoning deltas. The UI deliberately reports only observable live throughput and exact finalized totals.
- **Turn boundary for subagent continuations**: a child session driven through multiple prompts shows only its latest turn in tree scope — accepted; matches "current activity" framing.
- **`message.updated` streaming zeros**: guarded today (`hasPositiveAssistantTokens`); retirement only on positive usage keeps that safety.
- **Pinned tests change meaning**: per-step reset expectations are intentionally superseded; new tests must pin turn accumulation, idempotency, and freeze behavior instead.

## Resolved Product Decisions

- `Tokens out` is turn-cumulative, not session-cumulative.
- A session-total/cost row is deferred.
- Streaming estimates use the CJK-aware heuristic.
- Speed is rolling observable throughput, not a turn average.
- Provider-hidden reasoning is excluded from live Speed and included only when finalized usage arrives.
