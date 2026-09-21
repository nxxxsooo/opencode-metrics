import { describe, expect, test, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { getConfig, resetConfig } from "../src/config"

const originalCwd = process.cwd()
const originalHome = process.env.HOME

// Isolate the HOME-based config paths so developer machines with a live
// ~/.config/opencode/opencode-metrics.json cannot contaminate assertions.
function isolateHome(): string {
  const root = mkdtempSync(join(tmpdir(), "opencode-metrics-home-"))
  process.env.HOME = root
  resetConfig()
  return root
}

function withProjectConfig(contents: string): string {
  const root = isolateHome()
  mkdirSync(join(root, ".opencode"), { recursive: true })
  writeFileSync(join(root, ".opencode", "opencode-metrics.json"), contents)
  process.chdir(root)
  resetConfig()
  return root
}

afterEach(() => {
  process.chdir(originalCwd)
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  resetConfig()
})

describe("modelMonitor file fallback", () => {
  test("defaults to disabled without a config file", () => {
    const root = isolateHome()
    process.chdir(root)
    resetConfig()
    expect(getConfig().modelMonitor).toBe(false)
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
