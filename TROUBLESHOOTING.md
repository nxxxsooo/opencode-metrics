# O2 sidebar troubleshooting

## Start at the actual client boundary

Run `opencode2 --version` and `opencode2 debug paths` through the same launcher used for the TUI. Inspect that launcher's configuration overrides. Do not assume the default config directory or confuse the V1 `opencode` executable with O2.

1. **Configuration:** inspect `<config>/opencode.jsonc`, `<config>/cli.json`, and `<config>/plugins/`. Register this package once in `opencode.jsonc`; O2 discovers its TUI entry automatically. O2 uses `plugins`, not the legacy `tui.json(c)` `plugin` field. Preserve sibling settings.
2. **Loading:** verify the entry executes in the new client process. A temporary startup toast can prove setup ran; remove it after inspection. Server restart, npm availability, and cached package presence are not loading proof.
3. **Rendering:** enter a session, expose its sidebar, and inspect actual pixels or accessibility structure. A terminal capture containing source code, tool commands, or old conversation text is not proof. Use a clean session and assert the sidebar location.
4. **Metrics:** separately check observable deltas, finalized usage, completion timing, two unrelated sessions, and a real parent-child tree. A visible header alone proves none of these.

For local source, install checkout dependencies and add one entry to `<config>/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-metrics/src"]
}
```

Use your own absolute path and preserve existing settings. Remove an older duplicate metrics entry from `cli.json` or a metrics-only discovery shim. Open a fresh client to verify loading. Local installations require explicit checkout updates; they do not track npm automatically.

## One installation, two runtime roles

On OpenCode `2.0.9`, `/plugins` groups entries by **TUI** and **Server**.
The Metrics sidebar (`opencode-metrics`) and HTTP collector
(`opencode-metrics-model`) belong to this one package and one configuration entry.
The model rows already render inside the Metrics sidebar.

A fresh-client check on 2026-09-19 confirmed that removing the duplicate
`cli.json` registration still loads both roles. A temporary same-ID probe also
showed two rows, one in each group; the probe was reverted. Collapsing these rows
requires a host UI change, not a plugin ID rename. Keep the server ID stable:
OpenCode namespaces `context.storage` by plugin ID, so renaming it would hide
existing model evidence. Keep the RPC contract `opencode-metrics-model/get` too.

With the final single-entry config, a fresh client rendered the Metrics sidebar
with its request/response model rows, and the existing RPC returned model
evidence. `bun run check` passed 164 tests, typecheck, build, and package dry-run;
the package now includes `src/theme-tokens.ts`, required by the earlier theme fix.
This verifies local source loading; it is not a new npm release verification.

`opencode plugin list` reports server plugins; verify the sidebar separately in
a fresh TUI. A server entry with `features.tui: true` advertises a TUI entry but
does not prove client setup or rendering succeeded.

## Model monitoring is opt-in from 0.6.0

Use a single configured entry with `options: { "modelMonitor": true }` to enable
both capture and the model rows. The plain package/path string defaults to off.
When off, the server entry remains active but registers no model HTTP hooks or
RPC; the TUI keeps token metrics and does not poll or render model rows.
An unavailable `opencode-metrics-model/get` RPC is therefore expected when off.
`rows.model` and `visible.model` are presentation filters, not capture switches.

Disabling collection retains saved evidence in its existing namespace. Re-enable
to restore it. A returned replacement model is captured only if the provider or
relay declares it in a supported HTTP response field; an echoed alias is not
proof of the backend model.

## Responses WebSocket sessions since 0.8.0

OpenCode v2 can drive the built-in OpenAI provider (also xAI/Azure Responses)
over the Responses WebSocket transport. That traffic bypasses the
`http.request`/`http.response` hooks entirely, so on those sessions the
requested model is seeded from the transport-independent `model.request` hook
(configured model ID) and response evidence is captured by a passive WebSocket
observer: one extra `message` listener per socket whose URL ends in
`/responses`, plus a bounded scan of outgoing `send` payloads, reusing the
same incremental JSON scanner. The evidence line is labeled `WS <source>` so
the transport is honest. Sockets are attributed to sessions by correlating the
socket URL with the `baseURL` of recent primary `model.request` records; frames
without an attributable session are ignored, and with concurrent same-provider
sessions the socket-attribution heuristic can label the wrong session with a
still-real observed model. The prototype patch is installed only while
`modelMonitor` is on, never alters traffic, and is restored on dispose. If the
host stops using `globalThis.WebSocket` for provider traffic, the observer
quietly observes nothing and HTTP capture is unaffected.

Verified 2026-09-21 against OpenCode `2.0.11` with a real `openai/gpt-6-astra`
session through the sub2api relay: the standalone server persisted
`{"requested":"gpt-6-astra","reported":"gpt-6-astra","source":"response.model","transport":"websocket"}`.
Note the runtime's `WebSocket.prototype` may expose `addEventListener` only as
an inherited method; the observer resolves registration originals through the
prototype chain and also supports EventEmitter-style `on`/`once` hosts.

The 0.6.0 pre-release check passed 168 tests, typecheck, build, and package audit.
A fresh 2.0.9 client with default options rendered token metrics without model
rows. In an isolated location with `modelMonitor: true`, the existing model RPC
returned retained evidence; the default-off location returned `rpc.unavailable`.
HTTP-hook tests cover a retired request alias with a provider-declared replacement
and a missing response model that remains unknown.

## Never configure `dist/` as a plugin target

A configured directory is resolved by filename convention, not by `package.json`
exports. The CLI role imports `<directory>/tui.js`, so pointing `plugins` at this
checkout's `dist/` fails with `Unexpected <`: the build preserves Solid JSX in
`dist/tui.js`, and that file is never a loadable module. Deleting it only changes
the failure to `Cannot find module .../dist/tui.js`, because `dist/tui.d.ts` still
advertises the entry.

Point local configuration at the checkout's `src/` directory instead. It resolves
`src/server.ts` for the server role and `src/tui.tsx` for the CLI role, needs no
build step, and produces one deduplicated entry in `opencode plugin list`. The
repository root is not a working target either: it loaded no plugin on `2.0.3`.
Published installs are unaffected, since npm consumers resolve `.` and `./tui`
through `package.json` exports.

## OpenLLMetry integration — 0.7.0

Version `0.7.0` depends on `@traceloop/node-server-sdk@0.27.0` and calls its
public `LLMSpan.reportRequest()` / `reportResponse()` API in the model evidence
path. This is an actual library integration; the released `0.6.0` package below
still represents the earlier design-reference-only implementation.

`src/model-evidence.ts` adapts an inert OpenTelemetry span to a local allowlisted
attribute sink. OpenLLMetry writes the request and response model attributes;
the sink updates the existing `ModelIdentity` fields. The HTTP scanner remains
responsible for bounded JSON/SSE extraction and passes no prompt or response
content to the SDK. Existing RPC and stored-record shapes are unchanged.

OpenCode exposes native HTTP streams rather than SDK client instances, so the
integration uses OpenLLMetry's manual API instead of SDK monkey-patching. Do not
call `initialize()` or register global tracer providers/exporters in this plugin:
the server process is shared with OpenCode and other plugins. The SDK and its
transitive dependencies are installed with the package, but the runtime import
occurs only after the `modelMonitor === true` check. No Traceloop key is needed.

When packaging, include every lazy `dist/chunk-*.js` import. The build config pins
the chunk naming convention to the package allowlist. Verify both default-off
setup and enabled collection using the packed server entry, not just `src/`.
Tests spy on the real SDK methods for JSON, Chat Completions, Responses and
Anthropic-style events, and use isolated processes to check lazy loading, no
network export, and preservation of the host's tracer provider.

The pre-release check passed 175 tests, typecheck, build, and package audit.
An isolated consumer installed the packed package and verified default-off setup,
an actual `LLMSpan.reportResponse()` call, byte-preserving SSE, RPC and storage.

## Historical 0.6.0 release and maintainer snapshot — 2026-09-19

- Released source: tag `v0.6.0`, commit `aac179c`.
  [GitHub Release](https://github.com/nxxxsooo/opencode-metrics/releases/tag/v0.6.0).
- [Release CI](https://github.com/nxxxsooo/opencode-metrics/actions/runs/35429530773)
  and [Compatibility CI](https://github.com/nxxxsooo/opencode-metrics/actions/runs/35429529018)
  succeeded for that commit. The release checks passed 168 tests, typecheck,
  build, and package audit.
- Public npm `latest` resolved to `0.6.0`. The canonical tarball downloaded and
  matched the registry integrity hash; runtime source files matched the release
  checkout. Initial registry/version/tarball 404s cleared before completion;
  successful CI alone was not treated as consumer availability.
- The maintainer's configuration now uses the published package
  `opencode-metrics@0.6.0` in `opencode.jsonc`, replacing the local `src/` fallback.
  The duplicate metrics registration was removed from `cli.json`. Other settings
  were preserved, and no shared-service restart was needed.
- The published package was verified on OpenCode `2.0.9`: the default-off
  installation rendered token metrics without model rows; an isolated opt-in
  location restored retained model evidence through the existing RPC. Monitoring
  remains off in the maintainer's normal configuration.
- In `0.6.0`, OpenLLMetry was a design reference, not an installed library or copied code.
  Collection still uses this project's HTTP hooks and streaming scanner. Active
  fingerprinting was researched but was not integrated or run.

Recovery anchors are `v0.6.0`, this snapshot, and the model-monitoring sections in
`README.md` / `README_CN.md`; temporary verification files are not required.

## Incident record — September 2026

### Raw model evidence — 0.5.0

- Load both the server and CLI entries. Local directory discovery works with this
  checkout's `src/` directory; configured direct file paths were rejected by the
  tested V2 `2.0.3` runtime.
- A real `openai/gpt-5.6-luna` Responses request returned `OK`, and plugin RPC
  reported a distinct full internal identifier from `response.model`.
- The initial 64 KiB event cap skipped model fields in large response envelopes.
  The streaming field scanner now skips content strings without retaining them.
- Empty/pending polls must not erase the last reported model pair. Previous pairs
  are explicitly labeled, and the last reported pair is saved per session in
  plugin storage. HTTP hooks cannot see Responses WebSocket traffic; since 0.8.0
  those sessions are covered by the passive WS observer described above.
- Check RPC with `POST /api/rpc/opencode-metrics-model/get` at the session's
  location and body `{"input":{"sessionID":"<session-id>"}}`. The raw HTTP RPC
  response wraps the record in `output`; the typed client unwraps it.

#### Release and local recovery snapshot — 2026-09-15

- Verified release source: commit `ef503fb`, tag `v0.5.0`.
  GitHub Release: <https://github.com/nxxxsooo/opencode-metrics/releases/tag/v0.5.0>.
- Release workflow run `34964893483` succeeded and logged
  `+ opencode-metrics@0.5.0` after the npm publish step. The final local checks
  passed 160 tests, typecheck, build, and package audit.
- **Registry visibility was still blocked at the last observation:** public
  package metadata reported `latest: 0.4.2`, the `0.5.0` version endpoint returned
  404, and `opencode plugin add opencode-metrics@0.5.0` failed with
  `NpmInstallFailedError` / no matching version. Cause was not established; do not
  equate the successful publish job with verified consumer availability.
  Before the 0.6.0 release on 2026-09-19, the public registry reported `latest: 0.5.0`, and
  the `0.5.0` version endpoint returned its version and tarball URL. The earlier
  visibility failure is historical; its cause remains undetermined.
- The maintainer's global configuration was restored to local directory entries:
  `opencode.jsonc` points to this checkout's `dist/`, and `cli.json` points to
  `src/`. Both live under the config directory reported by `opencode debug paths`.
  The `dist/` entry was later corrected to `src/` after it produced a repeating
  `Unexpected <` CLI load failure; see the `dist/` section above.
  Other plugins, models, and credentials were preserved. No shared-service restart
  or broad cache deletion was performed.
- The local built server entry was observed active, and a real request's RPC record
  contained the requested alias plus a distinct complete response identifier.
  Retention through idle/pending periods, large envelopes, and storage recovery
  were tested. A fresh maintainer TUI displaying the final retention fix and a
  clean install from the public `0.5.0` package remain unverified boundaries.
- Recovery anchors are this snapshot, the `v0.5.0` source, and the install/model
  evidence sections in `README.md` / `README_CN.md`; temporary smoke-test output
  files are not the authoritative recovery record.

**Observed:** an isolated O2 launcher selected a non-default config directory. Earlier edits targeted the default directory. The existing `tui-v2` candidate checks covered an older API, not the current O2 beta contract. Subsequent `cli.json` attempts did not establish a successful load.

**Verified mitigation:** the actual global discovery directory contained a `tui.ts` entry importing this checkout. A startup toast demonstrated setup execution; the user subsequently confirmed Metrics appeared. The diagnostic toast was removed. The host version inspected was `0.0.0-beta-19086`.

**Not established:** the exact cause of the unsuccessful `cli.json` attempts. This incident does not demonstrate that the official configuration route is broken. Earlier capture matches were potentially contaminated by conversation text and should not be used as runtime evidence. Nor was sidebar placement or an old client process established as the sole cause.

**Remaining validation:** clean npm install/update, live metric accuracy under the current O2 event contract, concurrent attach isolation, and real child-session aggregation. The 149 automated tests and successful build are useful regression checks, not substitutes for these runtime checks.

## 中文摘要

- 先通过实际启动器运行 `opencode2 debug paths`，不要假设默认配置目录。
- 配置正确、入口执行、侧边栏渲染、指标正确是四个独立检查。
- 本次确认的是全局发现入口导入本地源码后成功显示；不是 npm 安装闭环。
- 不能将会话历史中的「Metrics」、测试全绿或缓存存在当成加载证据。
- `cli.json` 当时未成功加载的原因仍未确定，不应写成官方功能失效。
- 不要再通过反复重启服务、清缓存或改数据库代替定位客户端加载路径。

## References

- [O2 CLI configuration](https://opencode.ai/v2/docs/cli/config)
- [O2 CLI plugin loading](https://opencode.ai/v2/docs/cli/plugins)
- [O2 plugin API](https://opencode.ai/v2/docs/build/plugins/cli)
