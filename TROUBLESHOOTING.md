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

## Incident record — September 2026

**Observed:** an isolated O2 launcher selected a non-default config directory. Earlier edits targeted the default directory. The existing `tui-v2` candidate checks covered an older API, not the current O2 beta contract. Subsequent `cli.json` attempts did not establish a successful load.

**Verified mitigation:** the actual global discovery directory contained a `tui.ts` entry importing this checkout. A startup toast demonstrated setup execution; the user subsequently confirmed Metrics appeared. The diagnostic toast was removed. The host version inspected was `0.0.0-beta-19086`.

**Not established:** the exact cause of the unsuccessful `cli.json` attempts. This incident does not demonstrate that the official configuration route is broken. Earlier capture matches were potentially contaminated by conversation text and should not be used as runtime evidence. Nor was sidebar placement or an old client process established as the sole cause.

**Remaining validation:** clean npm install/update, live metric accuracy under the current O2 event contract, concurrent attach isolation, and real child-session aggregation. The 147 automated tests and successful build are useful regression checks, not substitutes for these runtime checks.

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
