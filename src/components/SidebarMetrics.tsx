/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import { createSignal, onCleanup } from "solid-js"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { BarConfig, RequestMetrics } from "../types"
import type { MetricsCollector } from "../collector"
import {
    formatTokens,
    formatDuration,
    formatElapsed,
    formatSessionElapsed,
    getDisplayInputTokens,
    getDisplayOutputTokens,
    getTtft,
    getTps,
} from "../metrics"
import { StatRow } from "./StatRow"
import { badgeTextColor } from "../badge-contrast"
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

    const metrics = () => {
        tick()
        return props.collector.getCurrent(props.sessionID)
    }
    const now = () => {
        tick()
        return performance.now()
    }
    const requestNow = (m: RequestMetrics): number => {
        const live = now()
        return m.isComplete && m.completeTime !== null ? m.completeTime : live
    }

    const rowVisible = (key: keyof BarConfig["visible"]): boolean => {
        const barVis = props.barConfig.visible
        const rowPrefs = props.controller.prefs().rows
        return barVis[key] !== false && rowPrefs[key as keyof typeof rowPrefs] !== false
    }

    const sessionStartTime = (): number | null => {
        tick()
        return props.collector.getSessionStartTime(props.sessionID)
    }

    const statusLabel = (): { text: string; color: "success" | "warning" | "accent" | "dim" } => {
        const m = metrics()
        if (!m) return { text: "idle", color: "dim" }
        if (m.isStreaming) return { text: "streaming", color: "warning" }
        if (m.isComplete) return { text: "complete", color: "success" }
        return { text: "waiting", color: "accent" }
    }

    if (!props.controller.prefs().section.enabled) {
        return <></>
    }

    const collapsed = () => {
        tick()
        return props.controller.collapsed()
    }
    const headerLabel = () => props.controller.prefs().section.label

    return (
        <box
            width="100%"
            flexDirection="column"
            paddingLeft={1}
            paddingRight={1}
        >
            <box
                flexDirection="row"
                justifyContent="space-between"
                alignItems="center"
                onMouseDown={() => props.controller.toggleCollapsed()}
            >
                <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={props.theme.accent}
                >
                    <text fg={badgeTextColor(props.theme.accent, props.theme.background)}>
                        <b>{collapsed() ? "▶ " : "▼ "}{headerLabel()}</b>
                    </text>
                </box>
                {(() => {
                    const s = statusLabel()
                    const color = s.color === "success" ? props.theme.success
                        : s.color === "warning" ? props.theme.warning
                        : s.color === "accent" ? props.theme.accent
                        : props.theme.textMuted
                    return <text fg={color}><b>{s.text}</b></text>
                })()}
            </box>

            {!collapsed() && (
                metrics() ? (
                    <box width="100%" flexDirection="column" marginTop={1}>
                        {(() => {
                            const m = metrics()!
                            const frozen = requestNow(m)
                            const tps = getTps(m, frozen)
                            const ttft = getTtft(m)
                            const inputTokens = getDisplayInputTokens(m)
                            const outputTokens = getDisplayOutputTokens(m)
                            const cacheRead = m.hasExactTokens ? Math.max(0, m.exactCacheReadTokens) : 0
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
                                    {m.hasExactTokens && rowVisible("cache") && (
                                        <StatRow
                                            theme={props.theme}
                                            label="Cache"
                                            value={formatTokens(cacheRead)}
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

            {collapsed() && metrics() && (
                <box width="100%" flexDirection="column" marginTop={1}>
                    {(() => {
                        const m = metrics()!
                        const frozen = requestNow(m)
                        const tps = getTps(m, frozen)

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
