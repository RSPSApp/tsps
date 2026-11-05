const SCALE_STORAGE_KEY = "osrs.runeliteUiScale";

export const RUNELITE_DEFAULT_RESIZABLE_SCALING_PERCENT = 50;
export const RUNELITE_DEFAULT_UI_SCALE = 1;
export const RUNELITE_MIN_UI_SCALE = 1;
export const RUNELITE_MAX_UI_SCALE = 5;
export const OSRS_INTERFACE_SCALING_DEFAULT_PERCENT = 100;
export const OSRS_INTERFACE_SCALING_MIN_DESKTOP_PERCENT = 100;
export const OSRS_INTERFACE_SCALING_MIN_MOBILE_PERCENT = 175;
export const OSRS_INTERFACE_SCALING_MAX_PERCENT = 400;

let manualScaleOverride: number | null = null;
let overrideLoaded = false;

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function normalizeUiScale(scale: number): number {
    return clamp(scale, RUNELITE_MIN_UI_SCALE, RUNELITE_MAX_UI_SCALE);
}

function loadOverride(): number | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(SCALE_STORAGE_KEY);
        if (raw === null) return null;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return null;
        return normalizeUiScale(parsed);
    } catch {
        return null;
    }
}

function ensureOverrideLoaded(): void {
    if (overrideLoaded) return;
    overrideLoaded = true;
    manualScaleOverride = loadOverride();
}

/**
 * RuneLite's stretched mode "Resizable scaling" reduces the logical game size
 * before stretching it back to the window. The injected client stores this as
 * scalingFactor = 1 + percent / 100, so 50% stretches the UI to 1.5x.
 */
export function scaleFromRuneliteResizableScalingPercent(percent: number): number {
    const maxPercent = (RUNELITE_MAX_UI_SCALE - 1) * 100;
    return normalizeUiScale(1 + clamp(percent, 0, maxPercent) / 100);
}

export function runeliteResizableScalingPercentFromScale(scale: number): number {
    const normalized = normalizeUiScale(scale);
    return clamp((normalized - 1) * 100, 0, (RUNELITE_MAX_UI_SCALE - 1) * 100);
}

export function getRuneliteDefaultStretchedUiScale(): number {
    return scaleFromRuneliteResizableScalingPercent(RUNELITE_DEFAULT_RESIZABLE_SCALING_PERCENT);
}

export function normalizeOsrsInterfaceScalingPercent(
    percent: number,
    minPercent: number = OSRS_INTERFACE_SCALING_MIN_DESKTOP_PERCENT,
): number {
    return Math.round(clamp(percent, minPercent, OSRS_INTERFACE_SCALING_MAX_PERCENT));
}

export function scaleFromOsrsInterfaceScalingPercent(percent: number): number {
    return normalizeUiScale(
        normalizeOsrsInterfaceScalingPercent(percent) / OSRS_INTERFACE_SCALING_DEFAULT_PERCENT,
    );
}

export function osrsInterfaceScalingPercentFromScale(scale: number): number {
    const normalized = normalizeUiScale(scale);
    return normalizeOsrsInterfaceScalingPercent(
        normalized * OSRS_INTERFACE_SCALING_DEFAULT_PERCENT,
    );
}

export function getOsrsInterfaceScalingPercent(mobile = false): number {
    // Native mobile login replaces values below its minimum with 400%; keep that out of saved preferences.
    return normalizeOsrsInterfaceScalingPercent(osrsInterfaceScalingPercentFromScale(getUiScale()),
        mobile ? OSRS_INTERFACE_SCALING_MIN_MOBILE_PERCENT : OSRS_INTERFACE_SCALING_MIN_DESKTOP_PERCENT);
}

export function getDefaultUiScale(): number {
    return RUNELITE_DEFAULT_UI_SCALE;
}

/**
 * Compatibility name for older diagnostics. This is no longer viewport-auto:
 * RuneLite defaults to unstretched 1x unless stretched mode is explicitly enabled.
 */
export function computeAutoScale(_cssW: number, _cssH: number): number {
    return getDefaultUiScale();
}

/**
 * Get the effective RuneLite-style UI scale. Viewport size is accepted for API
 * compatibility but does not affect desktop scaling.
 */
export function getUiScale(_cssW?: number, _cssH?: number): number {
    ensureOverrideLoaded();
    return manualScaleOverride ?? getDefaultUiScale();
}

export function isRuneliteInterfaceScalingEnabled(): boolean {
    return getUiScale() > getDefaultUiScale() + 0.001;
}

/** Set a manual UI scale override. Pass `null` to revert to RuneLite's default unstretched size. */
export function setUiScale(scale: number | null): void {
    overrideLoaded = true;
    if (scale === null) {
        manualScaleOverride = null;
        if (typeof localStorage !== "undefined") {
            try {
                localStorage.removeItem(SCALE_STORAGE_KEY);
            } catch {}
        }
        return;
    }

    const clamped = normalizeUiScale(scale);
    manualScaleOverride = clamped;
    if (typeof localStorage !== "undefined") {
        try {
            localStorage.setItem(SCALE_STORAGE_KEY, String(clamped));
        } catch {}
    }
}

export function setRuneliteInterfaceScalingEnabled(enabled: boolean): void {
    setUiScale(enabled ? getRuneliteDefaultStretchedUiScale() : null);
}

export function setOsrsInterfaceScalingPercent(percent: number): void {
    const normalized = normalizeOsrsInterfaceScalingPercent(percent);
    if (normalized === OSRS_INTERFACE_SCALING_DEFAULT_PERCENT) {
        setUiScale(null);
    } else {
        setUiScale(scaleFromOsrsInterfaceScalingPercent(normalized));
    }
}
