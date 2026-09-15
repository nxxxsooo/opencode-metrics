# O2 sidebar troubleshooting

## Start at the actual client boundary

Run `opencode2 --version` and `opencode2 debug paths` through the same launcher used for the TUI. Inspect that launcher's configuration overrides. Do not assume the default config directory or confuse the V1 `opencode` executable with O2.

1. **Configuration:** inspect `<config>/cli.json` and `<config>/plugins/`. O2 uses `plugins`, not the legacy `tui.json(c)` `plugin` field. Preserve sibling settings.
2. **Loading:** verify the entry executes in the new client process. A temporary startup toast can prove setup ran; remove it after inspection. Server restart, npm availability, and cached package presence are not loading proof.
3. **Rendering:** enter a session, expose its sidebar, and inspect actual pixels or accessibility structure. A terminal capture containing source code, tool commands, or old conversation text is not proof. Use a clean session and assert the sidebar location.
4. **Metrics:** separately check observable deltas, finalized usage, completion timing, two unrelated sessions, and a real parent-child tree. A visible header alone proves none of these.

For local source, install checkout dependencies and create `<config>/plugins/opencode-metrics/tui.ts`:

```ts
export { default } from "/absolute/path/to/opencode-metrics/src/tui.tsx"
```

Use your own absolute path. Avoid duplicate registration through `cli.json`. Restart the client process, not just its connected service. Local installations require explicit checkout updates; they do not track npm automatically.

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
  plugin storage. Native WebSocket traffic is not captured by HTTP hooks.
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
