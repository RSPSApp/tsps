import type { SimpleMenuEntry } from "./MenuEngine";
import type { MenuTransformContext } from "./menuTransforms";

export type MenuActionData = {
    param0: number; param1: number; opcode: number; identifier: number;
    itemId: number; option: string; target: string; screenX: number; screenY: number;
};
export type MenuEventHooks = {
    prepare?(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[];
    build(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[];
    opened(entries: SimpleMenuEntry[]): SimpleMenuEntry[];
    shouldOpen(open: boolean): boolean;
    click(action: MenuActionData): boolean;
};
let hooks: MenuEventHooks | undefined;
let dispatchDepth = 0;
/**
 * RuneLite's MenuOptionClicked for the client plugins, beside the native hooks: each sees a click
 * before it is dispatched, and returning true consumes it (nothing goes to the server).
 */
export const menuClickListeners = new Set<(action: MenuActionData) => boolean>();
export function setMenuEventHooks(next: MenuEventHooks | undefined): () => void {
    hooks = next;
    return () => { if (hooks === next) hooks = undefined; };
}
export function buildPluginMenu(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[] {
    return hooks?.build(entries, context) ?? entries;
}
export function preparePluginMenu(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[] {
    return hooks?.prepare?.(entries, context) ?? entries;
}
export function openPluginMenu(entries: SimpleMenuEntry[]): SimpleMenuEntry[] {
    return hooks?.opened(entries) ?? entries;
}
export function pluginShouldOpenMenu(open: boolean): boolean { return hooks?.shouldOpen(open) ?? open; }

/** Nested widget/world dispatches describe one click and must post it only once. */
export function dispatchMenuAction(action: MenuActionData, dispatch: (action: MenuActionData) => void): void {
    const nested = dispatchDepth !== 0;
    dispatchDepth++;
    try {
        if (!nested && hooks?.click(action)) return;
        if (!nested) for (const listener of menuClickListeners) if (listener(action)) return;
        dispatch(action);
    } finally { dispatchDepth--; }
}
