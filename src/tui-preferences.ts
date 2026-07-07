import { createSignal } from "solid-js"
import type { MetricsScope } from "./types"
import {
    isRecord,
    readTuiPreferencesFile,
    queueTuiPreferenceUpdate,
    watchTuiPreferences,
} from "./tui-prefs-io"

// Plugin-specific types, defaults, validation, resolution, order computation,
// and controller. Generic preferences file I/O lives in tui-prefs-io.ts.

export const PLUGIN_KEY = "opencode-metrics"
export const DEFAULT_SLOT_ORDER = 160

export interface MetricsTuiPrefs {
    forceToTop: boolean
    order: number
    scope: MetricsScope
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
    scope: "current",
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

function metricsScope(value: unknown, fallback: MetricsScope): MetricsScope {
    return value === "current" || value === "tree" ? value : fallback
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
        scope: metricsScope(entry.scope, d.scope),
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
