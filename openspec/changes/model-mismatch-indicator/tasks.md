## 1. Helper

- [x] 1.1 Add `modelMismatch(requested, reported)` and `normalizeModelId` to `src/model-identity.ts`
- [x] 1.2 Unit-test case/space/provider-prefix equality, real drift, and null handling in `tests/model-identity.test.ts`

## 2. Rendering

- [x] 2.1 Accept `boolean | (() => boolean)` for `StatRow.warning` and re-apply the value color in `syncContent`
- [x] 2.2 Show a warning-colored ` · mismatch` suffix on the **Model evidence** line when the ids diverge
- [x] 2.3 Render-test flagged (divergent) and unflagged (echoed) cases in `tests/sidebar-metrics-click.test.tsx`

## 3. Verification and documentation

- [x] 3.1 Run `bun run check` (tests, typecheck, build, pack)
- [x] 3.2 Update the English and Chinese README model-monitoring sections
