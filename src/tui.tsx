/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import type { TuiPlugin, TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui"
import type { PluginOptions } from "@opencode-ai/plugin"
import { createCollector } from "./collector"
import { getConfig } from "./config"
import { log } from "./logger"
import { SidebarMetrics } from "./components/SidebarMetrics"
import {
    computeEffectiveOrder,
    createMetricsSidebarController,
    DEFAULT_SLOT_ORDER,
    PLUGIN_KEY,
    resolveMetricsPrefs,
} from "./tui-preferences"
import { readTuiPreferencesFileSync } from "./tui-prefs-io"

const plugin: TuiPlugin = async (api: TuiPluginApi, _options: PluginOptions | undefined, _meta: TuiPluginMeta) => {
    const config = getConfig()
    const collector = createCollector(api, config, log)

    // Sync-read preferences at slot mount so the sidebar renders at its final
    // order and collapse state on the first paint (no async flicker).
    const seedRoot = readTuiPreferencesFileSync()
    const effectiveOrder = computeEffectiveOrder(seedRoot, PLUGIN_KEY, DEFAULT_SLOT_ORDER)
    const prefs = resolveMetricsPrefs(seedRoot)
    const controller = createMetricsSidebarController(prefs, () => api.renderer.requestRender())

    api.slots.register({
        order: effectiveOrder,
        slots: {
            sidebar_content(ctx, props) {
                return (
                    <SidebarMetrics
                        sessionID={props.session_id}
                        collector={collector}
                        refreshIntervalMs={config.refreshIntervalMs}
                        barConfig={config}
                        theme={ctx.theme.current}
                        controller={controller}
                    />
                )
            },
        },
    })

    api.lifecycle.onDispose(() => {
        collector.dispose()
    })

    log("opencode-metrics sidebar initialized")
}

const pluginModule: { id: string; tui: TuiPlugin } = {
    id: "opencode-metrics",
    tui: plugin,
}

export default pluginModule
