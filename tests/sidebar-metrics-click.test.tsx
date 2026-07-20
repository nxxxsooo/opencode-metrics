/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { MouseButtons } from "@opentui/core/testing"
import { SidebarMetrics } from "../src/components/SidebarMetrics"
import { StatRow } from "../src/components/StatRow"
import { DEFAULT_CONFIG } from "../src/types"
import { DEFAULT_PREFS } from "../src/tui-preferences"
import type { MetricsCollector, MetricsListener } from "../src/collector"
import type { MetricsAggregate } from "../src/types"
import type { MetricsSidebarController } from "../src/tui-preferences"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"

const collector: MetricsCollector = {
    getCurrent: () => null,
    getAggregate: () => null,
    getSessionElapsedMs: () => 0,
    getChildSessionCount: () => 0,
    subscribe: (_listener: MetricsListener) => () => {},
    dispose: () => {},
}

function createTheme(): TuiThemeCurrent {
    const white = RGBA.fromHex("#ffffff")
    const muted = RGBA.fromHex("#888888")
    const cyan = RGBA.fromHex("#00ffff")
    const yellow = RGBA.fromHex("#ffff00")
    const green = RGBA.fromHex("#00ff00")
    const red = RGBA.fromHex("#ff0000")
    const black = RGBA.fromHex("#000000")

    return {
        primary: cyan,
        secondary: muted,
        accent: cyan,
        error: red,
        warning: yellow,
        success: green,
        info: cyan,
        text: white,
        textMuted: muted,
        selectedListItemText: black,
        background: black,
        backgroundPanel: black,
        backgroundElement: black,
        backgroundMenu: black,
        border: muted,
        borderActive: cyan,
        borderSubtle: muted,
        diffAdded: green,
        diffRemoved: red,
        diffContext: white,
        diffHunkHeader: cyan,
        diffHighlightAdded: green,
        diffHighlightRemoved: red,
        diffAddedBg: black,
        diffRemovedBg: black,
        diffContextBg: black,
        diffLineNumber: muted,
        diffAddedLineNumberBg: black,
        diffRemovedLineNumberBg: black,
        markdownText: white,
        markdownHeading: cyan,
        markdownLink: cyan,
        markdownLinkText: cyan,
        markdownCode: yellow,
        markdownBlockQuote: muted,
        markdownEmph: white,
        markdownStrong: white,
        markdownHorizontalRule: muted,
        markdownListItem: white,
        markdownListEnumeration: cyan,
        markdownImage: cyan,
        markdownImageText: white,
        markdownCodeBlock: black,
        syntaxComment: muted,
        syntaxKeyword: cyan,
        syntaxFunction: green,
        syntaxVariable: white,
        syntaxString: green,
        syntaxNumber: yellow,
        syntaxType: cyan,
        syntaxOperator: white,
        syntaxPunctuation: white,
        thinkingOpacity: 0.65,
    }
}

describe("SidebarMetrics", () => {
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
                isStreaming: false,
                isComplete: true,
            }
            listener?.()

            const frame = await setup.waitForFrame((value) => value.includes("↓ 123 in") && value.includes("↑ 4 out"))
            expect(frame).not.toContain("No active request")
        } finally {
            setup.renderer.destroy()
        }
    })

    test("collapsed sidebar shows compact speed and session rows only when active", async () => {
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
            expect(setup.captureCharFrame()).not.toContain("Speed")
            expect(setup.captureCharFrame()).not.toContain("Tokens")

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
                isStreaming: false,
                isComplete: true,
            }
            listener?.()

            const frame = await setup.waitForFrame((value) => value.includes("Speed") && value.includes("Session"))
            expect(frame).not.toContain("Tokens")
            expect(frame).not.toContain("Elapsed")
            expect(frame).not.toContain("TTFT")
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
