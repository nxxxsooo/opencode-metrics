/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import { createSignal, onCleanup } from "solid-js"
import type { BoxRenderable } from "@opentui/core"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { BarConfig, MetricsAggregate, MetricsScope } from "../types"
import type { MetricsCollector } from "../collector"
import {
    formatTokens,
    formatDuration,
    formatElapsed,
    formatSessionElapsed,
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
}

export function SidebarMetrics(props: SidebarMetricsProps) {
    const [tick, setTick] = createSignal(0)
    const bump = () => setTick((t) => t + 1)

    const interval = setInterval(bump, props.refreshIntervalMs)
    onCleanup(() => clearInterval(interval))

    const unsub = props.collector.subscribe(bump)
    onCleanup(unsub)

    const unsubController = props.controller.subscribe(bump)
    onCleanup(unsubController)

    const scope = (): MetricsScope => props.controller.prefs().scope
    const aggregate = () => {
        tick()
        return props.collector.getAggregate(props.sessionID, scope())
    }
    const now = () => {
        tick()
        return performance.now()
    }
    const requestNow = (m: MetricsAggregate): number => {
        const live = now()
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

    const sessionStartTime = (): number | null => {
        tick()
        return props.collector.getSessionStartTime(props.sessionID, scope())
    }

    if (!props.controller.prefs().section.enabled) {
        return <></>
    }

    const collapsed = () => {
        tick()
        return props.controller.collapsed()
    }
    const headerLabel = () => props.controller.prefs().section.label
    const toggleCollapsed = () => props.controller.toggleCollapsed()
    const attachBoxToggle = (node: BoxRenderable) => {
        node.onMouseDown = toggleCollapsed
    }

    return (
        <box
            width="100%"
            flexDirection="column"
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

            {!collapsed() && (
                aggregate() ? (
                    <box width="100%" flexDirection="column" marginTop={1}>
                        {(() => {
                            const m = aggregate()
                            if (m === null) return <></>
                            const frozen = requestNow(m)
                            const tps = aggregateTps(m, frozen)
                            const ttft = m.ttft
                            const inputTokens = m.inputTokens
                            const outputTokens = m.outputTokens
                            const elapsedMs = frozen - m.requestStartTime

                            return (
                                <>
                                    {rowVisible("speed") && (
                                        <StatRow
                                            theme={props.theme}
                                            label="Speed"
                                            value={`${tps.toFixed(1)} t/s`}
                                            accent
                                            icon="⚡"
                                        />
                                    )}
                                    {rowVisible("elapsed") && (
                                        <StatRow
                                            theme={props.theme}
                                            label="Elapsed"
                                            value={formatElapsed(elapsedMs)}
                                            icon="▹"
                                        />
                                    )}
                                    {rowVisible("ttft") && (
                                        <StatRow
                                            theme={props.theme}
                                            label="TTFT"
                                            value={ttft !== null ? formatDuration(ttft) : "--"}
                                            icon="⏱"
                                        />
                                    )}
                                    {(rowVisible("input") || rowVisible("output")) && (
                                        <StatRow
                                            theme={props.theme}
                                            label="Tokens"
                                            value={`${rowVisible("input") ? `↓ ${formatTokens(inputTokens)} in` : ""}${rowVisible("input") && rowVisible("output") ? "  " : ""}${rowVisible("output") ? `↑ ${formatTokens(outputTokens)} out` : ""}`}
                                        />
                                    )}
                                    {rowVisible("cache") && (
                                        <StatRow
                                            theme={props.theme}
                                            label="Cache"
                                            value={formatCacheRead(m.cacheReadTokens, m.cacheReadCompleteness)}
                                            dim
                                            icon="○"
                                        />
                                    )}
                                    {sessionStartTime() !== null && rowVisible("session") && (
                                        <StatRow
                                            theme={props.theme}
                                            label="Session"
                                            value={formatSessionElapsed(now(), sessionStartTime()!)}
                                            icon="◷"
                                        />
                                    )}
                                </>
                            )
                        })()}
                    </box>
                ) : (
                    <box width="100%" flexDirection="column" marginTop={1}>
                        <StatRow theme={props.theme} label="Status" value="No active request" dim icon="○" />
                        {sessionStartTime() !== null && rowVisible("session") && (
                            <StatRow
                                theme={props.theme}
                                label="Session"
                                value={formatSessionElapsed(now(), sessionStartTime()!)}
                                icon="◷"
                            />
                        )}
                    </box>
                )
            )}

            {collapsed() && aggregate() && (
                <box width="100%" flexDirection="column" marginTop={1}>
                    {(() => {
                        const m = aggregate()
                        if (m === null) return <></>
                        const frozen = requestNow(m)
                        const tps = aggregateTps(m, frozen)

                        return (
                            <>
                                {rowVisible("speed") && (
                                    <StatRow
                                        theme={props.theme}
                                        label="Speed"
                                        value={`${tps.toFixed(1)} t/s`}
                                        accent
                                        icon="⚡"
                                    />
                                )}
                                {sessionStartTime() !== null && rowVisible("session") && (
                                    <StatRow
                                        theme={props.theme}
                                        label="Session"
                                        value={formatSessionElapsed(now(), sessionStartTime()!)}
                                        icon="◷"
                                    />
                                )}
                            </>
                        )
                    })()}
                </box>
            )}

        </box>
    )
}
