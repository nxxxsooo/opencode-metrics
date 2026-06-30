// src/config.ts
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { BarConfig } from "./types"
import { DEFAULT_CONFIG } from "./types"

function getConfigPaths(): string[] {
  return [
    join(homedir(), ".config", "opencode", "opencode-metrics.json"),
    join(homedir(), ".config", "opencode", "opencode-bar.json"),
    join(process.cwd(), ".opencode", "opencode-metrics.json"),
    join(process.cwd(), ".opencode", "opencode-bar.json"),
  ]
}

let cachedConfig: BarConfig | null = null

export function getConfig(): BarConfig {
  if (cachedConfig) return cachedConfig
  const merged = { ...DEFAULT_CONFIG }
  for (const path of getConfigPaths()) {
    if (!existsSync(path)) continue
    try {
      const raw = readFileSync(path, "utf-8")
      const parsed = JSON.parse(raw)
      if (typeof parsed.refreshIntervalMs === "number" && parsed.refreshIntervalMs >= 100) {
        merged.refreshIntervalMs = parsed.refreshIntervalMs
      }
      if (typeof parsed.holdDurationMs === "number" && (parsed.holdDurationMs === 0 || parsed.holdDurationMs >= 1000)) {
        merged.holdDurationMs = parsed.holdDurationMs
      }
      if (typeof parsed.estimationRatio === "number" && parsed.estimationRatio > 0) {
        merged.estimationRatio = parsed.estimationRatio
      }
      if (typeof parsed.enableLogging === "boolean") {
        merged.enableLogging = parsed.enableLogging
      }
      if (parsed.visible && typeof parsed.visible === "object") {
        for (const key of Object.keys(merged.visible)) {
          if (typeof (parsed.visible as Record<string, unknown>)[key] === "boolean") {
            (merged.visible as Record<string, unknown>)[key] = (parsed.visible as Record<string, unknown>)[key]
          }
        }
      }
    } catch (error) {
      if (process.env.OPENCODE_METRICS_DEBUG === "1") {
        console.warn(`opencode-metrics: failed to read config ${path}`, error)
      }
    }
  }
  cachedConfig = merged
  return merged
}

/** Reset cache (for testing) */
export function resetConfig(): void {
  cachedConfig = null
}
