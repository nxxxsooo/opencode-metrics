import { readFileSync, watch } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { parse, stringify } from "comment-json"

// Generic preferences file I/O for OpenCode TUI plugins.
// Plugin-specific types, defaults, and validation live in tui-preferences.ts.

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

export function isRecord(value: unknown): value is Record<string, unknown> {
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
