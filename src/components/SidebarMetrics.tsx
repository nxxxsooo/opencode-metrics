/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import { createMemo, createSignal, onCleanup } from "solid-js"
import type { BoxRenderable } from "@opentui/core"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { BarConfig, MetricsAggregate } from "../types"
import type { MetricsCollector } from "../collector"
import {
    formatTokens,
    formatDuration,
    formatElapsed,
    formatCacheRead,
} from "../metrics"
import { StatRow } from "./StatRow"
import type { MetricsSidebarController } from "../tui-preferences"

interface SidebarMetricsProps {
    sessionID: string
    collector: MetricsCollector
    refreshIntervalMs: number
    barConfig: BarConfig
    theme: TuiThemeCurrent
    controller: MetricsSidebarController
    requestRender?: () => void
}

export function SidebarMetrics(props: SidebarMetricsProps) {
    const rowSyncs = new Set<() => void>()
    const registerRowSync = (sync: () => void) => {
        rowSyncs.add(sync)
        return () => rowSyncs.delete(sync)
    }
    const syncRows = () => {
        for (const sync of rowSyncs) sync()
    }
    const [tick, setTick] = createSignal(0)
    const bump = () => {
        setTick((t) => t + 1)
        syncRows()
        queueMicrotask(() => {
            syncRows()
            props.requestRender?.()
        })
    }

    const interval = setInterval(bump, props.refreshIntervalMs)
    onCleanup(() => clearInterval(interval))

    const unsub = props.collector.subscribe(bump)
    onCleanup(unsub)

    const unsubController = props.controller.subscribe(bump)
    onCleanup(unsubController)

    const sectionEnabled = createMemo(() => {
        tick()
        return props.controller.prefs().section.enabled
    })
    const requestNow = (m: MetricsAggregate): number => {
        const live = performance.now()
        return m.isComplete && m.completeTime !== null ? m.completeTime : live
    }

    const aggregateTps = (m: MetricsAggregate, frozen: number): number => {
        const baseTime = m.firstTokenTime ?? m.requestStartTime
        const elapsedMs = frozen - baseTime
        if (elapsedMs <= 0) return 0
        return Math.round((m.outputTokens / (elapsedMs / 1000)) * 10) / 10
    }

    const rowVisible = (key: keyof BarConfig["visible"]): boolean => {
        const barVis = props.barConfig.visible
        const rowPrefs = props.controller.prefs().rows
        return barVis[key] !== false && rowPrefs[key as keyof typeof rowPrefs] !== false
    }

    const collapsed = createMemo(() => {
        tick()
        return props.controller.collapsed()
    })
    const headerLabel = () => props.controller.prefs().section.label
    const toggleCollapsed = () => props.controller.toggleCollapsed()
    const attachBoxToggle = (node: BoxRenderable) => {
        node.onMouseDown = toggleCollapsed
    }
    const currentScope = () => props.controller.prefs().scope
    const currentAggregate = () => props.collector.getAggregate(props.sessionID, currentScope())
    const hasAggregate = () => currentAggregate() !== null
    const expandedActive = () => !collapsed() && hasAggregate()
    const expandedIdle = () => !collapsed() && !hasAggregate()
    const collapsedActive = () => collapsed() && hasAggregate()
    const frozenNow = (): number => {
        const m = currentAggregate()
        if (!m) return performance.now()
        return requestNow(m)
    }
    const speedValue = () => {
        const m = currentAggregate()
        const tps = m ? aggregateTps(m, frozenNow()) : 0
        return `${tps.toFixed(1)} t/s`
    }
    const elapsedValue = () => {
        const m = currentAggregate()
        return formatElapsed(m ? frozenNow() - m.requestStartTime : 0)
    }
    const ttftValue = () => {
        const ttft = currentAggregate()?.ttft ?? null
        return ttft !== null ? formatDuration(ttft) : "--"
    }
    const tokenValue = () => {
        const m = currentAggregate()
        const inputTokens = m?.inputTokens ?? 0
        const outputTokens = m?.outputTokens ?? 0
        return `${rowVisible("input") ? `↓ ${formatTokens(inputTokens)} in` : ""}${rowVisible("input") && rowVisible("output") ? "  " : ""}${rowVisible("output") ? `↑ ${formatTokens(outputTokens)} out` : ""}`
    }
    const cacheValue = () => {
        const m = currentAggregate()
        return formatCacheRead(m?.cacheReadTokens ?? 0, m?.cacheReadCompleteness ?? "unknown")
    }
    const sessionValue = () => {
        return formatElapsed(props.collector.getSessionElapsedMs(props.sessionID, currentScope(), performance.now()))
    }

    return (
        <box
            width="100%"
            flexDirection="column"
            height={sectionEnabled() ? "auto" : 0}
        >
            <box
                width="100%"
                flexDirection="row"
                alignItems="center"
                ref={attachBoxToggle}
            >
                <text
                    fg={props.theme.text}
                >
                    <b>{collapsed() ? "▶ " : "▼ "}{headerLabel()}</b>
                </text>
            </box>

            <box width="100%" flexDirection="column" marginTop={1}>
                <StatRow
                    theme={props.theme}
                    label="Status"
                    value="No active request"
                    dim
                    icon="○"
                    visible={expandedIdle}
                    registerSync={registerRowSync}
                />
                {rowVisible("speed") && (
                    <StatRow
                        theme={props.theme}
                        label="Speed"
                        value={speedValue}
                        accent
                        icon="⚡"
                        registerSync={registerRowSync}
                        visible={expandedActive}
                    />
                )}
                {rowVisible("elapsed") && (
                    <StatRow
                        theme={props.theme}
                        label="Elapsed"
                        value={elapsedValue}
                        icon="▹"
                        registerSync={registerRowSync}
                        visible={expandedActive}
                    />
                )}
                {rowVisible("ttft") && (
                    <StatRow
                        theme={props.theme}
                        label="TTFT"
                        value={ttftValue}
                        icon="⏱"
                        registerSync={registerRowSync}
                        visible={expandedActive}
                    />
                )}
                {(rowVisible("input") || rowVisible("output")) && (
                    <StatRow
                        theme={props.theme}
                        label="Tokens"
                        value={tokenValue}
                        registerSync={registerRowSync}
                        visible={expandedActive}
                    />
                )}
                {rowVisible("cache") && (
                    <StatRow
                        theme={props.theme}
                        label="Cache"
                        value={cacheValue}
                        dim
                        icon="○"
                        registerSync={registerRowSync}
                        visible={expandedActive}
                    />
                )}
                {rowVisible("session") && (
                    <StatRow
                        theme={props.theme}
                        label="Session"
                        value={sessionValue}
                        icon="◷"
                        registerSync={registerRowSync}
                        visible={expandedActive}
                    />
                )}
                {rowVisible("speed") && (
                    <StatRow
                        theme={props.theme}
                        label="Speed"
                        value={speedValue}
                        accent
                        icon="⚡"
                        registerSync={registerRowSync}
                        visible={collapsedActive}
                    />
                )}
                {rowVisible("session") && (
                    <StatRow
                        theme={props.theme}
                        label="Session"
                        value={sessionValue}
                        icon="◷"
                        registerSync={registerRowSync}
                        visible={collapsedActive}
                    />
                )}
            </box>
        </box>
    )
}
