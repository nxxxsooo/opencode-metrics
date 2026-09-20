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
import { resolveMetricsTheme } from "./theme-tokens"
import { ModelIdentityRpc } from "./model-identity-rpc"
import { modelIdentifier, type ModelIdentity } from "./model-identity"

export default Plugin.define({
  id: "opencode-metrics",
  setup(context) {
    const config = getConfig()
    const modelMonitor = context.options?.modelMonitor === true || config.modelMonitor === true
    const host = createOpenCodeV2Host(context, log)
    const collector = createCollector(host, config, log)
    const modelRpc = modelMonitor ? context.client.rpc(ModelIdentityRpc) : undefined
    const modelCutoffs = new Map<string, number>()
    const stopModelEvents = modelMonitor ? context.data.listen(({ details }) => {
      const event = details as unknown as { type: string; created?: number; data?: { sessionID?: string } }
      const sessionID = event.data?.sessionID
      if (!sessionID) return
      if (event.type === "session.execution.started" || event.type === "session.step.started") {
        modelCutoffs.delete(sessionID)
        // Use server event time, not local delivery time (events can arrive after HTTP starts).
        modelCutoffs.set(sessionID, typeof event.created === "number" && Number.isFinite(event.created) ? event.created : Date.now())
        if (modelCutoffs.size > 256) modelCutoffs.delete(modelCutoffs.keys().next().value!)
      }
      if (event.type === "session.deleted") modelCutoffs.delete(sessionID)
    }) : () => {}
    const fetchModelIdentity = async (sessionID: string): Promise<ModelIdentity | null> => {
      if (!modelRpc) return null
      const value = await modelRpc.get({ sessionID }, {
        location: context.data.session.get(sessionID)?.location ?? context.location ?? context.data.location.default(),
        signal: AbortSignal.timeout(5000),
      }) as ModelIdentity
      if (!value || typeof value.observedAt !== "number" || value.observedAt === 0) return null
      return {
        requested: modelIdentifier(value.requested),
        reported: modelIdentifier(value.reported),
        source: modelIdentifier(value.source),
        observedAt: value.observedAt,
        previous: value.previous === true || value.observedAt < (modelCutoffs.get(sessionID) ?? 0),
      }
    }
    const prefs = resolveMetricsPrefs(readTuiPreferencesFileSync())
    const controller = createMetricsSidebarController(prefs, () => host.requestRender())
    const theme: MetricsTheme = resolveMetricsTheme(context.theme)
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
          modelMonitor={modelMonitor}
          fetchModelIdentity={modelMonitor ? fetchModelIdentity : undefined}
          modelEpoch={() => modelCutoffs.get(sessionID) ?? 0}
        />
      ),
    })
    log("opencode-metrics O2 sidebar initialized")
    return () => {
      unregister()
      stopModelEvents()
      collector.dispose()
    }
  },
})
