// src/logger.ts
import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { getConfig } from "./config"

let logFile: string | null = null

function getLogDir(): string {
  if (process.platform === "win32") {
      return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "opentui", "opencode-metrics", "logs")
  }
  // macOS & Linux: XDG_DATA_HOME or ~/.local/share
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
    return join(dataHome, "opentui", "opencode-metrics", "logs")
}

function getLogFile(): string {
  if (logFile) return logFile
  const dir = getLogDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  logFile = join(dir, "opencode-metrics.log")
  return logFile
}

export function log(msg: string): void {
  const config = getConfig()
  if (!config.enableLogging) return
  try {
    appendFileSync(getLogFile(), `[${new Date().toISOString()}] ${msg}\n`)
  } catch (error) {
    if (process.env.OPENCODE_METRICS_DEBUG === "1") {
      console.warn("opencode-metrics: failed to write log", error)
    }
  }
}