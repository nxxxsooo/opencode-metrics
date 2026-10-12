// tests/opentui-pin.test.ts
// Guards against the 0.9.2 regression class: `@opentui/core` and `@opentui/solid`
// resolved from a floating range at published-install time. OpenCode hosts share a
// global env-var registry between their embedded OpenTUI copy and the plugin's own
// copy in the same process; a drifted @opentui version registers `OPENTUI_FORCE_UNICODE`
// (and sibling vars) with a different description and the host rejects the plugin's
// TUI entry with "Environment variable "OPENTUI_FORCE_UNICODE" is already registered
// with different configuration".
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const OPENTUI_PINNED_VERSION = "0.5.10"

describe("published dependency pins", () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8"))

    test("@opentui/core is pinned to the host-matching version", () => {
        expect(pkg.devDependencies["@opentui/core"]).toBe(OPENTUI_PINNED_VERSION)
    })

    test("@opentui/solid is pinned to the same @opentui version", () => {
        expect(pkg.devDependencies["@opentui/solid"]).toBe(OPENTUI_PINNED_VERSION)
    })

    test("bun.lock resolves @opentui/core to the pinned version", () => {
        const lock = readFileSync(resolve(import.meta.dir, "../bun.lock"), "utf8")
        expect(lock).toContain(`@opentui/core@${OPENTUI_PINNED_VERSION}`)
        expect(lock).not.toMatch(/@opentui\/core@(?!0\.5\.10)/)
    })

    test("published tarball ships the lockfile", () => {
        expect(pkg.files).toContain("bun.lock")
    })
})
