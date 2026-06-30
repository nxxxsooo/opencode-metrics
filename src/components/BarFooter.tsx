/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import type { BarConfig, RequestMetrics } from "../types"
import type { TuiTheme } from "@opencode-ai/plugin/tui"
import { formatBar } from "../metrics"
import { createSignal, onCleanup } from "solid-js"

interface BarFooterProps {
  getMetrics: () => RequestMetrics | null
  refreshIntervalMs: number
  barConfig: BarConfig
  theme: TuiTheme
}

export function BarFooter(props: BarFooterProps) {
  const [display, setDisplay] = createSignal("")

  const tick = () => {
    const metrics = props.getMetrics()
    if (metrics && metrics.isStreaming) {
      setDisplay(formatBar(metrics, performance.now(), props.barConfig))
    } else if (metrics && metrics.isComplete) {
      if (!display()) {
        setDisplay(formatBar(metrics, metrics.completeTime ?? performance.now(), props.barConfig))
      }
    } else {
      setDisplay("")
    }
  }

  tick()
  const interval = setInterval(tick, props.refreshIntervalMs)
  onCleanup(() => clearInterval(interval))

  return (
    <text fg={props.theme.current.text}>{display()}</text>
  )
}
