## Why

OpenCode is evolving its TUI, SDK, event envelopes, and session read APIs toward V2 while existing users remain on the 1.18 stable line. `opencode-metrics` needs one reproducible package that preserves accurate per-session metrics across both host generations instead of relying on floating dependencies or a single runtime shape.

## What Changes

- Add a capability-detected host compatibility boundary for TUI events, state hydration, SDK-client fallback, child-session discovery, rendering, and disposal.
- Preserve one plugin entry and the existing metrics/configuration behavior across OpenCode 1.18.x and the emerging V2 contract.
- Treat unavailable host capabilities distinctly from empty data and degrade without guessing metrics or session relationships.
- Pin the stable development baseline and add an isolated compatibility matrix for stable and V2 candidate packages.
- Document the support matrix, evidence level, and V2 release gate.

## Capabilities

### New Capabilities
- `opencode-host-compatibility`: Observable compatibility, fallback, isolation, and lifecycle behavior across supported OpenCode TUI host generations.

### Modified Capabilities
- `token-metrics`: Historical hydration gains a public-client fallback while retaining the existing accuracy and retry contract.

## Impact

Affected areas include `src/tui.tsx`, `src/collector.ts`, session hydration and event adapters, compatibility tests, package dependency pins, GitHub Actions, npm package contents, and the English/Chinese README files. The public package name, plugin entry, preferences schema, and metric semantics remain unchanged.
