#!/usr/bin/env node
/**
 * Init/default writer for opencode-metrics TUI preferences.
 *
 * Inserts missing `opencode-metrics` defaults into the target prefs file
 * (default: ~/.config/opencode/tui-preferences.jsonc). If `opencode-metrics`
 * already exists, fills only missing nested defaults and preserves user values.
 *
 * If the file is malformed or `opencode-metrics` is a non-object, fails safely
 * without overwriting. Uses same-directory temp file + rename for atomic write.
 *
 * Override the target with OPENCODE_TUI_PREFERENCES_FILE env var.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs"
import { dirname } from "node:path"
import { parse, stringify } from "comment-json"
import {
    DEFAULT_PREFS,
    PLUGIN_KEY,
} from "../tui-preferences"
import { getTuiPreferencesFile } from "../tui-prefs-io"

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function deepFillDefaults(target: Record<string, unknown>, defaults: Record<string, unknown>): void {
    for (const key of Object.keys(defaults)) {
        if (!(key in target)) {
            target[key] = structuredClone(defaults[key])
        } else if (isRecord(defaults[key]) && isRecord(target[key])) {
            deepFillDefaults(target[key] as Record<string, unknown>, defaults[key] as Record<string, unknown>)
        }
    }
}

export interface InitResult {
    ok: boolean
    file: string
    reason?: string
}

export function initPreferences(fileOverride?: string): InitResult {
    const file = fileOverride ?? getTuiPreferencesFile()

    let text = ""
    if (existsSync(file)) {
        try {
            text = readFileSync(file, "utf8")
        } catch {
            return { ok: false, file, reason: "cannot read file" }
        }
    }

    let root: unknown = {}
    if (text.trim() !== "") {
        try {
            root = parse(text)
        } catch {
            return { ok: false, file, reason: "malformed JSON/JSONC — not overwriting" }
        }
    }
    if (!isRecord(root)) {
        return { ok: false, file, reason: "root is not an object — not overwriting" }
    }

    const existing = root[PLUGIN_KEY]
    if (existing !== undefined && !isRecord(existing)) {
        return { ok: false, file, reason: `${PLUGIN_KEY} is not an object — not overwriting` }
    }

    if (!isRecord(root[PLUGIN_KEY])) {
        root[PLUGIN_KEY] = structuredClone(DEFAULT_PREFS)
    } else {
        deepFillDefaults(root[PLUGIN_KEY] as Record<string, unknown>, DEFAULT_PREFS as unknown as Record<string, unknown>)
    }

    const output = `${stringify(root, null, 2)}\n`
    const tmp = `${file}.init.${process.pid}.tmp`

    try {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(tmp, output, "utf8")
        renameSync(tmp, file)
    } catch (err) {
        return { ok: false, file, reason: String(err) }
    }

    return { ok: true, file }
}

// CLI entry — runs only when executed directly, not when imported for tests.
const isDirectRun =
    typeof process !== "undefined" &&
    process.argv[1] != null &&
    (process.argv[1].endsWith("init-tui-preferences.ts") ||
        process.argv[1].endsWith("init-tui-preferences.js"))

if (isDirectRun) {
    const result = initPreferences()
    if (result.ok) {
        console.log(`opencode-metrics: defaults written to ${result.file}`)
    } else {
        console.error(`opencode-metrics: ${result.reason} (${result.file})`)
        process.exit(1)
    }
}
