/**
 * Minimal UI input bridge for GL widgets.
 *
 * This file provides a bridge between InputManager (OSRS-parity input) and
 * ClickRegistry (GL widget hit testing). It does NOT register its own event
 * listeners - all input comes through InputManager.
 */
import { ClickMode, InputManager } from "../../game/InputManager";
import { ClickRegistry } from "./click-registry";
import type { GLRenderer } from "./renderer";

export class UIInputBridge {
    private clicks: ClickRegistry;
    private lastClickMode3: number = ClickMode.NONE;
    private lastClickMode2: number = ClickMode.NONE;
    private menuHandler?: (x: number, y: number) => void;
    private canvas?: HTMLCanvasElement;
    private lastProcessedMouseX: number = Number.NaN;
    private lastProcessedMouseY: number = Number.NaN;
    private lastProcessedSaveClickX: number = Number.NaN;
    private lastProcessedSaveClickY: number = Number.NaN;
    private lastProcessedClickMode2: number = Number.NaN;
    private lastProcessedClickMode3: number = Number.NaN;
    private lastProcessedMiddleClickSequence: number = -1;
    // When true, suppress the next pointer-up transition for the current click.
    // Used when a handler consumes the click on mousedown (OSRS menu parity).
    private suppressUpUntilRelease: boolean = false;

    constructor(canvas?: HTMLCanvasElement) {
        this.clicks = new ClickRegistry();
        this.canvas = canvas;
    }

    getClicks(): ClickRegistry {
        return this.clicks;
    }

    /**
     * Reset click tracking state. Call this when a click has been consumed
     * by a handler to prevent further processing.
     */
    consumeClick(): void {
        this.suppressUpUntilRelease = true;
        this.clicks.cancelActiveClick();
    }

    setMenuHandler(fn: (x: number, y: number) => void) {
        this.menuHandler = fn;
    }

    private transformPoint(x: number, y: number): { x: number; y: number } {
        const canvasAny = this.canvas as any;
        const scaleXRaw = Number(canvasAny?.__uiInputScaleX ?? 1);
        const scaleYRaw = Number(canvasAny?.__uiInputScaleY ?? 1);
        const scaleX = Number.isFinite(scaleXRaw) && scaleXRaw > 0 ? scaleXRaw : 1;
        const scaleY = Number.isFinite(scaleYRaw) && scaleYRaw > 0 ? scaleYRaw : 1;
        return {
            x: Math.round(x * scaleX),
            y: Math.round(y * scaleY),
        };
    }

    /**
     * Called at start of each frame to reset transient click targets
     */
    beginFrame() {
        this.clicks.beginFrame();
    }

    /**
     * Process input from InputManager and feed it to ClickRegistry.
     * Call this once per frame after beginFrame().
     */
    processInput(input: InputManager): void {
        const {
            mouseX,
            mouseY,
            clickMode2,
            clickMode3,
            saveClickX,
            saveClickY,
            middleClickX,
            middleClickY,
            middleClickSequence,
        } = input;
        const sameInputState =
            mouseX === this.lastProcessedMouseX &&
            mouseY === this.lastProcessedMouseY &&
            saveClickX === this.lastProcessedSaveClickX &&
            saveClickY === this.lastProcessedSaveClickY &&
            clickMode2 === this.lastProcessedClickMode2 &&
            clickMode3 === this.lastProcessedClickMode3 &&
            middleClickSequence === this.lastProcessedMiddleClickSequence;
        if (sameInputState) {
            // Targets may have moved under a still pointer: only the hover can change. Picking
            // is one pass over the targets, far cheaper than hashing all of them every frame.
            if (mouseX >= 0 && mouseY >= 0) {
                const mousePos = this.transformPoint(mouseX, mouseY);
                this.clicks.onPointerMove(mousePos.x, mousePos.y);
            }
            return;
        }

        const mousePos = this.transformPoint(mouseX, mouseY);
        const clickPos = this.transformPoint(saveClickX, saveClickY);
        const middleClickPos = this.transformPoint(middleClickX, middleClickY);

        // Update hover state
        if (mouseX >= 0 && mouseY >= 0) {
            this.clicks.onPointerMove(mousePos.x, mousePos.y);
        }

        // Handle clicks based on clickMode3 (single-frame pulse)
        if (clickMode3 !== ClickMode.NONE && this.lastClickMode3 === ClickMode.NONE) {
            // New click this frame
            if (clickMode3 === ClickMode.LEFT) {
                this.clicks.onPointerDown(clickPos.x, clickPos.y);
            } else if (clickMode3 === ClickMode.RIGHT) {
                // Right click opens menu
                this.menuHandler?.(clickPos.x, clickPos.y);
            }
        }

        if (
            middleClickSequence !== this.lastProcessedMiddleClickSequence &&
            middleClickX >= 0 &&
            middleClickY >= 0
        ) {
            this.clicks.onMiddleClick(middleClickPos.x, middleClickPos.y);
        }

        // release is tracked by clickMode2 (held state), not clickMode3 (pulse).
        // clickMode3 returns to NONE the frame after mousedown even while held.
        if (this.lastClickMode2 === ClickMode.LEFT && clickMode2 === ClickMode.NONE) {
            if (!this.suppressUpUntilRelease) {
                this.clicks.onPointerUp(mousePos.x, mousePos.y);
            } else {
                // Consume exactly one up-transition, then clear.
                this.suppressUpUntilRelease = false;
            }
        }

        // If a click was consumed but the button is not held, clear suppression to avoid latching forever.
        if (this.suppressUpUntilRelease && clickMode2 === ClickMode.NONE) {
            this.suppressUpUntilRelease = false;
        }

        // Update tracking state
        this.lastClickMode3 = clickMode3;
        this.lastClickMode2 = clickMode2;
        this.lastProcessedMouseX = mouseX;
        this.lastProcessedMouseY = mouseY;
        this.lastProcessedSaveClickX = saveClickX;
        this.lastProcessedSaveClickY = saveClickY;
        this.lastProcessedClickMode2 = clickMode2;
        this.lastProcessedClickMode3 = clickMode3;
        this.lastProcessedMiddleClickSequence = middleClickSequence;
    }

    /**
     * Get current pointer position from InputManager
     */
    getPointerPos(input: InputManager): { x: number; y: number } {
        return this.transformPoint(input.mouseX, input.mouseY);
    }
}

/**
 * Get or create a UIInputBridge for a GL renderer.
 * Stores the bridge on the canvas for reuse across frames.
 */
export function ensureInputBridge(glr: GLRenderer): UIInputBridge {
    const canvas = glr.canvas as any;
    if (!canvas.__inputBridge) {
        canvas.__inputBridge = new UIInputBridge(glr.canvas);
    }
    return canvas.__inputBridge;
}

// Legacy compatibility - maps to new system
export function ensureInput(
    glr: GLRenderer,
    _scheduleRender: () => void,
    _eventsCanvas?: HTMLCanvasElement,
): UIInputBridge {
    return ensureInputBridge(glr);
}

// Re-export for compatibility
export { UIInputBridge as UIInput };
