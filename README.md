# opencode-metrics

[![npm version](https://img.shields.io/npm/v/opencode-metrics)](https://www.npmjs.com/package/opencode-metrics)
[![license](https://img.shields.io/npm/l/opencode-metrics)](./LICENSE)
[![OpenCode TUI plugin](https://img.shields.io/badge/OpenCode-TUI%20plugin-5b9dd9)](https://opencode.ai)

A per-session sidebar metrics plugin for the OpenCode TUI.

`opencode-metrics` tracks OpenCode request metrics **per session** and renders the active session inside the `sidebar_content` slot. It is built for `opencode serve` / multi-session usage, where a single global footer-style status line can show the wrong session's numbers.

## What It Shows

During and after a request, for the **current** session:

- **Speed** — tokens per second
- **Elapsed** — request run time (freezes when the request completes)
- **TTFT** — time to first token
- **Tokens** — input and output token counts on one line (`↓ in  ↑ out`)
- **Cache** — cache-read tokens (when exact token counts are available)
- **Session** — whole-session run time (keeps ticking across requests)

Header status reflects request state: `idle`, `waiting`, `streaming`, or `complete`.

## Collapsed vs Expanded

Click the header badge to toggle:

- **▼ Expanded** — full breakdown: Speed, Elapsed, TTFT, Tokens, Cache, Session.
- **▶ Collapsed** — compact glance: Speed + Session only (or just the header when idle). Session (whole-session time) is shown rather than the per-request Elapsed.

## Idle Behavior

When a request completes, the last request's metrics **stay visible** until the next request starts (Speed and Elapsed freeze at completion time; Session keeps counting). This is controlled by `holdDurationMs` (default `0` = keep until next request). Set a positive value (>= 1000ms) to auto-clear the completed metrics after that delay.

## Why Sidebar

A global footer bar keeps one request view. In serve mode, multiple attached sessions can be active at once, so a global bar can show aggregate or wrong-session data. This plugin stores metrics by `sessionID` and the sidebar reads the active `session_id` supplied by OpenCode's `sidebar_content` slot.

## TUI Preferences

`opencode-metrics` uses the shared `tui-preferences.jsonc` file (same convention as Magic Context and other sidebar plugins) for sidebar position, section collapse, and per-row visibility.

### File Location

```text
~/.config/opencode/tui-preferences.jsonc
```

Override with `OPENCODE_TUI_PREFERENCES_FILE`, `OPENCODE_CONFIG_DIR`, or `XDG_CONFIG_HOME`.

### Configuration

```jsonc
{
  "opencode-metrics": {
    // Slot ordering. Default: 160. OpenCode built-ins occupy 100-500.
    "order": 160,
    // When true, sort to the top of the sidebar (below the forced band).
    "forceToTop": false,
    // Whole-section visibility and collapse.
    "section": {
      "enabled": true,       // false = render nothing
      "collapsed": null,     // null | boolean; persisted when rememberCollapsed is true
      "rememberCollapsed": true,
      "label": "Metrics"     // header badge text (max 24 chars)
    },
    // Per-row visibility (additive with opencode-bar.json `visible`).
    // A row shows only if BOTH this and the runtime config say true.
    "rows": {
      "speed": true,
      "ttft": true,
      "input": true,
      "output": true,
      "cache": true,
      "elapsed": true,
      "session": true,
      "model": true
    }
  }
}
```

### Init Script

Write missing defaults into the prefs file (safe to run repeatedly — preserves existing values and sibling plugin keys):

```bash
bun run init:prefs
# or with a custom path:
OPENCODE_TUI_PREFERENCES_FILE=/custom/path.jsonc bun run init:prefs
```

### Click to Collapse

Click the header badge to toggle collapse. When `rememberCollapsed` is true, the state persists to `tui-preferences.jsonc` (comment-preserving, atomic write).

## Runtime Config (opencode-bar.json)

The runtime metrics config is read from:

```text
~/.config/opencode/opencode-bar.json
```

This file controls `refreshIntervalMs`, `holdDurationMs`, `estimationRatio`, `enableLogging`, and the `visible` map for each metric row. It remains the runtime metrics configuration — `tui-preferences.jsonc` handles sidebar presentation only.

## Install

Add the plugin to your OpenCode TUI plugin list:

```jsonc
{
  "plugin": ["opencode-metrics"]
}
```

## Local Development

Use the source entry while developing (point at your local checkout):

```jsonc
{
  "plugin": [
    "file:///absolute/path/to/opencode-metrics/src/tui.tsx"
  ]
}
```

## Package Shape

The package exposes a TUI plugin entry:

```json
{
  "exports": {
    "./tui": {
      "import": "./src/tui.tsx",
      "types": "./dist/tui.d.ts"
    }
  },
  "oc-plugin": ["tui"]
}
```

The source entry is used because `@opentui/solid@0.3.4` transforms TSX through its Bun preload/runtime support (its JSX runtime ships type declarations only, no runtime JS). The build step is retained for static checks and type generation, but the plugin export points at source like Magic Context.

## Checks

```bash
bun test
bunx tsc --noEmit
bun run build
npm pack --dry-run
```

## Credits

`opencode-metrics` began as a rewrite of [Icicno/opencodeBar](https://github.com/Icicno/opencodeBar), an OpenCode TUI status-bar plugin. It was reworked into a per-session sidebar plugin. Thanks to the upstream author for the original concept.

## License

[MIT](./LICENSE) © Mingjian Shao
