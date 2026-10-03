const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
const touchPoints = typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0;
const docElement = typeof document !== "undefined" ? document.documentElement : undefined;

export const checkIphone = () => {
    return /iPhone/i.test(userAgent);
};

export const checkAndroid = () => {
    return /Android/i.test(userAgent);
};

export const checkIpad = () => {
    return /iPad/i.test(userAgent);
};

export const checkMobile = () => {
    return checkAndroid() || checkIphone();
};

export function checkIos(): boolean {
    // iPad on iOS 13 detection
    const isIpad = userAgent.includes("Macintosh") && touchPoints >= 1;
    return /iPad|iPhone|iPod/.test(userAgent) || isIpad;
}

export const isIos = checkIos();

export function checkSafari(): boolean {
    if (!userAgent) return false;
    // Safari UA token appears in most iOS browsers; exclude known non-Safari wrappers.
    return (
        /Safari/i.test(userAgent) &&
        !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS|OPR|SamsungBrowser|DuckDuckGo|YaBrowser/i.test(
            userAgent,
        )
    );
}

export const isSafari = checkSafari();
export const isIosSafari = isIos && isSafari;

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

export function isStandaloneDisplayMode(): boolean {
    if (typeof window === "undefined") return false;
    const nav = window.navigator as NavigatorWithStandalone;
    const isStandaloneMedia =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches;
    return isStandaloneMedia || nav.standalone === true;
}

export function isIosStandalonePwa(): boolean {
    return isIos && isStandaloneDisplayMode();
}

function getForcedLandscapeViewportSize():
    | {
          width: number;
          height: number;
      }
    | undefined {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    if (root?.dataset?.iosSafariForceLandscape !== "1") {
        return undefined;
    }

    const forcedWidth = Number.parseFloat(root.style.getPropertyValue("--ios-safari-landscape-w"));
    const forcedHeight = Number.parseFloat(root.style.getPropertyValue("--ios-safari-landscape-h"));
    if (!Number.isFinite(forcedWidth) || !Number.isFinite(forcedHeight)) {
        return undefined;
    }
    if (forcedWidth <= 0 || forcedHeight <= 0) {
        return undefined;
    }

    return {
        width: forcedWidth,
        height: forcedHeight,
    };
}

/** True when the focused element can summon an on-screen keyboard (input/textarea/etc). */
export function isEditableElementFocused(): boolean {
    if (typeof document === "undefined") return false;
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return (
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true
    );
}

/**
 * Decide whether a new viewport measurement should be ignored because it only reflects
 * the on-screen keyboard shrinking the visual viewport (iOS/Android). Resizing the app
 * to the keyboard-shrunk viewport collapses the whole layout (the login panel becomes
 * unreadably small and forced-landscape mode can even un-rotate), so viewport-derived
 * CSS variables are frozen at their pre-keyboard values while an editable element is
 * focused. Rotations/real resizes change the width and are applied normally.
 */
export function shouldFreezeViewportForVirtualKeyboard(
    prev: { width: number; height: number } | undefined,
    next: { width: number; height: number },
): boolean {
    if (!prev || prev.width <= 0 || prev.height <= 0) return false;
    if (!isEditableElementFocused()) return false;
    const widthUnchanged = Math.abs(next.width - prev.width) <= 40;
    return widthUnchanged && next.height < prev.height - 30;
}

// Actual touch device detection - osm_simulate varbit (6352) can override this for testing
export const isTouchDevice = !!(touchPoints || (!!docElement && "ontouchstart" in docElement));

// Check for ?mobile=1 URL parameter to force mobile mode on desktop
const urlParams =
    typeof window !== "undefined" ? new URLSearchParams(window.location?.search || "") : null;
export const forceMobileMode =
    urlParams?.get("mobile") === "1" || urlParams?.get("mobile") === "true";

// Debug UI (the Leva panel and its F-key shortcuts) only mounts with an
// explicit ?debug flag, so players never see it.
export const isDebugMode = urlParams?.has("debug") ?? false;

// Layout/mobile UI mode should only follow actual handheld/tablet platforms (plus overrides),
// not generic touch-capable desktop hardware.
export const isMobileMode = checkAndroid() || isIos || forceMobileMode;

export type SafeAreaInsets = {
    top: number;
    right: number;
    bottom: number;
    left: number;
};

export type SafeAreaBounds = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};

const ZERO_SAFE_AREA_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
let safeAreaProbe: HTMLDivElement | null = null;
let safeAreaInsetsCache: SafeAreaInsets = ZERO_SAFE_AREA_INSETS;
let safeAreaInsetsCacheKey = "";

function readInsetPx(value: string): number {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
}

function getSafeAreaCacheKey(): string {
    if (typeof window === "undefined") return "ssr";
    const vp = window.visualViewport;
    if (!vp) {
        return `${window.innerWidth}:${window.innerHeight}:novp`;
    }
    return `${window.innerWidth}:${window.innerHeight}:${vp.width}:${vp.height}:${vp.offsetLeft}:${vp.offsetTop}`;
}

function ensureSafeAreaProbe(): HTMLDivElement | null {
    if (typeof document === "undefined") return null;
    if (safeAreaProbe && safeAreaProbe.isConnected) return safeAreaProbe;

    const parent = document.body || document.documentElement;
    if (!parent) return null;

    const probe = document.createElement("div");
    probe.style.position = "fixed";
    probe.style.inset = "0";
    probe.style.width = "0";
    probe.style.height = "0";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.style.paddingTop = "env(safe-area-inset-top)";
    probe.style.paddingRight = "env(safe-area-inset-right)";
    probe.style.paddingBottom = "env(safe-area-inset-bottom)";
    probe.style.paddingLeft = "env(safe-area-inset-left)";
    parent.appendChild(probe);
    safeAreaProbe = probe;
    return probe;
}

export function getSafeAreaInsets(): SafeAreaInsets {
    if (typeof window === "undefined" || typeof document === "undefined") {
        return ZERO_SAFE_AREA_INSETS;
    }

    const cacheKey = getSafeAreaCacheKey();
    if (cacheKey === safeAreaInsetsCacheKey) {
        return safeAreaInsetsCache;
    }

    const probe = ensureSafeAreaProbe();
    if (!probe) {
        safeAreaInsetsCacheKey = cacheKey;
        safeAreaInsetsCache = ZERO_SAFE_AREA_INSETS;
        return safeAreaInsetsCache;
    }

    const style = window.getComputedStyle(probe);
    safeAreaInsetsCache = {
        top: readInsetPx(style.paddingTop),
        right: readInsetPx(style.paddingRight),
        bottom: readInsetPx(style.paddingBottom),
        left: readInsetPx(style.paddingLeft),
    };
    safeAreaInsetsCacheKey = cacheKey;
    return safeAreaInsetsCache;
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

export function getSafeAreaBounds(canvasWidth: number, canvasHeight: number): SafeAreaBounds {
    const width = Number.isFinite(canvasWidth) ? Math.max(0, canvasWidth) : 0;
    const height = Number.isFinite(canvasHeight) ? Math.max(0, canvasHeight) : 0;
    const rawInsets = getSafeAreaInsets();

    let scaleX = 1;
    let scaleY = 1;
    if (typeof window !== "undefined") {
        const viewport = getViewportSize();
        const viewportWidth = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0;
        const viewportHeight = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0;

        // Safe-area env() values are reported in CSS pixels. Convert them into the
        // active canvas/layout coordinate space so SAFEAREA_* opcodes stay consistent
        // whether widgets are laid out in CSS pixels (login) or backing-store pixels
        // (gameplay/mobile root 601).
        if (viewportWidth > 0 && width > 0) {
            scaleX = width / viewportWidth;
        }
        if (viewportHeight > 0 && height > 0) {
            scaleY = height / viewportHeight;
        }
    }

    const insets = {
        top: rawInsets.top * scaleY,
        right: rawInsets.right * scaleX,
        bottom: rawInsets.bottom * scaleY,
        left: rawInsets.left * scaleX,
    };

    const minX = clamp(Math.round(insets.left), 0, width);
    const minY = clamp(Math.round(insets.top), 0, height);
    const maxX = clamp(Math.round(width - insets.right), minX, width);
    const maxY = clamp(Math.round(height - insets.bottom), minY, height);

    return { minX, minY, maxX, maxY };
}

export const isWebGL2Supported = (() => {
    if (typeof document === "undefined") return false;
    try {
        return !!document.createElement("canvas").getContext("webgl2");
    } catch {
        return false;
    }
})();

export function getCanvasCssSize(canvas: HTMLCanvasElement): { width: number; height: number } {
    const clientWidth = canvas.clientWidth || canvas.offsetWidth;
    const clientHeight = canvas.clientHeight || canvas.offsetHeight;

    let rectWidth = 0;
    let rectHeight = 0;
    try {
        const rect = canvas.getBoundingClientRect();
        rectWidth = Number.isFinite(rect.width) ? rect.width : 0;
        rectHeight = Number.isFinite(rect.height) ? rect.height : 0;
    } catch {}

    // DOMRect preserves fractional CSS pixels, which prevents the browser from subtly rescaling
    // the final canvas on large/fractional-sized layouts. The forced-landscape iOS path still
    // prefers the untransformed client box when it is available.
    const preferClientSize = !!docElement?.dataset?.iosSafariForceLandscape;

    const width = preferClientSize
        ? clientWidth > 0
            ? clientWidth
            : rectWidth
        : rectWidth > 0
          ? rectWidth
          : clientWidth;
    const height = preferClientSize
        ? clientHeight > 0
            ? clientHeight
            : rectHeight
        : rectHeight > 0
          ? rectHeight
          : clientHeight;

    return {
        width: width > 0 ? width : 0,
        height: height > 0 ? height : 0,
    };
}

/**
 * Get current screen orientation.
 * Uses visualViewport when available for more accurate mobile measurements.
 */
export function getOrientation(): "portrait" | "landscape" {
    if (typeof window === "undefined") return "landscape";

    const forcedLandscape = getForcedLandscapeViewportSize();
    if (forcedLandscape) {
        return "landscape";
    }

    // Use visualViewport if available (more accurate on mobile with keyboard open)
    const vp = window.visualViewport;
    if (vp) {
        return vp.width < vp.height ? "portrait" : "landscape";
    }

    // Fallback to window dimensions
    return window.innerWidth < window.innerHeight ? "portrait" : "landscape";
}

/**
 * Get current viewport size.
 * Uses visualViewport when available for accurate mobile measurements
 * (accounts for virtual keyboard, browser chrome, etc).
 */
export function getViewportSize(): { width: number; height: number } {
    if (typeof window === "undefined") {
        return { width: 765, height: 503 };
    }

    const forcedLandscape = getForcedLandscapeViewportSize();
    if (forcedLandscape) {
        return forcedLandscape;
    }

    // Use visualViewport if available (more accurate on mobile)
    const vp = window.visualViewport;
    if (vp) {
        return { width: vp.width, height: vp.height };
    }

    // Fallback to window dimensions
    return { width: window.innerWidth, height: window.innerHeight };
}
