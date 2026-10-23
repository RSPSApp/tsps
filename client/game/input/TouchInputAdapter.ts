import type { InputManager } from "../InputManager";
import { DEFAULT_TOUCH_CONTROLS, type TouchControlsConfig } from "./TouchControlsConfig";
import {
    TouchGestureRecognizer,
    type TouchGestureIntent,
} from "./TouchGestureRecognizer";

/**
 * Maps {@link TouchGestureRecognizer} intents onto InputManager's existing
 * LEFT / RIGHT / middle-mouse camera APIs. Owns the long-press timer.
 */
export class TouchInputAdapter {
    private readonly recognizer: TouchGestureRecognizer;
    private longPressTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly input: InputManager,
        config: TouchControlsConfig = DEFAULT_TOUCH_CONTROLS,
    ) {
        this.recognizer = new TouchGestureRecognizer(config);
    }

    setConfig(config: Partial<TouchControlsConfig>): void {
        this.recognizer.setConfig(config);
    }

    /** Enable/disable one-finger camera orbit (e.g. off on login world list). */
    setCameraOrbitEnabled(enabled: boolean): void {
        this.recognizer.setConfig({ enableCameraOrbit: enabled });
    }

    onFingerDown(x: number, y: number, timeMs: number, orbitOnly = false): void {
        this.clearLongPressTimer();
        this.applyIntents(this.recognizer.fingerDown(x, y, timeMs, orbitOnly));
        this.scheduleLongPressCheck();
    }

    onFingerMove(x: number, y: number, timeMs: number): void {
        this.applyIntents(this.recognizer.fingerMove(x, y, timeMs));
        if (!this.recognizer.isAwaitingLongPress()) {
            this.clearLongPressTimer();
        }
    }

    onFingerUp(x: number, y: number, timeMs: number): void {
        this.clearLongPressTimer();
        this.applyIntents(this.recognizer.fingerUp(x, y, timeMs));
    }

    /** Second finger / pinch — abort one-finger gesture. */
    onCancel(): void {
        this.clearLongPressTimer();
        this.applyIntents(this.recognizer.cancel());
    }

    destroy(): void {
        this.clearLongPressTimer();
        this.applyIntents(this.recognizer.cancel());
    }

    private scheduleLongPressCheck(): void {
        const holdMs = this.recognizer.getConfig().holdMs;
        this.longPressTimer = setTimeout(() => {
            this.longPressTimer = undefined;
            const now =
                typeof performance !== "undefined" ? performance.now() : Date.now();
            this.applyIntents(this.recognizer.checkLongPress(now));
        }, holdMs);
    }

    private clearLongPressTimer(): void {
        if (this.longPressTimer !== undefined) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = undefined;
        }
    }

    private applyIntents(intents: TouchGestureIntent[]): void {
        for (const intent of intents) {
            switch (intent.type) {
                case "move":
                    this.input.applyTouchPointerMove(intent.x, intent.y);
                    break;
                case "tap":
                    this.input.applyTouchTap(intent.x, intent.y);
                    break;
                case "longPress":
                    this.input.applyTouchLongPress(intent.x, intent.y);
                    this.clearLongPressTimer();
                    break;
                case "orbitStart":
                    this.clearLongPressTimer();
                    this.input.beginTouchCameraDrag(intent.x, intent.y);
                    break;
                case "orbitMove":
                    this.input.addTouchCameraDragDelta(
                        intent.x,
                        intent.y,
                        intent.deltaX,
                        intent.deltaY,
                    );
                    break;
                case "orbitEnd":
                    this.input.endTouchCameraDrag();
                    break;
                case "scrollSample":
                    this.input.applyTouchScrollSample(
                        intent.y,
                        intent.deltaY,
                        intent.deltaTimeMs,
                    );
                    break;
                case "cancel":
                    this.input.cancelTouchGesture();
                    break;
                default:
                    break;
            }
        }
    }
}
