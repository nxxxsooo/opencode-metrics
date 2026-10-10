## Context

`ModelIdentity` already carries both the requested model (HTTP body, WS outgoing frame, or the `model.request` configured fallback) and the reported model (raw `response.model` / `message.model` / `model`). The sidebar shows them as two rows. Users of relay/proxy setups (Sub2API, OpenRouter-style) want the same forward comparison those relays expose as a "model mismatch" flag, on the identifiers the plugin already has.

## Goals / Non-Goals

**Goals:**
- Flag a genuine requested-vs-reported divergence in the sidebar, using only fields already transmitted.
- Avoid false positives from case, surrounding whitespace, or a single `provider/` prefix.
- Change no server capture, RPC schema, storage shape, or the `modelMonitor` gate.

**Non-Goals:**
- Detecting an echoed model. A relay that returns the requested id is byte-identical to a provider genuinely serving it; the plugin cannot and must not claim verified upstream identity.
- Semantically matching aliases, dates, or version suffixes.
- Adding new RPC fields or persisting the comparison.

## Decisions

### D1. Compare client-side, not on the server

The comparison is a presentation of two strings already sent over the existing RPC. Computing it in the TUI avoids touching the server capture path, the `ModelIdentityRpc` output schema (`additionalProperties: false`), and stored snapshots.

### D2. Normalization: trim + lowercase + one `provider/` strip

`normalizeModelId` trims, lowercases, and removes one leading `provider/` segment (falling back to the trimmed value if the result is empty). This tolerates `DeepSeek-V4.1-Flash` vs `deepseek-v4.1-flash` and `openai/gpt-6-astra` vs `gpt-6-astra`, while still flagging real drift like `gpt-6-astra` vs `gpt-6-astra-x`. Missing evidence on either side is `unknown`, never a mismatch.

### D3. Function-valued `warning` on `StatRow`

Sidebar rows update imperatively through `registerSync`, not Solid reactivity, so a boolean `warning` computed at mount would not refresh when late evidence arrives. `warning` therefore accepts `boolean | (() => boolean)`, and `syncContent` re-applies `valueNode.fg` on every sync.

## Risks / Trade-offs

- [False positive on a legitimate provider prefix beyond one segment] → Only one `provider/` segment is stripped; deeper path differences are surfaced as a mismatch by design.
- [False negative when a relay echoes the requested id] → Documented limitation: the indicator fires only on string divergence, never claims verified identity.
- [Color-only signaling] → The suffix text ` · mismatch` carries the meaning; color is reinforcement.

## Migration Plan

1. Add `modelMismatch` with unit tests.
2. Extend `StatRow` and render the indicator in `SidebarMetrics`, with render tests for flagged and echoed cases.
3. Update README/README_CN model-monitoring documentation; publish as a minor release.
