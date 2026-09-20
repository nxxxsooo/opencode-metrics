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

First run `opencode debug paths` using the same launcher as your TUI. Use its **config** directory, which may be overridden by `OPENCODE_CONFIG_DIR`. Add the package **once** to `<config>/opencode.jsonc`, preserving other settings:

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-metrics"]
}
```

This one registration loads both runtime entries. Token metrics work immediately; **model monitoring is off by default** (see below). OpenCode automatically loads the package's TUI entry from the connected server's plugin list; no matching entry in `cli.json` is needed. If you used the older two-config instructions, remove only the duplicate metrics entry from `cli.json`.

Open a new TUI window to verify loading after installation or an update. A shared-server restart is not required for this configuration change.

### Why `/plugins` has two rows

`opencode-metrics` is one package with two runtime roles:

- **TUI — `opencode-metrics`:** renders the sidebar, including model evidence.
- **Server — `opencode-metrics-model`:** when opted in, observes provider HTTP and retains model evidence for the sidebar over RPC.

OpenCode `2.0.9` lists TUI and Server roles separately, even when their IDs are identical. Those rows do not mean two installations. The server ID remains stable because it owns saved model records; the RPC endpoint remains `opencode-metrics-model/get`. Changing IDs does not collapse the host's rows.

For an intentional **sidebar-only** installation against a server without this package, use `cli.json` instead. Token metrics still work, but raw model evidence requires the collector on the connected server. Local `src/` paths must exist on the machine loading each entry; prefer the npm package for remote setups.

## Model monitoring (off by default)

Starting with `0.7.1`, enable `modelMonitor` in `opencode-metrics.json`:

```jsonc
// ~/.config/opencode/opencode-metrics.json  (or .opencode/opencode-metrics.json)
{
  "modelMonitor": true
}
```

Use this file rather than the plugin entry's options. OpenCode `2.0.10` does not
forward plugin options to the **TUI** role — `context.options` arrives as `{}`
there — so `["opencode-metrics", { "modelMonitor": true }]` enables the server
collector while the sidebar rows stay hidden, which looks like the feature is
broken. Both roles read `opencode-metrics.json`, and a plugin option set to
`true` still wins where it does arrive.

Set it to `false` or omit it to turn monitoring off. Only boolean `true` enables
it. Disabled means no model HTTP hooks, model RPC, model polling, or model rows;
normal token metrics continue working. Existing stored evidence is retained and
can be restored after re-enabling. This also applies when upgrading from `0.5.0`.
The `rows.model` / `visible.model` preferences only hide enabled model rows;
they do not opt into collection. Open a fresh TUI to verify configuration changes.

When connecting remotely, the file must also exist on the machine that runs the
collector, since the server role reads its own copy.

First install or upgrade explicitly (existing installs do not follow registry
updates automatically):

```sh
opencode plugin add opencode-metrics@0.7.1
```

If already configured with an unpinned package name, use
`opencode plugin update opencode-metrics`. Keep one metrics entry in
`opencode.jsonc`, preserving other plugins. Reopen the TUI to verify the update.
For local development, install checkout dependencies and configure the absolute
path to the repository's `src/` directory once in `opencode.jsonc`.
No live configuration is changed by building this repository. To roll back this
integration, pin `opencode-metrics@0.6.0` in the same `opencode.jsonc` entry.

With monitoring enabled, expanded Metrics shows **Request model**, **Response model**, and **Model
evidence** for the foreground session's latest primary HTTP request (even in tree
scope). Long identifiers wrap without truncation. Request model comes from the
outgoing JSON body, not the configured alias. Response model comes from the local
raw JSON/SSE fields `response.model`, `message.model`, or `model`. Missing evidence
shows `unknown`; unavailable server collection is labeled explicitly. A new step
keeps the previous reported pair explicitly labeled **Last request/response model**
until new response evidence arrives. The last reported pair is saved in plugin
storage per session and restored after reload/restart; active memory is bounded to
256 sessions.

This is **not verified ultimate-upstream identity**: a relay can rewrite or hide
the returned model. Native WebSocket traffic and unsupported content types are not
captured. Title/generate/compaction requests are excluded. Only identifiers and a
timestamp are retained, not credentials, prompts, or response content. Streaming
JSON parsing retains only keys and model strings, so large echoed instructions do
not hide model evidence (maximum nesting 128, model ID 512 characters, request
body 4 MiB). Mock HTTP-hook and sidebar tests cover collection and retention.

For example, if a provider routes a retired alias to a replacement and returns
the replacement in `model`, the two rows show that difference. If it echoes the
alias or omits the field, the plugin cannot infer the hidden backend.

### OpenLLMetry integration (0.7.0)

Starting with `0.7.0`, the plugin directly uses the official
[`@traceloop/node-server-sdk@0.27.0`](https://github.com/traceloop/openllmetry-js/tree/main/packages/traceloop-sdk)
library (Apache-2.0). Its `LLMSpan.reportRequest()` and `reportResponse()` methods
write `gen_ai.request.model` and `gen_ai.response.model` into a local attribute
sink; those values populate the existing sidebar evidence and saved records.
The published `0.6.0` release predates this integration and only referenced the
upstream design.

OpenCode's HTTP hooks and bounded streaming scanner extract the identifiers;
`src/model-evidence.ts` passes only those identifiers to OpenLLMetry. The SDK is
loaded lazily on the server when `modelMonitor: true`. Request messages are an
empty array, response content is omitted, and the sink accepts only the two model
attributes. There is no SDK `initialize()` call, global auto-instrumentation,
telemetry exporter, Traceloop account requirement, or additional probing request.
Enabling this integration does not independently verify the provider's identity.

## Why a sidebar, not a footer bar

A global footer-style status line keeps **one** request view. Under `opencode serve`, several attached sessions run at once — so a global bar shows aggregate or wrong-session numbers.

`opencode-metrics` stores requests keyed by `sessionID` and renders the session passed to O2's `sidebar.content` slot.

## Compatibility

| OpenCode line | Status | Evidence |
|---|---|---|
| OpenCode V2 (`2.0.9`) | Theme compatibility and single-entry local loading confirmed | Fresh TUI renders Metrics and model rows; model RPC works; current and beta theme token names covered by tests |
| OpenCode V2 (`2.0.3`) | Raw HTTP model capture confirmed | Real Responses request produced distinct requested/reported identifiers through plugin RPC; retention and layout covered by tests |
| O2 beta (`0.0.0-beta-19192`) | Local loading and live speed confirmed | Global discovery entry importing local source; real TUI stream reached `9.6 t/s live` |
| OpenCode V1 | Not supported by `0.3.x` | `0.3.x` migrates to the O2 plugin API; retain `0.2.x` for the legacy entry |

The O2 adapter uses `Plugin.define`, `context.data` events and cached session data, and `context.ui.slot`. It synchronizes missing history through the host data API. A real `0.0.0-beta-19192` TUI stream confirmed the Speed row transitions from `~avg` during sparse deltas to `live` during continuous output. Concurrent-session isolation and real child-tree aggregation remain runtime verification gaps. The old June `tui-v2` candidate is not evidence for today's O2 API.

OpenCode Desktop is not a supported rendering surface for this CLI plugin.

## What it shows

For the **current** session, during and after a request:

| Row | Meaning |
|-----|---------|
| **Speed** | rolling live throughput while deltas arrive; current-turn estimated average during pauses; finalized average while idle (`⚡`) |
| **Elapsed** | foreground-turn wall time, freezes on completion (`▹`) |
| **TTFT** | latest foreground provider step to first observable delta (`⏱`) |
| **Tokens** | latest context input + turn-cumulative finalized/live output on one line — `↓ in  ↑ out` |
| **Cache** | cache-read tokens, when exact counts arrive (`○`) |
| **Session** | cumulative busy wall time; tree scope unions overlapping child intervals (`◷`) |

Providers may withhold hidden reasoning until final usage. Hidden reasoning is included in finalized **Tokens out**, but is never guessed into live **Speed**.

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
- It aggregates the foreground turn and descendant turns participating in it; stale descendants from earlier turns do not remain in the numerator forever.
- Live Speed is the sum of descendants currently producing observable deltas. Existing descendants are discovered recursively after attach.
- Input, output, and cache-read tokens are summed directly. Cache reads are **not** deduplicated or subtracted from input.
- Cache precision is explicit: exact cache shows normally, partial cache shows a `+` suffix, and unknown cache shows `—`.

`Session` is cumulative busy wall time for the selected scope. It advances while work is busy, freezes when idle, and resumes without counting the idle gap. Parallel child intervals count once rather than inflating the clock. `Elapsed` is the foreground turn; `TTFT` remains paired to the foreground provider step rather than mixing timestamps from different descendants.

## Collapsed vs expanded

Click the header badge to toggle:

- **▼ Expanded** — full breakdown: Speed, Elapsed, TTFT, Tokens, Cache, Session.
- **▶ Collapsed** — compact glance: **Speed + Tokens**.

Speed never goes blank: `live` is a rolling observable rate, `~avg` is the current turn's estimated average, and `avg` is a finalized or retained prior-turn average. A new turn retains the previous average and token values while marked `running · waiting`; its first output replaces them. A session with no measurement yet shows `pending` rather than inventing `0 t/s`. Token `~` marks an estimate and cache `+` marks partial tree data.

## Configuration

Presentation preferences live in the shared `tui-preferences.jsonc` (same file Magic Context and other sidebar plugins use — each plugin owns one top-level key):

```jsonc
// ~/.config/opencode/tui-preferences.jsonc
{
  "opencode-metrics": {
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
GOAL: install opencode-metrics into the user's OpenCode O2 TUI.

1. Run opencode debug paths through the user's actual launcher.
   Add "opencode-metrics" once to <config>/opencode.jsonc's "plugin" array,
   preserving sibling entries. OpenCode loads the TUI entry automatically.
2. Remove an older duplicate metrics entry from cli.json, if present.
   Use opencode plugin add/update to install or update the requested version.
   Verify consumer availability; a successful publish is not installation proof.
3. Open a NEW TUI window to verify the installed version. A shared-server
   restart is not required. /plugins shows separate TUI and Server roles.

VERIFY: a "Metrics" section appears in the TUI sidebar. Click its header
badge to confirm it collapses/expands.

OPTIONAL: write ~/.config/opencode/tui-preferences.jsonc with an
"opencode-metrics" key (order/rows/section) — see Configuration above.
Never overwrite sibling top-level keys; only touch "opencode-metrics".

NOTES:
- It is an O2 CLI plugin; it only renders
  inside the OpenCode TUI, not in headless/CI runs.
- It defaults to per-session by design: under `opencode serve` each attached
  session shows its own metrics, never a global sum.
- If the user asks for sub-agent aggregation, set `scope` to `tree`. Do not
  describe it as "all sessions"; it only aggregates known OpenCode descendants.
```

## Local development

Install dependencies in your checkout with `bun install --frozen-lockfile`. Using the config directory from `opencode debug paths`, add the checkout's `src/` directory once in `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-metrics/src"]
}
```

Replace the placeholder with your checkout path. OpenCode discovers `server.ts` and `tui.tsx` from this directory. No build is needed for source loading. Avoid duplicate registration through `cli.json` or an older discovery shim. Use `src/`, not `dist/` or the repository root; see [troubleshooting](./TROUBLESHOOTING.md). Start a new client and verify the actual sidebar, not text in conversation history.

To update a local checkout, pull the intended revision, reinstall dependencies, and reopen the client; it does not follow npm releases. To uninstall, remove this package/path from `opencode.jsonc` and any older metrics-only CLI entry or discovery shim. Keep unrelated settings and saved data.

Since `0.3.1`, the plugin prepends to `sidebar.content`; legacy `order` and `forceToTop` preferences do not affect placement. Preferences default to `~/.config/opencode/tui-preferences.jsonc`, but honor `OPENCODE_TUI_PREFERENCES_FILE`, then `OPENCODE_CONFIG_DIR`, then `XDG_CONFIG_HOME`. Runtime metric settings have a separate path policy in `src/config.ts`.

Checks:

```bash
bun run check
```

CI checks against the current OpenCode O2 `beta` plugin contract.

The `./tui` export points at `src/tui.tsx` because OpenCode loads TUI plugin TSX through its Bun preload, matching the established TUI plugin pattern.

## Credits

`opencode-metrics` is a rewrite of [Icicno/opencodeBar](https://github.com/Icicno/opencodeBar), an OpenCode TUI status-bar plugin, reworked into a per-session sidebar plugin. Thanks to the upstream author for the original concept.

## License

[MIT](./LICENSE) © Mingjian Shao
