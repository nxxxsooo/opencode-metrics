## Why

The sidebar shows **Request model** and **Response model** as two separate rows, but a user must eyeball them to notice that a relay served a different model than requested. Relays such as Sub2API surface this divergence as an explicit "model mismatch" badge; opencode-metrics should show the same comparison for the two identifiers it already captures, without implying any verified upstream identity.

## What Changes

- Add a pure `modelMismatch(requested, reported)` helper in `src/model-identity.ts` that returns `true` only when both ids are present and differ after trim + lowercase + stripping one leading `provider/` segment.
- Render a warning-colored ` · mismatch` suffix on the **Model evidence** line in `SidebarMetrics.tsx` when the two ids diverge.
- Let `StatRow`'s `warning` prop accept a function and re-apply the value color on sync, so the indicator updates when late evidence arrives.
- Keep "not captured" / "collector unavailable" states and the `previous` transport labeling unchanged.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `model-evidence`: adds a display-level requested-vs-reported divergence indicator derived from the identifiers already captured; capture, attribution, precedence, and persistence are unchanged.

## Impact

Affected areas: `src/model-identity.ts` (helper), `src/components/SidebarMetrics.tsx` (evidence-line rendering), `src/components/StatRow.tsx` (function-valued `warning`), and their `tests/` mirrors, plus README model-monitoring documentation. No server, RPC schema, storage shape, or opt-in gate changes.
