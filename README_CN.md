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

先通过你实际使用的启动命令运行 `opencode2 debug paths`，以输出的 **config** 目录为准；启动脚本可能通过 `OPENCODE_CONFIG_DIR` 改写默认目录。在 `<config>/cli.json` 中加入插件，保留其他设置：

```jsonc
// ~/.config/opencode/cli.json
{
  "plugins": ["opencode-metrics"]
}
```

配置后新开一个 O2 TUI 窗口；CLI 插件只在启动时加载，不会热重载，也无需重启 OpenCode 服务。

这是 O2 官方配置方式，但本版本尚未完成干净环境下的 npm 安装／更新闭环验证，不能假定重开就会获取最新版。已验证的本地源码方式见下文，证据与限制见[排障记录](TROUBLESHOOTING.md)。

## 为什么是侧边栏，而不是底部状态栏

底部状态栏只保留**一份**请求视图。在 `opencode serve` 下，多个 attach 的会话会同时运行 —— 所以全局状态栏显示的是汇总或错会话的数字。

`opencode-metrics` 按 `sessionID` 记录请求，并渲染 O2 传给 `sidebar.content` slot 的会话。

## 兼容性

| OpenCode 版本线 | 状态 | 证据 |
|---|---|---|
| O2 beta（`0.0.0-beta-19086`） | 已确认本地加载与显示 | 全局发现入口导入本地源码，用户确认 Metrics 出现 |
| OpenCode V1 | `0.3.x` 不支持 | `0.3.x` 已迁移至 O2 插件 API；旧入口请保留 `0.2.x` |

O2 适配器使用 `Plugin.define`、`context.data` 事件与缓存数据，以及 `context.ui.slot`，通过宿主数据 API 同步缺失历史。自动化测试通过不代表当前 O2 的实时数值、并发隔离和真实子会话聚合已验证，这些运行时检查仍待完成。六月的旧 `tui-v2` candidate 不能证明当前 O2 API 兼容。

OpenCode Desktop 不是本 CLI 插件支持的渲染面。

## 显示什么

针对**当前**会话，请求过程中和结束后：

| 行 | 含义 |
|-----|---------|
| **Speed** | 有 delta 时显示滚动窗口实时吞吐；暂停时显示本轮估算均速；空闲时显示最终均速（`⚡`） |
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
- **▶ 折叠** —— 紧凑速览：**Speed + Tokens**。

Speed 不再留空：`live` 表示滚动窗口可观测速率，`~avg` 表示本轮估算均速，`avg` 表示最终或保留的上一轮均速。新一轮等待首个输出时保留上一轮均速和 token，并标记 `running · waiting`；首个输出到来后替换。尚无任何读数的新会话显示 `pending`，不会伪造 `0 t/s`。token 的 `~` 表示估算，cache 的 `+` 表示 tree 数据不完整。

## 配置

显示偏好写在共享的 `tui-preferences.jsonc`（Magic Context 等侧边栏插件共用同一个文件，每个插件占一个顶层 key）：

```jsonc
// ~/.config/opencode/tui-preferences.jsonc
{
  "opencode-metrics": {
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
目标：把 opencode-metrics 装进用户的 OpenCode O2 TUI。

1. 使用用户实际启动命令运行 opencode2 debug paths。
   在 <config>/cli.json 的 "plugins" 数组加入 "opencode-metrics"，
   不要删除其他插件条目。这条 npm 安装路径仍需运行时验证。
2. 不要加版本后缀；"opencode-metrics" 解析为 latest。
3. 让用户开一个新的 O2 TUI 窗口 —— 插件只在 TUI 启动时加载，
   不会热重载。不要重启 OpenCode 服务。

验证：TUI 侧边栏出现 "Metrics" 区块。点击它的标题徽标确认能折叠/展开。

可选：在 ~/.config/opencode/tui-preferences.jsonc 写一个
"opencode-metrics" key（order/rows/section）—— 见上面的配置。
绝不覆盖其他顶层 key，只动 "opencode-metrics"。

说明：
- 它是 O2 CLI 插件；只在 OpenCode
  TUI 里渲染，不在无头 / CI 运行中显示。
- 它默认就是分会话的：`opencode serve` 下每个 attach 的会话显示
  自己的指标，绝不全局求和。
- 如果用户要求子代理聚合，把 `scope` 设成 `tree`。不要说成「所有会话」；
  它只聚合 OpenCode 已知后代会话。
```

## 本地开发

在 checkout 中执行 `bun install --frozen-lockfile`。以 `opencode2 debug paths` 输出为准，创建 `<config>/plugins/opencode-metrics/tui.ts`：

```ts
export { default } from "/absolute/path/to/opencode-metrics/src/tui.tsx"
```

将占位路径替换为你的 checkout 路径。这条全局发现路径已在本机验证，不要同时通过发现目录和 `cli.json` 重复启用。启动新的 O2 客户端后检查真实侧边栏，而不是会话历史中的文字。

本地安装更新：拉取目标 revision、安装依赖、重开客户端；它不会跟随 npm 发版。卸载时仅删除这个发现入口文件（npm 安装则移除对应 CLI 条目），不要清理数据库或无关缓存。

从 `0.3.1` 起，插件 prepend 到 `sidebar.content`，旧 `order` 和 `forceToTop` 不再影响位置。偏好默认路径为 `~/.config/opencode/tui-preferences.jsonc`，但优先遵循 `OPENCODE_TUI_PREFERENCES_FILE`、其次 `OPENCODE_CONFIG_DIR`、然后 `XDG_CONFIG_HOME`。运行时指标配置另有路径规则，见 `src/config.ts`。

检查：

```bash
bun run check
```

CI 会针对当前 OpenCode O2 `beta` 插件契约执行检查。

`./tui` 导出指向 `src/tui.tsx`，因为 OpenCode 会通过 Bun preload 加载 TUI plugin TSX，这符合既有 TUI plugin 模式。

## 由来

`opencode-metrics` 改写自 [Icicno/opencodeBar](https://github.com/Icicno/opencodeBar)（一个 OpenCode TUI 底部状态栏插件），重做成分会话侧边栏插件。感谢上游作者的原始构想。

## 许可

[MIT](./LICENSE) © Mingjian Shao
