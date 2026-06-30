// tests/badge-contrast.test.ts
import { describe, test, expect } from "bun:test"
import { badgeTextColor, readableTextColorOn, type Color } from "../src/badge-contrast"

describe("readableTextColorOn", () => {
    test("dark background returns white", () => {
        expect(readableTextColorOn({ r: 0, g: 0, b: 0 })).toBe("#ffffff")
    })

    test("light background returns black", () => {
        expect(readableTextColorOn({ r: 1, g: 1, b: 1 })).toBe("#000000")
    })

    test("mid-tone dark returns white", () => {
        // A saturated blue (#0000FF) has luminance ~0.0722, below 0.5
        expect(readableTextColorOn({ r: 0, g: 0, b: 1 })).toBe("#ffffff")
    })

    test("pastel returns black", () => {
        // A light pastel (#F0E68C, khaki) has high luminance
        expect(readableTextColorOn({ r: 0.94, g: 0.9, b: 0.55 })).toBe("#000000")
    })
})

describe("badgeTextColor", () => {
    test("returns background when opaque and distinct from accent", () => {
        const accent: Color = { r: 0.2, g: 0.4, b: 0.8 }
        const background: Color = { r: 0.95, g: 0.95, b: 0.95, a: 1 }
        const result = badgeTextColor(accent, background)
        // Should return the background object reference
        expect(result).toBe(background)
    })

    test("returns fallback when background is transparent", () => {
        const accent: Color = { r: 0.2, g: 0.2, b: 0.2 }
        const background: Color = { r: 0, g: 0, b: 0, a: 0 }
        const result = badgeTextColor(accent, background)
        // Dark accent → white fallback
        expect(result).toBe("#ffffff")
    })

    test("returns fallback when background equals accent", () => {
        const accent: Color = { r: 0.5, g: 0.5, b: 0.5 }
        const background: Color = { r: 0.5, g: 0.5, b: 0.5, a: 1 }
        const result = badgeTextColor(accent, background)
        // Mid-gray luminance ~0.214 < 0.5 → white fallback
        expect(result).toBe("#ffffff")
    })

    test("returns fallback when background nearly equals accent", () => {
        const accent: Color = { r: 0.5, g: 0.5, b: 0.5 }
        const background: Color = { r: 0.52, g: 0.48, b: 0.51, a: 1 }
        const result = badgeTextColor(accent, background)
        // Within MIN_CHANNEL_DISTANCE (0.06) → fallback
        expect(typeof result).toBe("string")
    })

    test("returns background when alpha is exactly at threshold", () => {
        const accent: Color = { r: 0.1, g: 0.1, b: 0.1 }
        const background: Color = { r: 0.9, g: 0.9, b: 0.9, a: 0.5 }
        const result = badgeTextColor(accent, background)
        expect(result).toBe(background)
    })

    test("returns fallback when alpha is just below threshold", () => {
        const accent: Color = { r: 0.1, g: 0.1, b: 0.1 }
        const background: Color = { r: 0.9, g: 0.9, b: 0.9, a: 0.49 }
        const result = badgeTextColor(accent, background)
        expect(typeof result).toBe("string")
    })

    test("light accent gets black fallback", () => {
        const accent: Color = { r: 0.9, g: 0.85, b: 0.7 }
        const background: Color = { r: 0.9, g: 0.85, b: 0.7, a: 1 }
        const result = badgeTextColor(accent, background)
        expect(result).toBe("#000000")
    })

    test("dark accent gets white fallback", () => {
        const accent: Color = { r: 0.1, g: 0.05, b: 0.15 }
        const background: Color = { r: 0.1, g: 0.05, b: 0.15, a: 1 }
        const result = badgeTextColor(accent, background)
        expect(result).toBe("#ffffff")
    })

    test("missing alpha defaults to 1 (opaque)", () => {
        const accent: Color = { r: 0.2, g: 0.4, b: 0.8 }
        const background: Color = { r: 0.95, g: 0.95, b: 0.95 }
        const result = badgeTextColor(accent, background)
        expect(result).toBe(background)
    })
})
