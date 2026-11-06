/**
 * The Settings "Screen brightness" slider: OSRS keeps it as device option 6, on the client (no
 * varp, and no cache script reads the old `option_brightness` varp 166 any more).
 *
 * Cache script 3966 writes it as `clamp(0, 100, slider * 5)` and 3961 reads it back as `/ 5`, so
 * it is 0..100 in steps of 5. The renderer's brightness is OSRS's gamma exponent (colours are
 * `pow(rgb, gamma)`; the four classic levels were 0.9 darkest to 0.6 brightest), so the slider
 * maps 0..100 linearly onto that range. Kept in localStorage, like the interface scaling.
 */
export const DEVICE_OPTION_SCREEN_BRIGHTNESS = 6;
export const SCREEN_BRIGHTNESS_MAX = 100;
/** Start the Settings slider at its midpoint (gamma 0.75). */
export const DEFAULT_SCREEN_BRIGHTNESS = 50;

const DARKEST_GAMMA = 0.9;
const BRIGHTEST_GAMMA = 0.6;
const STORAGE_KEY = "osrs.screenBrightness";

export function normalizeScreenBrightness(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_SCREEN_BRIGHTNESS;
    return Math.max(0, Math.min(SCREEN_BRIGHTNESS_MAX, Math.round(value)));
}

/** The renderer's gamma for a device option 6 value: 0 is the darkest, 100 the brightest. */
export function gammaFromScreenBrightness(value: number): number {
    const fraction = normalizeScreenBrightness(value) / SCREEN_BRIGHTNESS_MAX;
    return DARKEST_GAMMA + (BRIGHTEST_GAMMA - DARKEST_GAMMA) * fraction;
}

export function loadScreenBrightness(): number {
    try {
        const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
        return raw == null ? DEFAULT_SCREEN_BRIGHTNESS : normalizeScreenBrightness(Number(raw));
    } catch {
        return DEFAULT_SCREEN_BRIGHTNESS;
    }
}

export function saveScreenBrightness(value: number): void {
    try {
        if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, String(normalizeScreenBrightness(value)));
    } catch {
        // Private mode or blocked storage: the setting lasts for this session only.
    }
}
