/**
 * Pick the text color for the sidebar header badge (a bold label drawn on a
 * `theme.accent` background).
 *
 * Primary rule: paint the theme's own `background` color as the label, giving
 * the inverse-of-panel look consistent with other sidebar plugins.
 *
 * Fallback rule: `theme.background` can be unusable as a label color when:
 *   1. Transparent background (alpha < 0.5). Drawing transparent text on the
 *      accent renders the label invisible.
 *   2. Background ~= accent (per-channel distance < 0.06). No contrast.
 * In either case we fall back to a black/white pick by accent luminance.
 *
 * Accepts the minimal `{ r, g, b, a? }` shape so this stays a pure, trivially
 * testable function independent of the native color class.
 */

export type Color = { r: number; g: number; b: number; a?: number }

const MIN_OPAQUE_ALPHA = 0.5
const MIN_CHANNEL_DISTANCE = 0.06
const LIGHT_ACCENT_LUMINANCE = 0.5

function srgbChannelToLinear(c: number): number {
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(bg: Color): number {
    return (
        0.2126 * srgbChannelToLinear(bg.r) +
        0.7152 * srgbChannelToLinear(bg.g) +
        0.0722 * srgbChannelToLinear(bg.b)
    )
}

function nearlyEqual(a: Color, b: Color): boolean {
    return (
        Math.abs(a.r - b.r) < MIN_CHANNEL_DISTANCE &&
        Math.abs(a.g - b.g) < MIN_CHANNEL_DISTANCE &&
        Math.abs(a.b - b.b) < MIN_CHANNEL_DISTANCE
    )
}

/**
 * Pure black/white pick by accent luminance. Used as the badge fallback.
 */
export function readableTextColorOn(bg: Color): string {
    return relativeLuminance(bg) < LIGHT_ACCENT_LUMINANCE ? "#ffffff" : "#000000"
}

/**
 * Badge label color on the accent: the theme background when it is usable,
 * else a guaranteed-visible black/white fallback. Returns the passed-in
 * `background` reference unchanged on the primary path.
 */
export function badgeTextColor<T extends Color>(accent: T, background: T): T | string {
    const alpha = background.a ?? 1
    if (alpha >= MIN_OPAQUE_ALPHA && !nearlyEqual(accent, background)) {
        return background
    }
    return readableTextColorOn(accent)
}
