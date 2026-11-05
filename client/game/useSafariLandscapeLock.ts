import { useEffect, useState, useSyncExternalStore } from "react";

import {
    checkMobile,
    isMobileChatKeyboardFocused,
    shouldFreezeViewportForVirtualKeyboard,
} from "../common/utils/DeviceUtil";
import { isPortraitModeEnabled, subscribePortraitModeEnabled } from "./plugins/portraitmode/PortraitLayout";

interface MobileLandscapeLockState {
    enabled: boolean;
    rotated: boolean;
}

function readViewportSize(): {
    width: number;
    height: number;
    offsetLeft: number;
    offsetTop: number;
} {
    if (typeof window === "undefined") {
        return { width: 0, height: 0, offsetLeft: 0, offsetTop: 0 };
    }

    const viewport = window.visualViewport;
    if (viewport) {
        return {
            width: Math.max(1, Math.round(viewport.width)),
            height: Math.max(1, Math.round(viewport.height)),
            offsetLeft: Math.round(viewport.offsetLeft),
            offsetTop: Math.round(viewport.offsetTop),
        };
    }

    return {
        width: Math.max(1, Math.round(window.innerWidth)),
        height: Math.max(1, Math.round(window.innerHeight)),
        offsetLeft: 0,
        offsetTop: 0,
    };
}

export function applyForcedLandscapeSize(
    root: HTMLElement,
    width: number,
    height: number,
    keepRotation: boolean = false,
    offsetLeft: number = 0,
    offsetTop: number = 0,
): { width: number; height: number; rotated: boolean } {
    const rotated = keepRotation
        ? root.dataset.iosSafariForceLandscapeRotated === "1"
        : height > width;
    const size = {
        width: rotated ? height : width,
        height: rotated ? width : height,
        rotated,
    };
    root.style.setProperty("--ios-safari-landscape-w", `${size.width}px`);
    root.style.setProperty("--ios-safari-landscape-h", `${size.height}px`);
    root.style.setProperty("--ios-safari-center-x", `${offsetLeft + width / 2}px`);
    root.style.setProperty("--ios-safari-center-y", `${offsetTop + height / 2}px`);
    root.dataset.iosSafariForceLandscapeRotated = size.rotated ? "1" : "0";
    return size;
}

type LockableOrientation = ScreenOrientation & {
    lock?: (orientation: "landscape") => Promise<void>;
    unlock?: () => void;
};

function screenOrientation(): LockableOrientation | undefined {
    try {
        return window.screen?.orientation as LockableOrientation | undefined;
    } catch {
        return undefined;
    }
}

/**
 * Lets go of a landscape lock taken by this hook. A native lock keeps excluding portrait until
 * unlocked, so without this an upright phone stays landscape after Portrait Mode is turned on.
 */
function releaseLandscapeLock(): void {
    try {
        screenOrientation()?.unlock?.();
    } catch {}
}

export function getForcedLandscapeRotation(
    chatInputFocused: boolean,
    currentRotation: boolean,
    portraitLayout: boolean | undefined,
    allowPortrait: boolean = false,
): boolean | undefined {
    // Portrait mode lays the game out upright, so nothing is ever turned sideways.
    if (allowPortrait) return false;
    if (!chatInputFocused) return undefined;
    return portraitLayout ?? currentRotation;
}

/**
 * Force a landscape layout on phones (iPhone + Android).
 * When the device is physically portrait, CSS-rotates the app 90° and remaps
 * input (via documentElement dataset flags). Also tries Screen Orientation lock
 * when the browser allows it (often after a user gesture / in installed PWAs).
 * While the Portrait Mode plugin is on, the app is never rotated or locked: an
 * upright phone gets the portrait gameframe instead (plugins/portraitmode).
 *
 * Dataset attribute names keep the historical `iosSafariForceLandscape*` keys
 * so InputManager / DeviceUtil continue to work unchanged.
 */
export function useSafariLandscapeLock(enabled: boolean = true): MobileLandscapeLockState {
    const allowPortrait = useSyncExternalStore(subscribePortraitModeEnabled, isPortraitModeEnabled);
    const [rotated, setRotated] = useState(false);
    const isPhone = checkMobile();
    const active = enabled && isPhone;

    useEffect(() => {
        if (!active || typeof window === "undefined" || typeof document === "undefined") {
            setRotated(false);
            return;
        }

        const root = document.documentElement;
        let rafId: number | undefined;
        let lastApplied: { width: number; height: number } | undefined;

        const applyViewportMetrics = () => {
            const { width, height, offsetLeft, offsetTop } = readViewportSize();
            const chatInputFocused = isMobileChatKeyboardFocused();
            const orientationType = window.screen?.orientation?.type;
            const portraitLayout = orientationType?.startsWith("portrait")
                ? true
                : orientationType?.startsWith("landscape")
                  ? false
                  : typeof window.matchMedia === "function"
                    ? window.matchMedia("(orientation: portrait)").matches
                    : undefined;
            const targetRotation = getForcedLandscapeRotation(
                chatInputFocused,
                root.dataset.iosSafariForceLandscapeRotated === "1",
                portraitLayout,
                allowPortrait,
            );
            const preserveRotation = targetRotation !== undefined;
            if (targetRotation !== undefined) {
                root.dataset.iosSafariForceLandscapeRotated = targetRotation ? "1" : "0";
            }
            const keyboardResize = shouldFreezeViewportForVirtualKeyboard(
                lastApplied,
                { width, height },
            );
            // While the on-screen keyboard is open the visual viewport only reflects the
            // sliver above the keyboard. Login keeps its old layout; gameplay resizes while
            // preserving the active rotation so the chat input stays above the keyboard.
            if (keyboardResize && !chatInputFocused) {
                return;
            }
            lastApplied = { width, height };
            root.style.setProperty("--ios-safari-vw", `${width}px`);
            root.style.setProperty("--ios-safari-vh", `${height}px`);
            const landscapeSize = applyForcedLandscapeSize(
                root,
                width,
                height,
                preserveRotation,
                offsetLeft,
                offsetTop,
            );
            setRotated(landscapeSize.rotated);
            root.dataset.iosSafariForceLandscape = "1";
        };

        const scheduleApply = () => {
            if (rafId !== undefined) {
                cancelAnimationFrame(rafId);
            }
            rafId = requestAnimationFrame(() => {
                rafId = undefined;
                applyViewportMetrics();
            });
        };

        const tryLockLandscape = () => {
            if (allowPortrait) return;
            try {
                const orientation = screenOrientation();
                if (!orientation || typeof orientation.lock !== "function") {
                    return;
                }
                orientation
                    .lock("landscape")
                    .then(() => {
                        // Portrait Mode was turned on while the request was pending.
                        if (isPortraitModeEnabled()) releaseLandscapeLock();
                    })
                    .catch(() => {});
            } catch {}
        };

        if (allowPortrait) releaseLandscapeLock();
        scheduleApply();
        tryLockLandscape();

        window.addEventListener("resize", scheduleApply);
        window.addEventListener("orientationchange", scheduleApply);
        window.addEventListener("pageshow", scheduleApply);
        document.addEventListener("visibilitychange", scheduleApply);
        // Re-evaluate when focus leaves an editable element (keyboard closing).
        document.addEventListener("focusout", scheduleApply);
        window.addEventListener("touchstart", tryLockLandscape, { passive: true });
        window.addEventListener("click", tryLockLandscape);

        const viewport = window.visualViewport;
        viewport?.addEventListener("resize", scheduleApply);
        viewport?.addEventListener("scroll", scheduleApply);

        return () => {
            window.removeEventListener("resize", scheduleApply);
            window.removeEventListener("orientationchange", scheduleApply);
            window.removeEventListener("pageshow", scheduleApply);
            document.removeEventListener("visibilitychange", scheduleApply);
            document.removeEventListener("focusout", scheduleApply);
            window.removeEventListener("touchstart", tryLockLandscape);
            window.removeEventListener("click", tryLockLandscape);
            viewport?.removeEventListener("resize", scheduleApply);
            viewport?.removeEventListener("scroll", scheduleApply);
            if (rafId !== undefined) {
                cancelAnimationFrame(rafId);
            }
            root.style.removeProperty("--ios-safari-vw");
            root.style.removeProperty("--ios-safari-vh");
            root.style.removeProperty("--ios-safari-landscape-w");
            root.style.removeProperty("--ios-safari-landscape-h");
            root.style.removeProperty("--ios-safari-center-x");
            root.style.removeProperty("--ios-safari-center-y");
            delete root.dataset.iosSafariForceLandscape;
            delete root.dataset.iosSafariForceLandscapeRotated;
        };
    }, [active, allowPortrait]);

    return {
        enabled: active,
        rotated,
    };
}
