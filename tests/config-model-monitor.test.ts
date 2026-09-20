import { describe, expect, test, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir, tmpdir } from "node:os"
import { getConfig, resetConfig } from "../src/config"

const originalCwd = process.cwd()

function withProjectConfig(contents: string): string {
  const root = mkdtempSync(join(tmpdir(), "opencode-metrics-config-"))
  mkdirSync(join(root, ".opencode"), { recursive: true })
  writeFileSync(join(root, ".opencode", "opencode-metrics.json"), contents)
  process.chdir(root)
  resetConfig()
  return root
}

afterEach(() => {
  process.chdir(originalCwd)
  resetConfig()
})

describe("modelMonitor file fallback", () => {
  test.skipIf(existsSync(join(homedir(), ".config", "opencode", "opencode-metrics.json")))(
    "defaults to disabled without a config file", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-metrics-config-"))
    process.chdir(root)
    resetConfig()
    expect(getConfig().modelMonitor).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  test("reads a boolean true from the project config file", () => {
    const root = withProjectConfig(JSON.stringify({ modelMonitor: true }))
    expect(getConfig().modelMonitor).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  test("ignores non-boolean values", () => {
    const root = withProjectConfig(JSON.stringify({ modelMonitor: "true" }))
    expect(getConfig().modelMonitor).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })
})
