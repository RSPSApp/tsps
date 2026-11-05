import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { isIosLandscapeRotated } from "../../InputManager";
import { type TouchAction, type TouchControlsPlugin } from "./TouchControlsPlugin";
import "./TouchJoystick.css";

/** Reference travel/base size; the rendered bounds scale travel with the smaller stick. */
const RADIUS = 44;
const BASE_SIZE = 120;
/** Fraction of the travel that still counts as centred. */
const DEAD_ZONE = 0.2;
/** Holding the action button this long lists every option instead. */
const LONG_PRESS_MS = 250;

/** Touch handlers own their touches: no default gesture and nothing reaching the canvas. */
const own = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
};

/**
 * Bottom-left analog joystick. The knob follows the finger inside the base and
 * springs back on release. The touch is captured per pointer so a second finger
 * can drag the camera, and nothing reaches the game canvas underneath.
 */
export function TouchJoystick({ plugin }: { plugin: TouchControlsPlugin }): JSX.Element | null {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getUiState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);

    const steer = (clientX: number, clientY: number, base: HTMLElement) => {
        const rect = base.getBoundingClientRect();
        // Travel follows the rendered stick size in either orientation.
        const radius = RADIUS * (rect.width > 0 ? Math.min(rect.width, rect.height) / BASE_SIZE : 1);
        const screenX = clientX - (rect.left + rect.width / 2);
        const screenY = clientY - (rect.top + rect.height / 2);
        // iOS portrait turns the whole game +90deg (index.css): map the finger back
        // into the game's own axes, as getMousePos does for the canvas.
        const rotated = isIosLandscapeRotated();
        let x = rotated ? screenY : screenX;
        let y = rotated ? -screenX : screenY;
        const distance = Math.hypot(x, y);
        if (distance > radius) {
            x *= radius / distance;
            y *= radius / distance;
        }
        setKnob({ x, y });
        // Screen y grows down; forward is up.
        if (Math.hypot(x, y) < radius * DEAD_ZONE) plugin.steer(0, 0);
        else plugin.steer(-y / radius, x / radius);
    };

    const onDown = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Pointer capture is best effort; the stick still releases on pointerup.
        }
        steer(event.clientX, event.clientY, event.currentTarget);
    };

    const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.preventDefault();
        event.stopPropagation();
        steer(event.clientX, event.clientY, event.currentTarget);
    };

    const onUp = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setKnob(null);
        plugin.release();
    };

    if (!state.visible) return null;

    return (
        <div
            className={`touch-controls${state.portrait ? " portrait" : ""}`}
            style={{ "--hud-inset": `${state.hudInset}px`, "--touch-ui-scale": state.scale } as React.CSSProperties}
        >
            <div
                className={`touch-joystick${knob ? " is-active" : ""}`}
                role="group"
                aria-label="Movement joystick"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                // WebView can drop pointerup when the finger leaves the
                // screen; lostpointercapture then guarantees the release.
                onLostPointerCapture={onUp}
                onContextMenu={(event) => event.preventDefault()}
            >
                <span
                    className="touch-joystick-knob"
                    style={knob ? { transform: `translate(${knob.x}px, ${knob.y}px)` } : undefined}
                />
            </div>
            {state.action && <ActionButton plugin={plugin} action={state.action} stonesInset={state.stonesInset} />}
        </div>
    );
}

/**
 * Bottom-right button for the object, NPC or ground items the player is at, left of the tab
 * stones: a tap uses the first option, a long press lists them all (its right-click menu),
 * scrolling when a pile of items has more than fit.
 */
function ActionButton({ plugin, action, stonesInset }: { plugin: TouchControlsPlugin; action: TouchAction; stonesInset: number }): JSX.Element {
    const [listing, setListing] = useState(false);
    const timer = useRef<number | undefined>(undefined);
    const key = action.options.map((o) => `${o.option} ${o.target}`).join("|");
    // A different object closes the list.
    useEffect(() => setListing(false), [key]);
    useEffect(() => () => {
        window.clearTimeout(timer.current);
        plugin.pin(false);
    }, [plugin]);
    const close = () => {
        setListing(false);
        plugin.pin(false);
    };

    const onDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        own(event);
        plugin.pin(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            timer.current = undefined;
            setListing(true);
        }, LONG_PRESS_MS);
    };
    const onUp = (event: React.PointerEvent<HTMLButtonElement>) => {
        own(event);
        if (timer.current === undefined) return; // the long press opened (or a cancel ended) it
        window.clearTimeout(timer.current);
        timer.current = undefined;
        if (!listing) plugin.interact(action.options[0].id);
        close();
    };
    const onCancel = () => {
        window.clearTimeout(timer.current);
        timer.current = undefined;
        if (!listing) plugin.pin(false);
    };

    return (
        <div className="touch-action" style={{ "--stones-inset": `${stonesInset}px` } as React.CSSProperties}>
            {listing && (
                <div className="touch-action-list" role="menu">
                    {action.options.map(({ option, target, id }) => (
                        <button
                            key={id}
                            type="button"
                            role="menuitem"
                            className="touch-action-option"
                            // Not owned: a drag here scrolls the list, and the browser then sends no click.
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                own(event);
                                plugin.interact(id);
                                close();
                            }}
                            onContextMenu={own}
                        >
                            {option} <span className={`touch-action-target is-${action.kind}`}>{target}</span>
                        </button>
                    ))}
                </div>
            )}
            <button
                type="button"
                className="touch-action-button"
                onPointerDown={onDown}
                onPointerUp={onUp}
                onPointerCancel={onCancel}
                onContextMenu={own}
            >
                <span className="touch-action-option-label">{action.options[0].option}</span>
                <span className={`touch-action-target is-${action.kind}`}>{action.options[0].target}</span>
            </button>
        </div>
    );
}
