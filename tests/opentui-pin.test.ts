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

const OPENTUI_PINNED_VERSION = "0.9.9"
const OPENTUI_HOST_PEERS = "0.9.4 || 0.9.9"

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
        for (const name of ["core", "solid"]) {
            const versions = Array.from(lock.matchAll(new RegExp(`@opentui/${name}@([^"\\s]+)`, "g")), (match) => match[1])
            expect([...new Set(versions)]).toEqual([OPENTUI_PINNED_VERSION])
        }
    })

    test("published peers only allow OpenTUI versions shipped by the targeted hosts", () => {
        expect(pkg.peerDependencies["@opentui/core"]).toBe(OPENTUI_HOST_PEERS)
        expect(pkg.peerDependencies["@opentui/solid"]).toBe(OPENTUI_HOST_PEERS)
    })
})
