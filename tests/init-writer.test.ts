// tests/init-writer.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parse } from "comment-json"
import { initPreferences } from "../src/scripts/init-tui-preferences"
import { PLUGIN_KEY, DEFAULT_PREFS } from "../src/tui-preferences"

function tmpPath(label: string): string {
    return join(tmpdir(), `opencode-metrics-init-test-${label}-${process.pid}.jsonc`)
}

describe("initPreferences", () => {
    let tmpFile: string

    beforeEach(() => {
        tmpFile = tmpPath("init")
    })

    afterEach(() => {
        if (existsSync(tmpFile)) rmSync(tmpFile)
        // Clean up any leftover temp files
        const pattern = `${tmpFile}.init.`
        // Best-effort cleanup
        try { rmSync(pattern + "*") } catch { /* ignore */ }
    })

    test("creates new file with defaults when missing", () => {
        const result = initPreferences(tmpFile)
        expect(result.ok).toBe(true)
        const content = parse(readFileSync(tmpFile, "utf8")) as Record<string, unknown>
        expect(content[PLUGIN_KEY]).toBeDefined()
        const entry = content[PLUGIN_KEY] as Record<string, unknown>
        expect(entry.order).toBe(DEFAULT_PREFS.order)
        expect(entry.forceToTop).toBe(false)
    })

    test("fills missing defaults into existing plugin entry", () => {
        writeFileSync(tmpFile, JSON.stringify({
            [PLUGIN_KEY]: { order: 200, rows: { speed: false } },
        }), "utf8")

        const result = initPreferences(tmpFile)
        expect(result.ok).toBe(true)

        const content = parse(readFileSync(tmpFile, "utf8")) as Record<string, unknown>
        const entry = content[PLUGIN_KEY] as Record<string, unknown>
        // User value preserved
        expect(entry.order).toBe(200)
        expect((entry.rows as Record<string, unknown>).speed).toBe(false)
        // Missing defaults filled
        expect(entry.forceToTop).toBe(false)
        expect((entry.rows as Record<string, unknown>).ttft).toBe(true)
        expect((entry.rows as Record<string, unknown>).model).toBe(true)
    })

    test("preserves sibling plugin keys", () => {
        writeFileSync(tmpFile, JSON.stringify({
            "magic-context": { collapsed: true, order: 170 },
        }), "utf8")

        const result = initPreferences(tmpFile)
        expect(result.ok).toBe(true)

        const content = parse(readFileSync(tmpFile, "utf8")) as Record<string, unknown>
        expect(content["magic-context"]).toBeDefined()
        expect((content["magic-context"] as Record<string, unknown>).collapsed).toBe(true)
        expect(content[PLUGIN_KEY]).toBeDefined()
    })

    test("preserves comments in existing file", () => {
        writeFileSync(tmpFile, '{\n// My config\n"magic-context": {}\n}\n', "utf8")

        const result = initPreferences(tmpFile)
        expect(result.ok).toBe(true)

        const raw = readFileSync(tmpFile, "utf8")
        expect(raw).toContain("// My config")
        expect(raw).toContain("magic-context")
    })

    test("fails safely on malformed JSON", () => {
        writeFileSync(tmpFile, "{bad json!!", "utf8")
        const result = initPreferences(tmpFile)
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("malformed")
        // Original file untouched
        expect(readFileSync(tmpFile, "utf8")).toBe("{bad json!!")
    })

    test("fails safely when plugin key is non-object", () => {
        writeFileSync(tmpFile, JSON.stringify({ [PLUGIN_KEY]: "not-an-object" }), "utf8")
        const result = initPreferences(tmpFile)
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("not an object")
        // Original file untouched
        const content = JSON.parse(readFileSync(tmpFile, "utf8"))
        expect(content[PLUGIN_KEY]).toBe("not-an-object")
    })

    test("fails safely when root is an array", () => {
        writeFileSync(tmpFile, "[1, 2, 3]", "utf8")
        const result = initPreferences(tmpFile)
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("not an object")
    })

    test("creates parent directories if needed", () => {
        const deep = join(tmpdir(), `opencode-metrics-deep-${process.pid}`, "sub", "prefs.jsonc")
        const result = initPreferences(deep)
        expect(result.ok).toBe(true)
        expect(existsSync(deep)).toBe(true)
        // Cleanup
        rmSync(join(tmpdir(), `opencode-metrics-deep-${process.pid}`), { recursive: true })
    })

    test("does not overwrite existing user values in nested objects", () => {
        writeFileSync(tmpFile, JSON.stringify({
            [PLUGIN_KEY]: {
                section: { label: "My Metrics", enabled: false },
                rows: { speed: false, cache: false },
            },
        }), "utf8")

        const result = initPreferences(tmpFile)
        expect(result.ok).toBe(true)

        const content = parse(readFileSync(tmpFile, "utf8")) as Record<string, unknown>
        const entry = content[PLUGIN_KEY] as Record<string, unknown>
        const section = entry.section as Record<string, unknown>
        const rows = entry.rows as Record<string, unknown>

        // User values preserved
        expect(section.label).toBe("My Metrics")
        expect(section.enabled).toBe(false)
        expect(rows.speed).toBe(false)
        expect(rows.cache).toBe(false)

        // Missing nested defaults filled
        expect(section.rememberCollapsed).toBe(true)
        expect(section.collapsed).toBeNull()
        expect(rows.ttft).toBe(true)
        expect(rows.model).toBe(true)
    })
})
