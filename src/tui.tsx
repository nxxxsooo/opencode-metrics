/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import { Plugin } from "@opencode-ai/plugin/tui"
import { createCollector } from "./collector"
import { createOpenCodeV2Host } from "./opencode-compat"
import { getConfig } from "./config"
import { log } from "./logger"
import { SidebarMetrics } from "./components/SidebarMetrics"
import { createMetricsSidebarController, resolveMetricsPrefs } from "./tui-preferences"
import { readTuiPreferencesFileSync } from "./tui-prefs-io"
import type { MetricsTheme } from "./types"

export default Plugin.define({
  id: "opencode-metrics",
  setup(context) {
    const config = getConfig()
    const host = createOpenCodeV2Host(context, log)
    const collector = createCollector(host, config, log)
    const prefs = resolveMetricsPrefs(readTuiPreferencesFileSync())
    const controller = createMetricsSidebarController(prefs, () => host.requestRender())
    const theme: MetricsTheme = {
      text: context.theme.text.default,
      textMuted: context.theme.text.subdued,
      accent: context.theme.text.status.running,
      warning: context.theme.text.feedback.warning.default,
      success: context.theme.text.feedback.success.default,
    }
    const unregister = context.ui.slot({
      prepend: "sidebar.content",
      render: ({ sessionID }) => (
        <SidebarMetrics
          sessionID={sessionID}
          collector={collector}
          refreshIntervalMs={config.refreshIntervalMs}
          barConfig={config}
          theme={theme}
          controller={controller}
          requestRender={() => host.requestRender()}
        />
      ),
    })
    log("opencode-metrics O2 sidebar initialized")
    return () => {
      unregister()
      collector.dispose()
    }
  },
})
