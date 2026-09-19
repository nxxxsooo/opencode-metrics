/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { MouseButtons } from "@opentui/core/testing"
import { formatSpeedValue, SidebarMetrics } from "../src/components/SidebarMetrics"
import { StatRow } from "../src/components/StatRow"
import { DEFAULT_CONFIG } from "../src/types"
import { DEFAULT_PREFS } from "../src/tui-preferences"
import type { MetricsCollector, MetricsListener } from "../src/collector"
import type { MetricsAggregate, MetricsTheme } from "../src/types"
import type { MetricsSidebarController } from "../src/tui-preferences"

const collector: MetricsCollector = {
    getCurrent: () => null,
    getAggregate: () => null,
    getSessionElapsedMs: () => 0,
    getChildSessionCount: () => 0,
    subscribe: (_listener: MetricsListener) => () => {},
    dispose: () => {},
}

function createTheme(): MetricsTheme {
    const white = RGBA.fromHex("#ffffff")
    const muted = RGBA.fromHex("#888888")
    const cyan = RGBA.fromHex("#00ffff")
    const yellow = RGBA.fromHex("#ffff00")
    const green = RGBA.fromHex("#00ff00")
    return {
        accent: cyan,
        warning: yellow,
        success: green,
        text: white,
        textMuted: muted,
    }
}

describe("SidebarMetrics", () => {
    test.each([undefined, false])("model monitoring %s hides model rows and performs no polling", async (modelMonitor) => {
        let listener: MetricsListener | null = null
        let polls = 0
        const activeCollector: MetricsCollector = {
            ...collector,
            getAggregate: () => ({
                sessionIDs: ["ses_test"], childSessionCount: 0,
                inputTokens: 1, outputTokens: 1, cacheReadTokens: 0,
                cacheReadCompleteness: "unknown", requestStartTime: performance.now(),
                firstTokenTime: null, completeTime: null, ttft: null,
                liveTps: 12, averageTps: null, previousAverageTps: null,
                inputIsEstimated: false, outputIsEstimated: false,
                isStreaming: true, isComplete: false,
            }),
            subscribe: (next) => { listener = next; return () => { listener = null } },
        }
        const controller: MetricsSidebarController = {
            prefs: () => DEFAULT_PREFS, collapsed: () => false,
            toggleCollapsed: () => {}, subscribe: () => () => {},
        }
        const setup = await testRender(() => (
            <SidebarMetrics sessionID="ses_test" collector={activeCollector}
                refreshIntervalMs={10_000} barConfig={DEFAULT_CONFIG}
                theme={createTheme()} controller={controller} modelMonitor={modelMonitor}
                fetchModelIdentity={async () => { polls++; return null }} />
        ), { width: 40, height: 24 })
        try {
            await setup.flush()
            listener?.()
            const frame = await setup.waitForFrame((value) => value.includes("12.0 t/s live"))
            expect(polls).toBe(0)
            expect(frame).toContain("Tokens")
            expect(frame).not.toContain("Request model")
            expect(frame).not.toContain("Response model")
            expect(frame).not.toContain("Model evidence")
        } finally { setup.renderer.destroy() }
    })

    test("raw model rows wrap full identifiers, reset on a new step and show unavailable collection", async () => {
        let listener: MetricsListener | null = null
        let epoch = 0
        let unavailable = false
        let idleWithoutMetrics = false
        const model = "gpt-6-luna-exp-1p-arm2-codexswic-ev3-premium"
        const activeCollector: MetricsCollector = {
            ...collector,
            getAggregate: () => idleWithoutMetrics ? null : ({
                sessionIDs: ["ses_test"], childSessionCount: 0,
                inputTokens: 1, outputTokens: 1, cacheReadTokens: 0,
                cacheReadCompleteness: "unknown", requestStartTime: performance.now(),
                firstTokenTime: null, completeTime: null, ttft: null,
                liveTps: null, averageTps: null, previousAverageTps: null,
                inputIsEstimated: false, outputIsEstimated: false,
                isStreaming: true, isComplete: false,
            }),
            subscribe: (next) => { listener = next; return () => { listener = null } },
        }
        const controller: MetricsSidebarController = {
            prefs: () => DEFAULT_PREFS, collapsed: () => false,
            toggleCollapsed: () => {}, subscribe: () => () => {},
        }
        const setup = await testRender(() => (
            <SidebarMetrics sessionID="ses_test" collector={activeCollector}
                refreshIntervalMs={10_000} barConfig={DEFAULT_CONFIG}
                modelMonitor={true}
                theme={createTheme()} controller={controller} modelEpoch={() => epoch}
                fetchModelIdentity={async () => {
                    if (unavailable) throw new Error("missing RPC")
                    return epoch === 0 ? { requested: "gpt-5.6-luna", reported: model, source: "response.model", observedAt: 1 } : null
                }} />
        ), { width: 32, height: 24 })
        try {
            await setup.flush()
            listener?.()
            const frame = await setup.waitForFrame((value) => value.includes("response.model"))
            expect(frame.replace(/\s/g, "")).toContain(model)
            expect(frame).toContain("gpt-5.6-luna")
            idleWithoutMetrics = true
            listener?.()
            const idle = await setup.waitForFrame((value) => value.includes("No active request"))
            expect(idle.replace(/\s/g, "")).toContain(model)
            epoch++
            listener?.()
            const reset = await setup.waitForFrame((value) => value.includes("previous HTTP"))
            expect(reset).toContain("gpt-5.6-luna")
            expect(reset).toContain("Last response model")
            unavailable = true
            epoch++
            listener?.()
            const failed = await setup.waitForFrame((value) => value.includes("collector unavailable"))
            expect(failed.replace(/\s/g, "")).toContain(model)
        } finally { setup.renderer.destroy() }
    })

    test("speed transitions from live to current average to retained average without blanking", () => {
        const base: MetricsAggregate = {
            sessionIDs: ["ses_test"], childSessionCount: 0,
            inputTokens: 10, outputTokens: 20, cacheReadTokens: 0,
            cacheReadCompleteness: "unknown", requestStartTime: 0,
            firstTokenTime: 100, completeTime: null, ttft: 100,
            liveTps: 42.1, averageTps: 38.6, previousAverageTps: 37.9,
            inputIsEstimated: false, outputIsEstimated: true,
            isStreaming: true, isComplete: false,
        }
        expect(formatSpeedValue(base)).toBe("42.1 t/s live")
        expect(formatSpeedValue({ ...base, liveTps: null, isStreaming: false })).toBe("38.6 t/s ~avg")
        expect(formatSpeedValue({ ...base, liveTps: null, averageTps: null, outputTokens: 0 })).toBe("37.9 t/s avg")
        expect(formatSpeedValue(null)).toBe("pending")
        expect(formatSpeedValue({ ...base, liveTps: null, isComplete: true, completeTime: 1000 })).toBe("38.6 t/s avg")
    })

    test("a retained row sync is inert after the renderer is destroyed", async () => {
        // Given: an in-flight collector dispatch retained a row callback while the TUI exits.
        let retainedSync: (() => void) | undefined
        const setup = await testRender(
            () => (
                <StatRow
                    theme={createTheme()}
                    label="Tokens"
                    value="↓ 123 in"
                    registerSync={(sync) => {
                        retainedSync = sync
                        return () => {}
                    }}
                />
            ),
            { width: 40, height: 4 },
        )

        await setup.flush()

        // When: OpenTUI has released the row before the retained dispatch finishes.
        setup.renderer.destroy()

        // Then: the late callback must not write to the destroyed TextBuffer.
        expect(() => retainedSync?.()).not.toThrow()
    })

    test("a queued sidebar refresh is cancelled when the renderer is destroyed", async () => {
        // Given: a collector update schedules a follow-up microtask render.
        let retainedListener: MetricsListener | null = null
        let renderRequests = 0
        const notifyingCollector: MetricsCollector = {
            ...collector,
            subscribe: (next: MetricsListener) => {
                retainedListener = next
                return () => {}
            },
        }
        const prefs = structuredClone(DEFAULT_PREFS)
        const controller: MetricsSidebarController = {
            prefs: () => prefs,
            collapsed: () => false,
            toggleCollapsed: () => {},
            subscribe: () => () => {},
        }
        const setup = await testRender(
            () => (
                <SidebarMetrics
                    sessionID="ses_test"
                    collector={notifyingCollector}
                    refreshIntervalMs={10_000}
                    barConfig={DEFAULT_CONFIG}
                    theme={createTheme()}
                    controller={controller}
                    requestRender={() => {
                        renderRequests += 1
                    }}
                />
            ),
            { width: 40, height: 12 },
        )

        await setup.flush()
        retainedListener?.()

        // When: the TUI exits before the queued microtask runs.
        setup.renderer.destroy()
        await Promise.resolve()

        // Then: no render request escapes component cleanup.
        expect(renderRequests).toBe(0)
    })

    test("collector updates rerender metric rows", async () => {
        // Given: the sidebar starts idle before OpenCode has delivered token metrics.
        let listener: MetricsListener | null = null
        let aggregate: MetricsAggregate | null = null
        const dynamicCollector: MetricsCollector = {
            ...collector,
            getAggregate: () => aggregate,
            getSessionElapsedMs: () => aggregate ? 1200 : 0,
            subscribe: (next: MetricsListener) => {
                listener = next
                return () => {
                    listener = null
                }
            },
        }
        const prefs = structuredClone(DEFAULT_PREFS)
        const controller: MetricsSidebarController = {
            prefs: () => prefs,
            collapsed: () => false,
            toggleCollapsed: () => {},
            subscribe: () => () => {},
        }
        let requestRender = () => {}

        const setup = await testRender(
            () => (
                <SidebarMetrics
                    sessionID="ses_test"
                    collector={dynamicCollector}
                    refreshIntervalMs={10_000}
                    barConfig={DEFAULT_CONFIG}
                    theme={createTheme()}
                    controller={controller}
                    requestRender={() => requestRender()}
                />
            ),
            { width: 60, height: 14, useMouse: true },
        )
        requestRender = () => setup.renderer.requestRender()

        try {
            await setup.flush()
            expect(setup.captureCharFrame()).toContain("No active request")

            aggregate = {
                sessionIDs: ["ses_runtime"],
                childSessionCount: 0,
                inputTokens: 123,
                outputTokens: 4,
                cacheReadTokens: 0,
                cacheReadCompleteness: "exact",
                requestStartTime: performance.now() - 1200,
                firstTokenTime: null,
                completeTime: null,
                ttft: null,
                liveTps: 32.4,
                averageTps: 3.3,
                previousAverageTps: null,
                inputIsEstimated: false,
                outputIsEstimated: false,
                isStreaming: false,
                isComplete: true,
            }
            listener?.()

            const frame = await setup.waitForFrame((value) => value.includes("↓ 123 in") && value.includes("↑ 4 out"))
            expect(frame).not.toContain("No active request")
            expect(frame).toContain("32.4 t/s")
        } finally {
            setup.renderer.destroy()
        }
    })

    test("collapsed sidebar always shows compact speed and token rows", async () => {
        // Given: a collapsed sidebar has no request yet.
        let listener: MetricsListener | null = null
        let aggregate: MetricsAggregate | null = null
        const dynamicCollector: MetricsCollector = {
            ...collector,
            getAggregate: () => aggregate,
            getSessionElapsedMs: () => aggregate ? 1200 : 0,
            subscribe: (next: MetricsListener) => {
                listener = next
                return () => {
                    listener = null
                }
            },
        }
        const prefs = structuredClone(DEFAULT_PREFS)
        const controller: MetricsSidebarController = {
            prefs: () => prefs,
            collapsed: () => true,
            toggleCollapsed: () => {},
            subscribe: () => () => {},
        }
        let requestRender = () => {}

        const setup = await testRender(
            () => (
                <SidebarMetrics
                    sessionID="ses_test"
                    collector={dynamicCollector}
                    refreshIntervalMs={10_000}
                    barConfig={DEFAULT_CONFIG}
                    theme={createTheme()}
                    controller={controller}
                    requestRender={() => requestRender()}
                />
            ),
            { width: 60, height: 10, useMouse: true },
        )
        requestRender = () => setup.renderer.requestRender()

        try {
            await setup.flush()
            expect(setup.captureCharFrame()).toContain("Speed")
            expect(setup.captureCharFrame()).toContain("pending")
            expect(setup.captureCharFrame()).toContain("Tokens")

            aggregate = {
                sessionIDs: ["ses_runtime"],
                childSessionCount: 0,
                inputTokens: 123,
                outputTokens: 4,
                cacheReadTokens: 0,
                cacheReadCompleteness: "exact",
                requestStartTime: performance.now() - 1200,
                firstTokenTime: null,
                completeTime: null,
                ttft: null,
                liveTps: null,
                averageTps: 3.3,
                previousAverageTps: null,
                inputIsEstimated: false,
                outputIsEstimated: false,
                isStreaming: false,
                isComplete: true,
            }
            listener?.()

            const frame = await setup.waitForFrame((value) => value.includes("3.3 t/s avg") && value.includes("Tokens"))
            expect(frame).not.toContain("Session")
            expect(frame).not.toContain("Elapsed")
            expect(frame).not.toContain("TTFT")
            expect(frame).toContain("3.3 t/s avg")
        } finally {
            setup.renderer.destroy()
        }
    })

    test("collector updates request a TUI render", async () => {
        // Given: a sidebar wired to a collector subscription and a renderer hook.
        let listener: MetricsListener | null = null
        let renderRequests = 0
        const notifyingCollector: MetricsCollector = {
            ...collector,
            subscribe: (next: MetricsListener) => {
                listener = next
                return () => {
                    listener = null
                }
            },
        }
        const prefs = structuredClone(DEFAULT_PREFS)
        const controller: MetricsSidebarController = {
            prefs: () => prefs,
            collapsed: () => false,
            toggleCollapsed: () => {},
            subscribe: () => () => {},
        }

        const setup = await testRender(
            () => (
                <SidebarMetrics
                    sessionID="ses_test"
                    collector={notifyingCollector}
                    refreshIntervalMs={10_000}
                    barConfig={DEFAULT_CONFIG}
                    theme={createTheme()}
                    controller={controller}
                    requestRender={() => {
                        renderRequests += 1
                    }}
                />
            ),
            { width: 40, height: 12, useMouse: true },
        )

        try {
            await setup.flush()
            listener?.()
            await setup.flush()

            expect(renderRequests).toBe(1)
        } finally {
            setup.renderer.destroy()
        }
    })

    test("clicking the header label toggles collapsed once", async () => {
        // Given: the sidebar header is rendered expanded with a counting controller.
        let collapsed = false
        let toggleCount = 0
        const prefs = structuredClone(DEFAULT_PREFS)
        const controller: MetricsSidebarController = {
            prefs: () => prefs,
            collapsed: () => collapsed,
            toggleCollapsed: () => {
                toggleCount += 1
                collapsed = !collapsed
            },
            subscribe: () => () => {},
        }

        const setup = await testRender(
            () => (
                <SidebarMetrics
                    sessionID="ses_test"
                    collector={collector}
                    refreshIntervalMs={10_000}
                    barConfig={DEFAULT_CONFIG}
                    theme={createTheme()}
                    controller={controller}
                />
            ),
            { width: 40, height: 12, useMouse: true },
        )

        try {
            await setup.flush()

            // When: a real OpenTUI mouse click lands on the text label.
            await setup.mockMouse.click(1, 0, MouseButtons.LEFT, { delayMs: 0 })
            await setup.flush()

            // Then: the click bubbled to the header row handler exactly once.
            expect(toggleCount).toBe(1)
            expect(collapsed).toBe(true)
        } finally {
            setup.renderer.destroy()
        }
    })
})
