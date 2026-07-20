<div align="center">

# opencode-metrics

**Per-session sidebar metrics for the [OpenCode](https://opencode.ai) TUI.**

Speed · TTFT · tokens · cache · timing — for the session you are actually attached to, not a global total.

[![npm version](https://img.shields.io/npm/v/opencode-metrics?color=58e6c4&label=npm)](https://www.npmjs.com/package/opencode-metrics)
[![license](https://img.shields.io/npm/l/opencode-metrics?color=5ab8ff)](./LICENSE)
[![OpenCode TUI plugin](https://img.shields.io/badge/OpenCode-TUI%20plugin-fbbf77)](https://opencode.ai)

English · [简体中文](./README_CN.md)

<br/>

<img src="https://raw.githubusercontent.com/nxxxsooo/opencode-metrics/main/assets/sidebar.png" alt="opencode-metrics sidebar panel in the OpenCode TUI" width="560">

</div>

<br/>

## Install from npm

Use OpenCode's plugin installer:

```bash
opencode plugin opencode-metrics --global
```

This installs the package from npm and adds it to your global OpenCode TUI configuration. Open a new TUI window or attach after installation; plugins are loaded at TUI startup and are not hot-reloaded. No server restart is required.

<details>
<summary>Manual configuration</summary>

Add the npm package name to your OpenCode TUI plugin list:

```jsonc
// ~/.config/opencode/tui.jsonc
{
  "plugin": ["opencode-metrics"]
}
```

Open a new TUI window or attach. OpenCode installs and caches the npm package automatically.

</details>

## Why a sidebar, not a footer bar

A global footer-style status line keeps **one** request view. Under `opencode serve`, several attached sessions run at once — so a global bar shows aggregate or wrong-session numbers.

`opencode-metrics` stores every request keyed by `sessionID` and renders only the active `session_id` that OpenCode passes to its `sidebar_content` slot. **You always see your own session.**

## What it shows

For the **current** session, during and after a request:

| Row | Meaning |
|-----|---------|
| **Speed** | tokens per second (`⚡`) |
| **Elapsed** | per-request run time, freezes on completion (`▹`) |
| **TTFT** | time to first token (`⏱`) |
| **Tokens** | input + output on one line — `↓ in  ↑ out` |
| **Cache** | cache-read tokens, when exact counts arrive (`○`) |
| **Session** | cumulative active time for the session; freezes while idle (`◷`) |

The header badge shows request state: `idle` · `waiting` · `streaming` · `complete`.

## Current vs tree scope

By default, Metrics is strict per-session: it shows only the session attached to the current TUI pane.

Set `scope` to `tree` when you want the current session plus known child/sub-agent sessions:

```jsonc
// ~/.config/opencode/tui-preferences.jsonc
{
  "opencode-metrics": {
    "scope": "tree"
  }
}
```

Tree mode is intentionally conservative:

- It only includes sessions with a real OpenCode parent-child link; unlinked sessions are never guessed into the total.
- It aggregates the latest visible request for the current session and each known descendant session.
- Input, output, and cache-read tokens are summed directly. Cache reads are **not** deduplicated or subtracted from input.
- Cache precision is explicit: exact cache shows normally, partial cache shows a `+` suffix, and unknown cache shows `—`.
- The header adds a child-session badge in tree scope, for example `streaming +3`.

`Session` is cumulative active time for the selected scope. It advances while a request is busy, freezes when the session becomes idle, and resumes on the next request without counting the idle gap. When attaching to an existing session, completed assistant-message timings are restored from OpenCode's session state. `Elapsed` remains timing for the latest request.

## Collapsed vs expanded

Click the header badge to toggle:

- **▼ Expanded** — full breakdown: Speed, Elapsed, TTFT, Tokens, Cache, Session.
- **▶ Collapsed** — compact glance: **Speed + Session** only (or just the header when idle).

When a request finishes, the last numbers **stay visible** until the next request — Speed, Elapsed, and Session freeze at completion.

## Configuration

Presentation preferences live in the shared `tui-preferences.jsonc` (same file Magic Context and other sidebar plugins use — each plugin owns one top-level key):

```jsonc
// ~/.config/opencode/tui-preferences.jsonc
{
  "opencode-metrics": {
    "order": 160,          // sidebar position (OpenCode built-ins occupy 100-500)
    "forceToTop": false,   // sort above the normal band
    "scope": "current",    // current | tree
    "section": {
      "enabled": true,
      "collapsed": null,   // null | true | false; persisted when rememberCollapsed
      "rememberCollapsed": true,
      "label": "Metrics"
    },
    "rows": {
      "speed": true, "ttft": true, "input": true, "output": true,
      "cache": true, "elapsed": true, "session": true
    }
  }
}
```

Seed the defaults safely (preserves existing values and sibling plugin keys):

```bash
bun run init:prefs
```

Runtime behavior (`refreshIntervalMs`, `holdDurationMs`, `estimationRatio`, `enableLogging`, and the `visible` map) is read from `~/.config/opencode/opencode-bar.json`. A row shows only when **both** files agree it is visible. `holdDurationMs` defaults to `0` — completed metrics persist until the next request; set `>= 1000` to auto-clear after that many ms.

## For AI agents / OpenCode

If you are an AI coding agent installing this for a user, the full procedure is:

```text
GOAL: install opencode-metrics into the user's OpenCode TUI.

1. Run: opencode plugin opencode-metrics --global
2. This installs the package from npm and updates the global TUI config.
3. If the installer is unavailable, add "opencode-metrics" to the "plugin"
   array in ~/.config/opencode/tui.jsonc without removing sibling entries.
4. Do NOT add a version suffix; "opencode-metrics" resolves latest.
5. Tell the user to open a NEW TUI window/attach — plugins load at TUI
   startup and are not hot-reloaded. Do not restart the OpenCode server.

VERIFY: a "Metrics" section appears in the TUI sidebar. Click its header
badge to confirm it collapses/expands.

OPTIONAL: write ~/.config/opencode/tui-preferences.jsonc with an
"opencode-metrics" key (order/rows/section) — see Configuration above.
Never overwrite sibling top-level keys; only touch "opencode-metrics".

NOTES:
- It is a TUI plugin (package.json: "oc-plugin": ["tui"]); it only renders
  inside the OpenCode TUI, not in headless/CI runs.
- It defaults to per-session by design: under `opencode serve` each attached
  session shows its own metrics, never a global sum.
- If the user asks for sub-agent aggregation, set `scope` to `tree`. Do not
  describe it as "all sessions"; it only aggregates known OpenCode descendants.
```

## Local development

Point the plugin entry at a local checkout instead of the package:

```jsonc
{
  "plugin": ["file:///absolute/path/to/opencode-metrics/src/tui.tsx"]
}
```

Checks:

```bash
bun test
bunx tsc --noEmit
bun run build
npm pack --dry-run
```

The `./tui` export points at `src/tui.tsx` (not `dist`) because `@opentui/solid@0.3.4` ships a type-only JSX runtime; OpenCode loads the TSX through its Bun preload, the same pattern Magic Context uses.

## Credits

`opencode-metrics` is a rewrite of [Icicno/opencodeBar](https://github.com/Icicno/opencodeBar), an OpenCode TUI status-bar plugin, reworked into a per-session sidebar plugin. Thanks to the upstream author for the original concept.

## License

[MIT](./LICENSE) © Mingjian Shao
