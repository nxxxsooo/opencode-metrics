<div align="center">

# opencode-metrics

**[OpenCode](https://opencode.ai) TUI 的分会话侧边栏指标插件。**

速度 · TTFT · token · 缓存 · 计时 —— 只显示你当前 attach 的会话，而不是全局汇总。

[![npm version](https://img.shields.io/npm/v/opencode-metrics?color=58e6c4&label=npm)](https://www.npmjs.com/package/opencode-metrics)
[![license](https://img.shields.io/npm/l/opencode-metrics?color=5ab8ff)](./LICENSE)
[![OpenCode TUI plugin](https://img.shields.io/badge/OpenCode-TUI%20plugin-fbbf77)](https://opencode.ai)

[English](./README.md) · 简体中文

<br/>

<img src="https://raw.githubusercontent.com/nxxxsooo/opencode-metrics/main/assets/sidebar.png" alt="OpenCode TUI 侧边栏中的 opencode-metrics 面板" width="560">

</div>

<br/>

## 从 npm 安装

使用 OpenCode 的插件安装命令：

```bash
opencode plugin opencode-metrics --global
```

该命令会从 npm 安装软件包，并自动加入全局 OpenCode TUI 配置。安装后新开一个 TUI 窗口或重新 attach；插件只在 TUI 启动时加载，不会热重载，也无需重启 OpenCode 服务。

<details>
<summary>手动配置</summary>

把 npm 包名加入 OpenCode TUI 的 plugin 列表：

```jsonc
// ~/.config/opencode/tui.jsonc
{
  "plugin": ["opencode-metrics"]
}
```

然后新开一个 TUI 窗口或重新 attach。OpenCode 会自动安装并缓存 npm 包。

</details>

## 为什么是侧边栏，而不是底部状态栏

底部状态栏只保留**一份**请求视图。在 `opencode serve` 下，多个 attach 的会话会同时运行 —— 所以全局状态栏显示的是汇总或错会话的数字。

`opencode-metrics` 把每个请求按 `sessionID` 记录，并只渲染 OpenCode 传给 `sidebar_content` slot 的当前 `session_id`。**你永远看到的是自己这个会话。**

## 显示什么

针对**当前**会话，请求过程中和结束后：

| 行 | 含义 |
|-----|---------|
| **Speed** | 短滚动窗口内可观测的实时每秒 token 数；没有流式 delta 时显示 `—`（`⚡`） |
| **Elapsed** | 前台 turn 的墙钟时间，完成时冻结（`▹`） |
| **TTFT** | 前台最新 provider step 到首个可观测 delta 的耗时（`⏱`） |
| **Tokens** | 最新上下文输入 + 当前 turn 累计的 finalized／live 输出：`↓ in  ↑ out` |
| **Cache** | 缓存读取 token，拿到精确值时显示（`○`） |
| **Session** | 累计 busy 墙钟时间；tree scope 对重叠子会话区间取并集（`◷`） |

部分 provider 只会在最终 usage 中报告隐藏 reasoning。它会计入 finalized 的 **Tokens out**，但不会被猜测成实时 **Speed**。

## current vs tree scope

默认情况下，Metrics 是严格分会话的：只显示当前 TUI pane attach 的那个会话。

如果想显示当前会话 + 已知子代理 / 子会话，把 `scope` 设成 `tree`：

```jsonc
// ~/.config/opencode/tui-preferences.jsonc
{
  "opencode-metrics": {
    "scope": "tree"
  }
}
```

Tree 模式刻意保守：

- 只纳入有真实 OpenCode 父子关系的会话；不会把无关联会话猜进总数。
- 聚合前台 turn 以及参与本轮工作的后代 turn；更早 turn 的陈旧子会话不会永久留在分子中。
- 实时 Speed 等于当前仍在产生可观测 delta 的后代速率之和；attach 后会递归发现已有后代。
- input、output、cache-read token 直接求和。cache read 不去重，也不从 input 里扣掉。
- 缓存精度会明示：完整缓存正常显示，部分缓存带 `+` 后缀，未知缓存显示 `—`。

`Session` 是所选 scope 的累计 busy 墙钟时间：工作运行时计时，空闲后冻结；下一次工作开始后继续累计，但不计入中间的空闲时间。并行子会话的重叠区间只计一次。`Elapsed` 属于前台 turn；`TTFT` 始终使用前台 provider step 自己成对的起点与首 delta，不会跨后代拼接时间戳。

## 折叠 vs 展开

点击标题徽标切换：

- **▼ 展开** —— 完整明细：Speed、Elapsed、TTFT、Tokens、Cache、Session。
- **▶ 折叠** —— 紧凑速览：只有 **Speed + Session**（空闲时只剩标题）。

请求结束后，token 与计时总数会保留到下一次请求开始。两秒内没有新的可观测 delta 时，Speed 会变成 `—`，不会冻结一个过期吞吐值。

## 配置

显示偏好写在共享的 `tui-preferences.jsonc`（Magic Context 等侧边栏插件共用同一个文件，每个插件占一个顶层 key）：

```jsonc
// ~/.config/opencode/tui-preferences.jsonc
{
  "opencode-metrics": {
    "order": 160,          // 侧边栏位置（OpenCode 内置占 100-500）
    "forceToTop": false,   // 排到普通区段之上
    "scope": "current",    // current | tree
    "section": {
      "enabled": true,
      "collapsed": null,   // null | true | false；rememberCollapsed 时持久化
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

安全写入默认值（保留已有值和其他插件的 key）：

```bash
bun run init:prefs
```

运行时行为（`refreshIntervalMs`、`holdDurationMs`、`estimationRatio`、`enableLogging` 和 `visible` map）从 `~/.config/opencode/opencode-bar.json` 读取。某一行只有在**两个**文件都认为它可见时才显示。`holdDurationMs` 默认 `0` —— 完成的指标保留到下一次请求；设为 `>= 1000` 则在那么多毫秒后自动清除。

## 给 AI Agent / OpenCode

如果你是替用户安装本插件的 AI 编码 agent，完整流程是：

```text
目标：把 opencode-metrics 装进用户的 OpenCode TUI。

1. 运行：opencode plugin opencode-metrics --global
2. 该命令会从 npm 安装软件包，并更新全局 TUI 配置。
3. 如果安装命令不可用，则在 ~/.config/opencode/tui.jsonc 的 "plugin"
   数组加入 "opencode-metrics"，不要删除其他插件条目。
4. 不要加版本后缀；"opencode-metrics" 解析为 latest。
5. 让用户开一个新的 TUI 窗口 / attach —— 插件只在 TUI 启动时加载，
   不会热重载。不要重启 OpenCode 服务。

验证：TUI 侧边栏出现 "Metrics" 区块。点击它的标题徽标确认能折叠/展开。

可选：在 ~/.config/opencode/tui-preferences.jsonc 写一个
"opencode-metrics" key（order/rows/section）—— 见上面的配置。
绝不覆盖其他顶层 key，只动 "opencode-metrics"。

说明：
- 它是 TUI 插件（package.json: "oc-plugin": ["tui"]）；只在 OpenCode
  TUI 里渲染，不在无头 / CI 运行中显示。
- 它默认就是分会话的：`opencode serve` 下每个 attach 的会话显示
  自己的指标，绝不全局求和。
- 如果用户要求子代理聚合，把 `scope` 设成 `tree`。不要说成「所有会话」；
  它只聚合 OpenCode 已知后代会话。
```

## 本地开发

把 plugin 条目指向本地 checkout，而不是包：

```jsonc
{
  "plugin": ["file:///absolute/path/to/opencode-metrics/src/tui.tsx"]
}
```

检查：

```bash
bun test
bunx tsc --noEmit
bun run build
npm pack --dry-run
```

`./tui` 导出指向 `src/tui.tsx`，因为 OpenCode 会通过 Bun preload 加载 TUI plugin TSX，这符合既有 TUI plugin 模式。

## 由来

`opencode-metrics` 改写自 [Icicno/opencodeBar](https://github.com/Icicno/opencodeBar)（一个 OpenCode TUI 底部状态栏插件），重做成分会话侧边栏插件。感谢上游作者的原始构想。

## 许可

[MIT](./LICENSE) © Mingjian Shao
