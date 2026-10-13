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
        dispatch(action);
    } finally { dispatchDepth--; }
}
