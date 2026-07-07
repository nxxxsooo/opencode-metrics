// tests/tui-preferences.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
    resolveMetricsPrefs,
    computeEffectiveOrder,
    DEFAULT_PREFS,
    DEFAULT_SLOT_ORDER,
    PLUGIN_KEY,
} from "../src/tui-preferences"
import {
    getTuiPreferencesFile,
    readTuiPreferencesFileSync,
    queueTuiPreferenceUpdate,
} from "../src/tui-prefs-io"

const TUI_PREFS_FILE_ENV = "OPENCODE_TUI_PREFERENCES_FILE"

function tmpPrefsPath(label: string): string {
    return join(tmpdir(), `opencode-metrics-test-${label}-${process.pid}.jsonc`)
}

function setPrefsEnv(path: string): void {
    process.env[TUI_PREFS_FILE_ENV] = path
}

function clearPrefsEnv(): void {
    delete process.env[TUI_PREFS_FILE_ENV]
}

describe("getTuiPreferencesFile", () => {
    const origEnv = { ...process.env }

    afterEach(() => {
        process.env[TUI_PREFS_FILE_ENV] = origEnv[TUI_PREFS_FILE_ENV] ?? ""
        if (!(TUI_PREFS_FILE_ENV in origEnv)) delete process.env[TUI_PREFS_FILE_ENV]
        process.env.OPENCODE_CONFIG_DIR = origEnv.OPENCODE_CONFIG_DIR ?? ""
        if (!("OPENCODE_CONFIG_DIR" in origEnv)) delete process.env.OPENCODE_CONFIG_DIR
        process.env.XDG_CONFIG_HOME = origEnv.XDG_CONFIG_HOME ?? ""
        if (!("XDG_CONFIG_HOME" in origEnv)) delete process.env.XDG_CONFIG_HOME
    })

    test("env override wins", () => {
        setPrefsEnv("/custom/path/prefs.jsonc")
        expect(getTuiPreferencesFile()).toBe("/custom/path/prefs.jsonc")
    })

    test("OPENCODE_CONFIG_DIR fallback", () => {
        clearPrefsEnv()
        process.env.OPENCODE_CONFIG_DIR = "/my/config"
        expect(getTuiPreferencesFile()).toBe("/my/config/tui-preferences.jsonc")
    })

    test("XDG_CONFIG_HOME fallback", () => {
        clearPrefsEnv()
        delete process.env.OPENCODE_CONFIG_DIR
        process.env.XDG_CONFIG_HOME = "/xdg/home"
        expect(getTuiPreferencesFile()).toBe("/xdg/home/opencode/tui-preferences.jsonc")
    })
})

describe("readTuiPreferencesFileSync", () => {
    let tmpFile: string

    beforeEach(() => {
        tmpFile = tmpPrefsPath("read-sync")
        setPrefsEnv(tmpFile)
    })

    afterEach(() => {
        if (existsSync(tmpFile)) rmSync(tmpFile)
        clearPrefsEnv()
    })

    test("missing file returns empty object", () => {
        expect(readTuiPreferencesFileSync()).toEqual({})
    })

    test("empty file returns empty object", () => {
        mkdirSync(join(tmpdir(), ""), { recursive: true })
        writeFileSync(tmpFile, "", "utf8")
        expect(readTuiPreferencesFileSync()).toEqual({})
    })

    test("malformed JSON returns empty object", () => {
        writeFileSync(tmpFile, "{bad json", "utf8")
        expect(readTuiPreferencesFileSync()).toEqual({})
    })

    test("non-object root returns empty object", () => {
        writeFileSync(tmpFile, "[1, 2, 3]", "utf8")
        expect(readTuiPreferencesFileSync()).toEqual({})
    })

    test("parses valid JSONC with comments", () => {
        writeFileSync(tmpFile, '{\n// comment\n"opencode-metrics": {"order": 200}\n}', "utf8")
        const result = readTuiPreferencesFileSync()
        expect(result[PLUGIN_KEY]).toEqual({ order: 200 })
    })
})

describe("resolveMetricsPrefs", () => {
    test("empty root returns full defaults", () => {
        const resolved = resolveMetricsPrefs({})
        expect(resolved).toEqual(DEFAULT_PREFS)
        expect(resolved.scope).toBe("current")
    })

    test("scope accepts current or tree", () => {
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: { scope: "current" } }).scope).toBe("current")
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: { scope: "tree" } }).scope).toBe("tree")
    })

    test("bad scope falls back to current", () => {
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: { scope: "global" } }).scope).toBe("current")
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: { scope: false } }).scope).toBe("current")
    })

    test("non-object plugin key returns full defaults", () => {
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: "bad" })).toEqual(DEFAULT_PREFS)
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: 42 })).toEqual(DEFAULT_PREFS)
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: null })).toEqual(DEFAULT_PREFS)
    })

    test("partial section fills defaults", () => {
        const resolved = resolveMetricsPrefs({
            [PLUGIN_KEY]: { section: { enabled: false } },
        })
        expect(resolved.section.enabled).toBe(false)
        expect(resolved.section.collapsed).toBeNull()
        expect(resolved.section.rememberCollapsed).toBe(true)
        expect(resolved.section.label).toBe("Metrics")
    })

    test("partial rows fills defaults", () => {
        const resolved = resolveMetricsPrefs({
            [PLUGIN_KEY]: { rows: { speed: false } },
        })
        expect(resolved.rows.speed).toBe(false)
        expect(resolved.rows.ttft).toBe(true)
        expect(resolved.rows.session).toBe(true)
        expect(resolved.rows.model).toBe(true)
    })

    test("session row can be toggled off", () => {
        const resolved = resolveMetricsPrefs({
            [PLUGIN_KEY]: { rows: { session: false } },
        })
        expect(resolved.rows.session).toBe(false)
        expect(resolved.rows.elapsed).toBe(true)
    })

    test("bad types are clamped independently", () => {
        const resolved = resolveMetricsPrefs({
            [PLUGIN_KEY]: {
                forceToTop: "yes",
                order: "high",
                section: { enabled: 1, label: "" },
                rows: { speed: null, ttft: undefined },
            },
        })
        expect(resolved.forceToTop).toBe(false)
        expect(resolved.order).toBe(DEFAULT_SLOT_ORDER)
        expect(resolved.section.enabled).toBe(true)
        expect(resolved.section.label).toBe("Metrics")
        expect(resolved.rows.speed).toBe(true)
        expect(resolved.rows.ttft).toBe(true)
    })

    test("order is clamped to -10000..10000", () => {
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: { order: 99999 } }).order).toBe(10000)
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: { order: -99999 } }).order).toBe(-10000)
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: { order: 500 } }).order).toBe(500)
    })

    test("label is truncated to 24 chars", () => {
        const long = "A".repeat(50)
        const resolved = resolveMetricsPrefs({
            [PLUGIN_KEY]: { section: { label: long } },
        })
        expect(resolved.section.label.length).toBe(24)
    })

    test("collapsed accepts boolean or null", () => {
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: { section: { collapsed: true } } }).section.collapsed).toBe(true)
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: { section: { collapsed: false } } }).section.collapsed).toBe(false)
        expect(resolveMetricsPrefs({ [PLUGIN_KEY]: { section: { collapsed: "yes" } } }).section.collapsed).toBeNull()
    })
})

describe("computeEffectiveOrder", () => {
    test("missing key returns default", () => {
        expect(computeEffectiveOrder({}, PLUGIN_KEY, 160)).toBe(160)
    })

    test("non-object entry returns default", () => {
        expect(computeEffectiveOrder({ [PLUGIN_KEY]: "bad" }, PLUGIN_KEY, 160)).toBe(160)
    })

    test("normal order clamped", () => {
        expect(computeEffectiveOrder({ [PLUGIN_KEY]: { order: 300 } }, PLUGIN_KEY, 160)).toBe(300)
        expect(computeEffectiveOrder({ [PLUGIN_KEY]: { order: 99999 } }, PLUGIN_KEY, 160)).toBe(10000)
    })

    test("forceToTop returns -100000 + key index", () => {
        const root = { "other-plugin": {}, [PLUGIN_KEY]: { forceToTop: true } }
        const order = computeEffectiveOrder(root, PLUGIN_KEY, 160)
        // "other-plugin" is key 0, "opencode-metrics" is key 1
        expect(order).toBe(-100000 + 1)
    })

    test("forceToTop as first key gets -100000", () => {
        const root = { [PLUGIN_KEY]: { forceToTop: true }, "other-plugin": {} }
        const order = computeEffectiveOrder(root, PLUGIN_KEY, 160)
        expect(order).toBe(-100000 + 0)
    })

    test("forceToTop always beats manual order", () => {
        const forced = computeEffectiveOrder(
            { [PLUGIN_KEY]: { forceToTop: true } },
            PLUGIN_KEY,
            160,
        )
        const manual = computeEffectiveOrder(
            { "other": { order: 10000 } },
            "other",
            100,
        )
        expect(forced).toBeLessThan(manual)
    })

    test("non-boolean forceToTop is ignored", () => {
        expect(computeEffectiveOrder({ [PLUGIN_KEY]: { forceToTop: "yes" } }, PLUGIN_KEY, 160)).toBe(160)
    })
})

describe("queueTuiPreferenceUpdate", () => {
    let tmpFile: string

    beforeEach(() => {
        tmpFile = tmpPrefsPath("queue-write")
        setPrefsEnv(tmpFile)
    })

    afterEach(() => {
        if (existsSync(tmpFile)) rmSync(tmpFile)
        clearPrefsEnv()
    })

    test("creates file from template when missing", async () => {
        await queueTuiPreferenceUpdate(PLUGIN_KEY, ["section", "collapsed"], true)
        const content = readTuiPreferencesFileSync()
        const entry = content[PLUGIN_KEY] as Record<string, unknown>
        expect(entry).toBeDefined()
        const section = entry.section as Record<string, unknown>
        expect(section.collapsed).toBe(true)
    })

    test("preserves sibling plugin keys", async () => {
        writeFileSync(tmpFile, '{\n// magic-context config\n"magic-context": {\n"collapsed": false\n}\n}\n', "utf8")
        await queueTuiPreferenceUpdate(PLUGIN_KEY, ["order"], 200)
        const raw = require("node:fs").readFileSync(tmpFile, "utf8") as string
        expect(raw).toContain("magic-context")
        expect(raw).toContain("// magic-context config")
        const content = readTuiPreferencesFileSync()
        expect((content["magic-context"] as Record<string, unknown>).collapsed).toBe(false)
        expect((content[PLUGIN_KEY] as Record<string, unknown>).order).toBe(200)
    })

    test("serializes multiple writes", async () => {
        await queueTuiPreferenceUpdate(PLUGIN_KEY, ["order"], 300)
        await queueTuiPreferenceUpdate(PLUGIN_KEY, ["section", "collapsed"], true)
        await queueTuiPreferenceUpdate(PLUGIN_KEY, ["rows", "speed"], false)
        const content = readTuiPreferencesFileSync()
        const entry = content[PLUGIN_KEY] as Record<string, unknown>
        expect(entry.order).toBe(300)
        expect((entry.section as Record<string, unknown>).collapsed).toBe(true)
        expect((entry.rows as Record<string, unknown>).speed).toBe(false)
    })
})
