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

## 模型证据监控（默认关闭）

从 `0.6.0` 起，模型监控默认关闭，Token 指标照常显示。需要时在 `opencode.jsonc`
的同一个插件条目中设置 `options.modelMonitor`：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "opencode-metrics", "options": { "modelMonitor": true } }
  ]
}
```

设为 `false` 或省略即关闭，仅布尔值 `true` 会开启。关闭时不注册模型 HTTP 钩子或
模型 RPC，不轮询、不显示模型字段；普通 Token 指标继续工作。已存证据保留，重新开启
后可恢复；从 `0.5.0` 升级也遵循默认关闭。`rows.model`／`visible.model` 只负责隐藏已
开启的模型行，不能替代采集开关。修改后新开 TUI 验证。本地开发时将 `package` 换为
checkout 的 `src/` 绝对路径；远程连接时，在运行采集入口的服务端开启此选项。

首次安装或显式升级：

```sh
opencode plugin add opencode-metrics@0.6.0
```

已有未锁定版本的条目可用 `opencode plugin update opencode-metrics` 更新。
只在 `opencode.jsonc` 保留一个 metrics 条目，并保留其他插件。OpenCode 会自动加载其
TUI 入口；如果之前按两份配置安装，移除 `cli.json` 中重复的 metrics 条目即可。
已安装副本不会自动跟随 npm 更新，升级后新开 TUI 验证。
本地开发时安装 checkout 依赖，在 `opencode.jsonc` 中配置一次本仓库 `src/` 目录的
绝对路径，即可发现服务端和 TUI 入口。源码加载无需构建，构建不会修改现有配置。
回退时将 CLI 条目锁定为 `opencode-metrics@0.4.2`，并移除新增的服务端入口。

开启监控并展开侧栏后可见「Request model」「Response model」「Model evidence」：分别来自实际发出的
JSON 请求体、本机收到的原始 JSON／SSE 模型字段，以及字段来源。完整内部标识自动换行，
不截掉后缀。缺失时显示 `unknown`，不会用请求别名兜底；采集入口不可用时单独注明。
新步骤等待响应时保留上一次已采集的模型对，并明确标为「Last request/response model」，
新响应证据到达后替换；树形统计模式下模型仍只对应当前前台会话。

这不是已验证的最上游身份，中转可以隐藏或改写模型字段。原生 WebSocket 流量及不支持的
内容类型不会采集；标题、压缩和临时生成请求不混入前台记录。只在服务端内存保留最近
256 个会话的模型标识和时间；最后已采集的模型对按会话保存到插件存储，重启后可恢复，
不保存密钥、提示词或响应正文。流式 JSON 解析只保留键和模型字符串，大段回显指令不会
遮住模型证据；最大嵌套 128 层，模型标识 512 字符，请求体最多读取 4 MiB。
OpenCode V2 `2.0.3` 上已通过真实 Responses 请求验证请求与响应模型分离采集；
保留／恢复及窄侧栏布局另有自动化测试。原生 WebSocket 采集仍不支持。

例如，运营商把退役别名路由到替代模型，并在 `model` 中返回替代模型名，两行就能显示
这个差异。如果仍返回原别名或不返回该字段，插件无法推断隐藏的后端。
请求与响应分开记录的口径参照 [OpenTelemetry GenAI](https://github.com/open-telemetry/semantic-conventions-genai)
和 [OpenLLMetry OpenAI instrumentation](https://github.com/traceloop/openllmetry-js/tree/main/packages/instrumentation-openai)。
本功能被动读取响应证据，不额外发送模型探测请求。

<br/>

## 从 npm 安装

先通过你实际使用的启动命令运行 `opencode debug paths`，以输出的 **config** 目录为准；启动脚本可能通过 `OPENCODE_CONFIG_DIR` 改写默认目录。在 `<config>/opencode.jsonc` 中加入一次插件，保留其他设置：

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-metrics"]
}
```

OpenCode 从连接的服务端获取插件列表并自动加载其 TUI 入口，无需在 `cli.json` 重复注册。
此默认安装只显示 Token 指标；模型证据监控需要显式开启上述选项。
配置或更新后新开一个 TUI 窗口验证，本次配置调整无需重启共享服务。

不要假定重开会自动更新 npm 副本，应使用显式升级命令。

### 为什么 `/plugins` 仍显示两行

`opencode-metrics` 是一个包，包含两个运行角色：

- **TUI — `opencode-metrics`**：渲染侧栏，包括模型证据。
- **Server — `opencode-metrics-model`**：显式开启后观察 HTTP、保存模型证据，通过 RPC 提供给侧栏。

OpenCode `2.0.9` 按 TUI 和 Server 分组，即使两个入口使用相同 ID 也显示两行，
并不代表重复安装。服务端 ID 保持稳定，以保留其名下的历史模型记录；RPC 路径仍为
`opencode-metrics-model/get`。改 ID 无法合并宿主界面中的两行。

如果刻意只安装侧栏，连接的服务端没有安装本包，可改为在 `cli.json` 注册：Token
指标仍可用，原始模型证据需要连接的服务端加载采集入口。本地 `src/` 路径必须在加载
入口的机器上存在；远程场景优先使用 npm 包。

## 为什么是侧边栏，而不是底部状态栏

底部状态栏只保留**一份**请求视图。在 `opencode serve` 下，多个 attach 的会话会同时运行 —— 所以全局状态栏显示的是汇总或错会话的数字。

`opencode-metrics` 按 `sessionID` 记录请求，并渲染 O2 传给 `sidebar.content` slot 的会话。

## 兼容性

| OpenCode 版本线 | 状态 | 证据 |
|---|---|---|
| OpenCode V2（`2.0.9`） | 已确认主题兼容与单入口本地加载 | 新 TUI 显示 Metrics 和模型字段，模型 RPC 可用；当前和 beta 主题字段均有测试覆盖 |
| O2 beta（`0.0.0-beta-19192`） | 已确认本地加载与实时速度 | 全局发现入口导入本地源码；真实 TUI 流达到 `9.6 t/s live` |
| OpenCode V1 | `0.3.x` 不支持 | `0.3.x` 已迁移至 O2 插件 API；旧入口请保留 `0.2.x` |

O2 适配器使用 `Plugin.define`、`context.data` 事件与缓存数据，以及 `context.ui.slot`，通过宿主数据 API 同步缺失历史。真实 `0.0.0-beta-19192` TUI 流已确认 Speed 行会在增量稀疏时显示 `~avg`，连续输出时切换为 `live`。并发会话隔离和真实子会话聚合仍缺少运行时验证。六月的旧 `tui-v2` candidate 不能证明当前 O2 API 兼容。

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

1. 使用用户实际启动命令运行 opencode debug paths。
   在 <config>/opencode.jsonc 的 "plugins" 数组加入一次 "opencode-metrics"，
   保留其他插件条目。OpenCode 会自动加载其 TUI 入口。
2. 如果 cli.json 中已有重复的 metrics 条目，仅移除该条目。
   用 opencode plugin add/update 安装或更新指定版本，验证消费端可用性；
   发布成功不能代替安装验证。
3. 新开 TUI 窗口验证安装结果，无需重启共享服务。
   /plugins 中按 TUI 和 Server 分组显示两个运行角色。

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

在 checkout 中执行 `bun install --frozen-lockfile`。以 `opencode debug paths` 输出为准，在 `opencode.jsonc` 中注册一次 checkout 的 `src/` 目录：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-metrics/src"]
}
```

将占位路径替换为你的 checkout 路径。OpenCode 会发现 `server.ts` 和 `tui.tsx`，源码加载无需构建。避免再通过 `cli.json` 或旧发现入口重复注册。路径用 `src/`，不要用 `dist/` 或仓库根目录，详见 [排障文档](./TROUBLESHOOTING.md)。启动新的客户端后检查真实侧边栏，而不是会话历史中的文字。

本地安装更新：拉取目标 revision、安装依赖、重开客户端；它不会跟随 npm 发版。卸载时移除 `opencode.jsonc` 中本包或路径的条目，以及旧的 metrics 专用 CLI 条目或发现入口，保留其他设置和已存数据。

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
