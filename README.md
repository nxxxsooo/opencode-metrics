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

## Install

Add it to your OpenCode TUI plugin list and restart:

```jsonc
// ~/.config/opencode/tui.jsonc
{
  "plugin": ["opencode-metrics"]
}
```

That's it. The Metrics section appears in the sidebar.

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
| **Session** | whole-session run time, keeps ticking (`◷`) |

The header badge shows request state: `idle` · `waiting` · `streaming` · `complete`.

## Collapsed vs expanded

Click the header badge to toggle:

- **▼ Expanded** — full breakdown: Speed, Elapsed, TTFT, Tokens, Cache, Session.
- **▶ Collapsed** — compact glance: **Speed + Session** only (or just the header when idle).

When a request finishes, the last numbers **stay visible** until the next request — Speed and Elapsed freeze at completion, Session keeps counting.

## Configuration

Presentation preferences live in the shared `tui-preferences.jsonc` (same file Magic Context and other sidebar plugins use — each plugin owns one top-level key):

```jsonc
// ~/.config/opencode/tui-preferences.jsonc
{
  "opencode-metrics": {
    "order": 160,          // sidebar position (OpenCode built-ins occupy 100-500)
    "forceToTop": false,   // sort above the normal band
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

1. Open ~/.config/opencode/tui.jsonc (create it if missing).
2. Ensure the "plugin" array contains the string "opencode-metrics".
   If the array does not exist, add: { "plugin": ["opencode-metrics"] }
   Keep any existing entries (e.g. magic-context, oh-my-openagent).
3. Do NOT add a version suffix; "opencode-metrics" resolves latest.
4. Tell the user to open a NEW TUI window/attach — plugins load at startup,
   they are not hot-reloaded.

VERIFY: a "Metrics" section appears in the TUI sidebar. Click its header
badge to confirm it collapses/expands.

OPTIONAL: write ~/.config/opencode/tui-preferences.jsonc with an
"opencode-metrics" key (order/rows/section) — see Configuration above.
Never overwrite sibling top-level keys; only touch "opencode-metrics".

NOTES:
- It is a TUI plugin (package.json: "oc-plugin": ["tui"]); it only renders
  inside the OpenCode TUI, not in headless/CI runs.
- It is per-session by design: under `opencode serve` each attached session
  shows its own metrics, never a global sum.
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
