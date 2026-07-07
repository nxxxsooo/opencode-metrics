/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { MouseButtons } from "@opentui/core/testing"
import { SidebarMetrics } from "../src/components/SidebarMetrics"
import { DEFAULT_CONFIG } from "../src/types"
import { DEFAULT_PREFS } from "../src/tui-preferences"
import type { MetricsCollector, MetricsListener } from "../src/collector"
import type { MetricsSidebarController } from "../src/tui-preferences"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"

const collector: MetricsCollector = {
    getCurrent: () => null,
    getAggregate: () => null,
    getSessionStartTime: () => null,
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

describe("SidebarMetrics header click", () => {
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
