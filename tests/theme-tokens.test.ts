// tests/theme-tokens.test.ts
import { describe, test, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import { resolveMetricsTheme } from "../src/theme-tokens"

const rgb = (r: number, g: number, b: number) => RGBA.fromInts(r, g, b, 255)

const betaTheme = {
  text: {
    default: rgb(1, 1, 1),
    subdued: rgb(2, 2, 2),
    status: { running: rgb(3, 3, 3) },
    action: { primary: { base: rgb(9, 9, 9) } },
    feedback: {
      warning: { default: rgb(4, 4, 4) },
      success: { default: rgb(5, 5, 5) },
    },
  },
}

const currentTheme = {
  text: {
    base: rgb(10, 10, 10),
    muted: rgb(20, 20, 20),
    action: { primary: { base: rgb(30, 30, 30) } },
    feedback: {
      warning: { base: rgb(40, 40, 40) },
      success: { base: rgb(50, 50, 50) },
    },
  },
}

describe("resolveMetricsTheme", () => {
  test("reads beta token names", () => {
    const theme = resolveMetricsTheme(betaTheme)
    expect(theme.text.r).toBeCloseTo(betaTheme.text.default.r)
    expect(theme.textMuted.r).toBeCloseTo(betaTheme.text.subdued.r)
    expect(theme.accent.r).toBeCloseTo(betaTheme.text.status.running.r)
    expect(theme.warning.r).toBeCloseTo(betaTheme.text.feedback.warning.default.r)
    expect(theme.success.r).toBeCloseTo(betaTheme.text.feedback.success.default.r)
  })

  test("reads 2.0 token names without status", () => {
    const theme = resolveMetricsTheme(currentTheme)
    expect(theme.text.r).toBeCloseTo(currentTheme.text.base.r)
    expect(theme.textMuted.r).toBeCloseTo(currentTheme.text.muted.r)
    expect(theme.accent.r).toBeCloseTo(currentTheme.text.action.primary.base.r)
    expect(theme.warning.r).toBeCloseTo(currentTheme.text.feedback.warning.base.r)
    expect(theme.success.r).toBeCloseTo(currentTheme.text.feedback.success.base.r)
  })

  test("falls back instead of throwing on an unknown theme shape", () => {
    const theme = resolveMetricsTheme({ text: { base: rgb(7, 7, 7) } })
    expect(theme.accent.r).toBeCloseTo(theme.text.r)
    expect(theme.warning.r).toBeCloseTo(theme.text.r)
    expect(theme.success.r).toBeCloseTo(theme.text.r)
  })

  test("survives a missing theme entirely", () => {
    expect(() => resolveMetricsTheme(undefined)).not.toThrow()
    expect(() => resolveMetricsTheme({})).not.toThrow()
  })
})
