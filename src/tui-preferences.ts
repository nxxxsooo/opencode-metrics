import { readFileSync, watch } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { parse, stringify } from "comment-json"
import { createSignal } from "solid-js"

// Shared preferences file for OpenCode TUI plugins. One top-level key per
// plugin (short, non-integer-like name). The file is OPTIONAL: every reader
// falls back to defaults when it is missing or malformed.
//
// Cross-plugin convention (anthropic-auth / magic-context / opencode-metrics):
//   - same file name + env override + lookup order,
//   - byte-identical `computeEffectiveOrder` so plugins sort consistently,
//   - a coordinated default-order ladder (anthropic-auth 160, MC 170, AFT 180).
//
// Uses `comment-json` for the WRITE path — a full parse → mutate-one-key →
// stringify round-trip that preserves comments and sibling plugins' keys.

export const TUI_PREFS_FILE_ENV = "OPENCODE_TUI_PREFERENCES_FILE"
const FILE_NAME = "tui-preferences.jsonc"

export function getTuiPreferencesFile(): string {
    const override = process.env[TUI_PREFS_FILE_ENV]
    if (override) return override
    const configDir =
        process.env.OPENCODE_CONFIG_DIR ||
        join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
    return join(configDir, FILE_NAME)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Tolerant read: a missing file, parse error, or non-object root all resolve
// to {} so the sidebar never crashes on hand-edited content. Never throws.
export async function readTuiPreferencesFile(): Promise<Record<string, unknown>> {
    try {
        const raw = await readFile(getTuiPreferencesFile(), "utf8")
        if (raw.trim() === "") return {}
        const root: unknown = parse(raw)
        return isRecord(root) ? (root as Record<string, unknown>) : {}
    } catch {
        return {}
    }
}

// Synchronous tolerant read — used once at slot mount to seed the initial
// collapse state and effective order WITHOUT a frame of async flicker.
export function readTuiPreferencesFileSync(): Record<string, unknown> {
    try {
        const raw = readFileSync(getTuiPreferencesFile(), "utf8")
        if (raw.trim() === "") return {}
        const root: unknown = parse(raw)
        return isRecord(root) ? (root as Record<string, unknown>) : {}
    } catch {
        return {}
    }
}

export const PLUGIN_KEY = "opencode-metrics"
export const DEFAULT_SLOT_ORDER = 160

export interface MetricsTuiPrefs {
    forceToTop: boolean
    order: number
    section: {
        enabled: boolean
        collapsed: boolean | null
        rememberCollapsed: boolean
        label: string
    }
    rows: {
        speed: boolean
        ttft: boolean
        input: boolean
        output: boolean
        cache: boolean
        elapsed: boolean
        session: boolean
        model: boolean
    }
}

export const DEFAULT_PREFS: MetricsTuiPrefs = {
    forceToTop: false,
    order: DEFAULT_SLOT_ORDER,
    section: {
        enabled: true,
        collapsed: null,
        rememberCollapsed: true,
        label: "Metrics",
    },
    rows: {
        speed: true,
        ttft: true,
        input: true,
        output: true,
        cache: true,
        elapsed: true,
        session: true,
        model: true,
    },
}

function bool(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback
}

function int(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback
    return Math.min(Math.max(Math.round(value), min), max)
}

function label(value: unknown, fallback: string, maxLength: number): string {
    if (typeof value !== "string" || value.length === 0) return fallback
    return value.slice(0, maxLength)
}

// Per-key validation: every value is independently clamped/defaulted so one
// bad entry never poisons the rest. Never throws. A missing/non-object
// opencode-metrics key → full defaults clone.
export function resolveMetricsPrefs(root: Record<string, unknown>): MetricsTuiPrefs {
    const entry = root[PLUGIN_KEY]
    if (!isRecord(entry)) return structuredClone(DEFAULT_PREFS)

    const d = DEFAULT_PREFS
    const section = isRecord(entry.section) ? entry.section : {}
    const rows = isRecord(entry.rows) ? entry.rows : {}

    return {
        forceToTop: bool(entry.forceToTop, d.forceToTop),
        order: int(entry.order, d.order, -10000, 10000),
        section: {
            enabled: bool(section.enabled, d.section.enabled),
            collapsed: typeof section.collapsed === "boolean" ? section.collapsed : null,
            rememberCollapsed: bool(section.rememberCollapsed, d.section.rememberCollapsed),
            label: label(section.label, d.section.label, 24),
        },
        rows: {
            speed: bool(rows.speed, d.rows.speed),
            ttft: bool(rows.ttft, d.rows.ttft),
            input: bool(rows.input, d.rows.input),
            output: bool(rows.output, d.rows.output),
            cache: bool(rows.cache, d.rows.cache),
            elapsed: bool(rows.elapsed, d.rows.elapsed),
            session: bool(rows.session, d.rows.session),
            model: bool(rows.model, d.rows.model),
        },
    }
}

const FORCE_TOP_BASE = -100000

// Shared forceToTop convention — MUST stay byte-identical across plugins or
// they sort inconsistently against each other. Forced plugins sort below
// FORCE_TOP_BASE, ordered among themselves by their top-level key's position
// in the file. The user-facing `order` knob clamps to -10000..10000, strictly
// above the forced band.
export function computeEffectiveOrder(
    root: Record<string, unknown>,
    pluginKey: string,
    defaultOrder: number,
): number {
    const entry = root[pluginKey]
    if (!isRecord(entry)) return defaultOrder
    if (entry.forceToTop === true) {
        return FORCE_TOP_BASE + Object.keys(root).indexOf(pluginKey)
    }
    return int(entry.order, defaultOrder, -10000, 10000)
}

const TEMPLATE = `// Shared preferences for OpenCode TUI plugins.
// One top-level key per plugin (short name). See each plugin's README for its
// supported settings. This file is safe to hand-edit; plugins update individual
// keys and preserve the rest (values and comments).
{}
`

type JsonValue = string | number | boolean | null

function setDeep(root: Record<string, unknown>, path: string[], value: JsonValue): boolean {
    let node: Record<string, unknown> = root
    for (let i = 0; i < path.length - 1; i += 1) {
        const key = path[i]
        const child = node[key]
        if (child === undefined || child === null) {
            node[key] = {}
        } else if (!isRecord(child)) {
            return false
        }
        node = node[key] as Record<string, unknown>
    }
    node[path[path.length - 1]] = value
    return true
}

async function writePreference(pluginKey: string, path: string[], value: JsonValue): Promise<void> {
    const file = getTuiPreferencesFile()
    await mkdir(dirname(file), { recursive: true })
    let text: string
    try {
        text = await readFile(file, "utf8")
    } catch {
        text = ""
    }
    if (text.trim() === "") text = TEMPLATE

    let root: unknown
    try {
        root = parse(text)
    } catch {
        return
    }
    if (!isRecord(root)) root = {}
    if (!setDeep(root as Record<string, unknown>, [pluginKey, ...path], value)) {
        return
    }

    const next = `${stringify(root, null, 2)}\n`
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, next, "utf8")
    await rename(tmp, file)
}

let writeChain: Promise<void> = Promise.resolve()

// Writes are serialized on a promise chain: each update re-reads the file,
// applies a comment-preserving edit to one property, and replaces the file
// atomically (temp + rename in the same directory).
export function queueTuiPreferenceUpdate(
    pluginKey: string,
    path: string[],
    value: JsonValue,
): Promise<void> {
    writeChain = writeChain.then(() => writePreference(pluginKey, path, value)).catch(() => {})
    return writeChain
}

const WATCH_DEBOUNCE_MS = 150

// Watches the DIRECTORY, not the file: editors and our own atomic writes
// replace the file via rename, which kills file-level watchers.
export function watchTuiPreferences(onChange: () => void): () => void {
    const file = getTuiPreferencesFile()
    const name = basename(file)
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastSeen: string | null = null
    void readFile(file, "utf8")
        .then((text) => {
            if (lastSeen === null) lastSeen = text
        })
        .catch(() => {})
    try {
        const watcher = watch(dirname(file), (_event, filename) => {
            const isOurs =
                filename === name ||
                (filename?.startsWith(`${name}.`) && filename.endsWith(".tmp"))
            if (filename != null && !isOurs) return
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
                timer = null
                void readFile(file, "utf8")
                    .catch(() => null)
                    .then((text) => {
                        if (text === null) return
                        if (text === lastSeen) return
                        lastSeen = text
                        onChange()
                    })
            }, WATCH_DEBOUNCE_MS)
        })
        return () => {
            if (timer) clearTimeout(timer)
            watcher.close()
        }
    } catch {
        return () => {}
    }
}

// ── Controller ──

export interface MetricsSidebarController {
    prefs: () => MetricsTuiPrefs
    collapsed: () => boolean
    toggleCollapsed: () => void
    subscribe: (cb: () => void) => () => void
}

export function createMetricsSidebarController(
    initialPrefs: MetricsTuiPrefs,
    requestRender?: () => void,
): MetricsSidebarController {
    const [prefs, setPrefs] = createSignal<MetricsTuiPrefs>(initialPrefs)
    const seedCollapsed =
        initialPrefs.section.rememberCollapsed && initialPrefs.section.collapsed != null
            ? initialPrefs.section.collapsed
            : false
    const [collapsed, setCollapsed] = createSignal(seedCollapsed)
    let lastPersistedCollapsed: boolean | null = initialPrefs.section.collapsed
    let lastApplied = JSON.stringify(initialPrefs)

    const listeners = new Set<() => void>()
    const notify = (): void => {
        requestRender?.()
        for (const cb of listeners) cb()
    }

    const disposeWatcher = watchTuiPreferences(() => {
        void (async () => {
            const next = resolveMetricsPrefs(await readTuiPreferencesFile())
            const serialized = JSON.stringify(next)
            if (serialized === lastApplied) return
            lastApplied = serialized
            setPrefs(next)
            if (
                next.section.rememberCollapsed &&
                next.section.collapsed != null &&
                next.section.collapsed !== lastPersistedCollapsed
            ) {
                lastPersistedCollapsed = next.section.collapsed
                setCollapsed(next.section.collapsed)
            }
            notify()
        })()
    })

    // Intentionally not calling disposeWatcher here — the watcher lives for
    // the plugin/process lifetime, matching Magic Context's convention.
    void disposeWatcher

    function toggleCollapsed() {
        const next = !collapsed()
        setCollapsed(next)
        notify()
        if (prefs().section.rememberCollapsed) {
            void queueTuiPreferenceUpdate(PLUGIN_KEY, ["section", "collapsed"], next).then(() => {
                lastPersistedCollapsed = next
            })
        }
    }

    function subscribe(cb: () => void): () => void {
        listeners.add(cb)
        return () => listeners.delete(cb)
    }

    return { prefs, collapsed, toggleCollapsed, subscribe }
}
