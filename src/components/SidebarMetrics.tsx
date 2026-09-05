/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import { createMemo, createSignal, onCleanup } from "solid-js"
import type { BoxRenderable } from "@opentui/core"
import type { BarConfig, MetricsAggregate, MetricsTheme } from "../types"
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
    theme: MetricsTheme
    controller: MetricsSidebarController
    requestRender?: () => void
}

export function formatSpeedValue(
    aggregate: MetricsAggregate | null,
    fallbackAverageTps: number | null = null,
): string {
    if (aggregate?.liveTps !== null && aggregate?.liveTps !== undefined) {
        return `${aggregate.liveTps.toFixed(1)} t/s live`
    }
    if (aggregate?.averageTps !== null && aggregate?.averageTps !== undefined) {
        return `${aggregate.averageTps.toFixed(1)} t/s ${aggregate.isComplete ? "avg" : "~avg"}`
    }
    const previous = aggregate?.previousAverageTps ?? fallbackAverageTps
    return previous === null ? "待测" : `${previous.toFixed(1)} t/s avg`
}

export function SidebarMetrics(props: SidebarMetricsProps) {
    let disposed = false
    let refreshQueued = false
    let interval: ReturnType<typeof setInterval> | undefined
    let unsub = () => {}
    let unsubController = () => {}
    const rowSyncs = new Set<() => void>()
    const registerRowSync = (sync: () => void) => {
        if (disposed) return () => {}
        rowSyncs.add(sync)
        return () => rowSyncs.delete(sync)
    }
    const syncRows = () => {
        if (disposed) return
        for (const sync of rowSyncs) sync()
    }
    const [tick, setTick] = createSignal(0)
    const bump = () => {
        if (disposed) return
        setTick((t) => t + 1)
        syncRows()
        if (refreshQueued) return
        refreshQueued = true
        queueMicrotask(() => {
            refreshQueued = false
            if (disposed) return
            syncRows()
            props.requestRender?.()
        })
    }

    onCleanup(() => {
        disposed = true
        refreshQueued = false
        rowSyncs.clear()
        if (interval !== undefined) clearInterval(interval)
        unsub()
        unsubController()
    })

    interval = setInterval(bump, props.refreshIntervalMs)
    unsub = props.collector.subscribe(bump)
    unsubController = props.controller.subscribe(bump)

    const sectionEnabled = createMemo(() => {
        tick()
        return props.controller.prefs().section.enabled
    })
    const requestNow = (m: MetricsAggregate): number => {
        const live = performance.now()
        return m.isComplete && m.completeTime !== null ? m.completeTime : live
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
    const headerStatus = () => {
        const aggregate = currentAggregate()
        return aggregate && !aggregate.isComplete && aggregate.outputTokens === 0 ? " · running · waiting" : ""
    }
    const toggleCollapsed = () => props.controller.toggleCollapsed()
    const attachBoxToggle = (node: BoxRenderable) => {
        node.onMouseDown = toggleCollapsed
    }
    const currentScope = () => props.controller.prefs().scope
    let lastSettledAggregate: MetricsAggregate | null = null
    const currentAggregate = () => {
        const aggregate = props.collector.getAggregate(props.sessionID, currentScope())
        if (aggregate?.isComplete && aggregate.outputTokens > 0) lastSettledAggregate = aggregate
        return aggregate
    }
    const valuesAggregate = () => {
        const current = currentAggregate()
        return current && !current.isComplete && current.outputTokens === 0 && lastSettledAggregate
            ? lastSettledAggregate
            : current
    }
    const hasAggregate = () => currentAggregate() !== null
    const expandedActive = () => !collapsed() && hasAggregate()
    const expandedIdle = () => !collapsed() && !hasAggregate()
    const collapsedSummary = () => collapsed()
    const frozenNow = (): number => {
        const m = currentAggregate()
        if (!m) return performance.now()
        return requestNow(m)
    }
    const speedValue = () => {
        const m = currentAggregate()
        return formatSpeedValue(m, lastSettledAggregate?.averageTps ?? null)
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
        const m = valuesAggregate()
        if (!m) return "—"
        const inputTokens = m?.inputTokens ?? 0
        const outputTokens = m?.outputTokens ?? 0
        return `${rowVisible("input") ? `↓ ${m.inputIsEstimated ? "~" : ""}${formatTokens(inputTokens)} in` : ""}${rowVisible("input") && rowVisible("output") ? "  " : ""}${rowVisible("output") ? `↑ ${m.outputIsEstimated ? "~" : ""}${formatTokens(outputTokens)} out` : ""}`
    }
    const cacheValue = () => {
        const m = valuesAggregate()
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
                    <b>{collapsed() ? "▶ " : "▼ "}{headerLabel()}</b>{headerStatus()}
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
                        visible={() => !collapsed()}
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
                {rowVisible("ttft") && (
                    <StatRow
                        theme={props.theme}
                        label="TTFT"
                        value={ttftValue}
                        icon="⏱"
                        dim
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
                        dim
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
                        visible={collapsedSummary}
                    />
                )}
                {(rowVisible("input") || rowVisible("output")) && (
                    <StatRow
                        theme={props.theme}
                        label="Tokens"
                        value={tokenValue}
                        registerSync={registerRowSync}
                        visible={collapsedSummary}
                    />
                )}
            </box>
        </box>
    )
}
