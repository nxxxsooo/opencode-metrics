// src/theme-tokens.ts
import { RGBA } from "@opentui/core"
import type { MetricsTheme } from "./types"

/**
 * Host theme tokens were renamed between the plugin beta and OpenCode 2.0:
 * `text.default` → `text.base`, `text.subdued` → `text.muted`,
 * `text.feedback.*.default` → `text.feedback.*.base`, and `text.status` was removed.
 * Read both shapes so one build keeps rendering on either host instead of
 * throwing during setup and disabling the whole sidebar plugin.
 */

const child = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined

// The host constructs colors with its own @opentui/core instance, so `instanceof` is unreliable.
const color = (root: unknown, ...keys: string[]): RGBA | undefined => {
  let current: unknown = root
  for (const key of keys) current = child(current, key)
  if (typeof current !== "object" || current === null) return undefined
  const candidate = current as { r?: unknown; g?: unknown; b?: unknown }
  if (typeof candidate.r !== "number" || typeof candidate.g !== "number" || typeof candidate.b !== "number") return undefined
  return current as RGBA
}

export function resolveMetricsTheme(theme: unknown): MetricsTheme {
  const text = child(theme, "text")
  const base = color(text, "base") ?? color(text, "default") ?? RGBA.defaultForeground()
  return {
    text: base,
    textMuted: color(text, "muted") ?? color(text, "subdued") ?? base,
    accent: color(text, "status", "running") ?? color(text, "action", "primary", "base") ?? base,
    warning: color(text, "feedback", "warning", "base") ?? color(text, "feedback", "warning", "default") ?? base,
    success: color(text, "feedback", "success", "base") ?? color(text, "feedback", "success", "default") ?? base,
  }
}
