// src/config.ts
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { BarConfig } from "./types"
import { DEFAULT_CONFIG } from "./types"

// Match POSIX homedir semantics: an explicit HOME wins, so container and test
// environments can relocate the config without rewriting the user's home.
function homeDirectory(): string {
  const envHome = process.env.HOME
  return typeof envHome === "string" && envHome.length > 0 && !envHome.includes("\0") ? envHome : homedir()
}

function getConfigPaths(): string[] {
  return [
    join(homeDirectory(), ".config", "opencode", "opencode-metrics.json"),
    join(homeDirectory(), ".config", "opencode", "opencode-bar.json"),
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
      // OpenCode does not forward plugin options to the TUI role, so the
      // sidebar can never see `options.modelMonitor`. This file is read by
      // both roles and keeps the opt-in reachable; the option still wins.
      if (typeof parsed.modelMonitor === "boolean") {
        merged.modelMonitor = parsed.modelMonitor
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
