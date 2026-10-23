import { DEFAULT_TOUCH_CONTROLS, type TouchControlsConfig } from "./TouchControlsConfig";

export type TouchGestureIntent =
    | { type: "move"; x: number; y: number }
    | { type: "tap"; x: number; y: number }
    | { type: "longPress"; x: number; y: number }
    | { type: "orbitStart"; x: number; y: number }
    | { type: "orbitMove"; x: number; y: number; deltaX: number; deltaY: number }
    | { type: "orbitEnd" }
    | { type: "scrollSample"; y: number; deltaY: number; deltaTimeMs: number }
    | { type: "cancel" };

type Phase = "idle" | "pending" | "longPressed" | "orbiting" | "dragging";

/**
 * Pure one-finger gesture FSM. No DOM / timers — callers supply timestamps
 * and invoke {@link checkLongPress} (e.g. from a timeout or frame tick).
 *
 * Mapping (OSRS-mobile style):
 * - short stationary release → tap
 * - hold without moving → longPress
 * - move past threshold → orbit (if enabled) or drag (scroll / no tap)
 */
export class TouchGestureRecognizer {
    private phase: Phase = "idle";
    private orbitOnly = false;
    private startX = 0;
    private startY = 0;
    private startTimeMs = 0;
    private lastX = 0;
    private lastY = 0;
    private lastTimeMs = 0;
    private config: TouchControlsConfig;

    constructor(config: TouchControlsConfig = DEFAULT_TOUCH_CONTROLS) {
        this.config = { ...config };
    }

    setConfig(config: Partial<TouchControlsConfig>): void {
        this.config = { ...this.config, ...config };
    }

    getConfig(): TouchControlsConfig {
        return this.config;
    }

    isActive(): boolean {
        return this.phase !== "idle";
    }

    /** True while a finger is down and long-press has not fired / been cancelled. */
    isAwaitingLongPress(): boolean {
        return this.phase === "pending";
    }

    /**
     * Finger down — begins a pending gesture (no click yet). `orbitOnly` (the finger left on
     * the screen after a pinch) may still orbit or drag, but never taps or long-presses.
     */
    fingerDown(x: number, y: number, timeMs: number, orbitOnly = false): TouchGestureIntent[] {
        this.phase = "pending";
        this.orbitOnly = orbitOnly;
        this.startX = x;
        this.startY = y;
        this.startTimeMs = timeMs;
        this.lastX = x;
        this.lastY = y;
        this.lastTimeMs = timeMs;
        return [{ type: "move", x, y }];
    }

    fingerMove(x: number, y: number, timeMs: number): TouchGestureIntent[] {
        if (this.phase === "idle") {
            return [];
        }

        const intents: TouchGestureIntent[] = [{ type: "move", x, y }];
        const deltaTimeMs = Math.max(0, timeMs - this.lastTimeMs);
        const deltaY = y - this.lastY;

        if (this.phase === "orbiting") {
            // Same convention as middle-mouse: previous - current.
            const deltaX = this.lastX - x;
            const camDeltaY = this.lastY - y;
            this.lastX = x;
            this.lastY = y;
            this.lastTimeMs = timeMs;
            intents.push({
                type: "orbitMove",
                x,
                y,
                deltaX: deltaX * this.config.orbitSensitivity,
                deltaY: camDeltaY * this.config.orbitSensitivity,
            });
            return intents;
        }

        if (this.phase === "dragging" || this.phase === "pending" || this.phase === "longPressed") {
            if (deltaTimeMs > 0 && Math.abs(deltaY) > 2) {
                intents.push({ type: "scrollSample", y, deltaY, deltaTimeMs });
            }
        }

        if (this.phase === "pending" || this.phase === "longPressed") {
            const dist = Math.hypot(x - this.startX, y - this.startY);
            if (dist >= this.config.dragThresholdPx) {
                if (this.phase === "longPressed") {
                    // Already fired right-click; moving after that cancels hold state.
                    intents.push({ type: "cancel" });
                }
                if (this.config.enableCameraOrbit) {
                    this.phase = "orbiting";
                    this.lastX = x;
                    this.lastY = y;
                    this.lastTimeMs = timeMs;
                    intents.push({ type: "orbitStart", x, y });
                    return intents;
                }
                this.phase = "dragging";
            }
        }

        this.lastX = x;
        this.lastY = y;
        this.lastTimeMs = timeMs;
        return intents;
    }

    /**
     * Call periodically while a finger is down (timeout or frame).
     * Emits longPress once when holdMs elapses without leaving pending.
     */
    checkLongPress(timeMs: number): TouchGestureIntent[] {
        if (this.phase !== "pending" || this.orbitOnly) {
            return [];
        }
        if (timeMs - this.startTimeMs < this.config.holdMs) {
            return [];
        }
        this.phase = "longPressed";
        return [{ type: "longPress", x: this.startX, y: this.startY }];
    }

    fingerUp(x: number, y: number, _timeMs: number): TouchGestureIntent[] {
        if (this.phase === "idle") {
            return [];
        }

        const intents: TouchGestureIntent[] = [{ type: "move", x, y }];

        if (this.phase === "pending") {
            intents.push(this.orbitOnly ? { type: "cancel" } : { type: "tap", x: this.startX, y: this.startY });
        } else if (this.phase === "orbiting") {
            intents.push({ type: "orbitEnd" });
        } else if (this.phase === "longPressed") {
            // Right-click already pulsed on longPress; release clears held state via cancel.
            intents.push({ type: "cancel" });
        } else if (this.phase === "dragging") {
            intents.push({ type: "cancel" });
        }

        this.reset();
        return intents;
    }

    /** Abort current gesture (e.g. second finger / pinch started). */
    cancel(): TouchGestureIntent[] {
        if (this.phase === "idle") {
            return [];
        }
        const intents: TouchGestureIntent[] = [];
        if (this.phase === "orbiting") {
            intents.push({ type: "orbitEnd" });
        } else {
            intents.push({ type: "cancel" });
        }
        this.reset();
        return intents;
    }

    private reset(): void {
        this.phase = "idle";
        this.orbitOnly = false;
        this.startX = 0;
        this.startY = 0;
        this.startTimeMs = 0;
        this.lastX = 0;
        this.lastY = 0;
        this.lastTimeMs = 0;
    }
}
