/** An arrow key a camera key stands for. */
export type ArrowKey = { readonly code: string; readonly keyCode: number };

/** RuneLite Key Remapping's default camera keybinds: W up, S down, A left, D right. */
const CAMERA_KEYS: Readonly<Record<string, ArrowKey>> = {
    KeyW: { code: "ArrowUp", keyCode: 38 },
    KeyS: { code: "ArrowDown", keyCode: 40 },
    KeyA: { code: "ArrowLeft", keyCode: 37 },
    KeyD: { code: "ArrowRight", keyCode: 39 },
};

/** The keys W/A/S/D stand for, which turn the camera on their own when WASD camera is off. */
export const ARROW_KEY_CODES: ReadonlySet<string> = new Set(Object.values(CAMERA_KEYS).map((arrow) => arrow.code));

/** The arrow key a press stands for; with Ctrl, Alt or Meta held it is left alone. */
export function cameraArrowFor(event: KeyboardEvent): ArrowKey | undefined {
    if (event.ctrlKey || event.altKey || event.metaKey) return undefined;
    return CAMERA_KEYS[event.code];
}

/**
 * `event` as the arrow key it stands for, as RuneLite rewrites the KeyEvent's key code. A plain
 * object: a DOM event's own fields can't be changed, and its getters refuse a copy made by
 * Object.create. Default handling still goes to the original event.
 */
export function asArrowKey(event: KeyboardEvent, arrow: ArrowKey): KeyboardEvent {
    return {
        type: event.type,
        code: arrow.code,
        key: arrow.code,
        keyCode: arrow.keyCode,
        which: arrow.keyCode,
        charCode: 0,
        location: 0,
        repeat: event.repeat,
        isComposing: false,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        target: event.target,
        timeStamp: event.timeStamp,
        getModifierState: (key: string) => event.getModifierState?.(key) ?? false,
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation?.(),
        stopImmediatePropagation: () => event.stopImmediatePropagation?.(),
    } as unknown as KeyboardEvent;
}
