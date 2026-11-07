import type { Point } from "../Point";

/** An interface component as ported plugins read it (RuneLite's net.runelite.api.widgets.Widget). */
export interface Widget {
    /** The component id, `(group << 16) | child`. */
    getId(): number;
    getText(): string;
    getSpriteId(): number;
    getItemId(): number;
    getItemQuantity(): number;
    /** Hidden by its own flag; RuneLite's isHidden also checks the parents, which `isSelfHidden` does not. */
    isHidden(): boolean;
    isSelfHidden(): boolean;
    /** Top left on the canvas in pixels, or null before the widget has been laid out. */
    getCanvasLocation(): Point | null;
    getWidth(): number;
    getHeight(): number;
    getRelativeX(): number;
    getRelativeY(): number;
    getScrollX(): number;
    getScrollY(): number;
    getScrollWidth(): number;
    getScrollHeight(): number;
    /** The cache-defined (static) children. */
    getChildren(): Widget[];
    /** The script-created (dynamic) children, in slot order. */
    getDynamicChildren(): Widget[];
    getParent(): Widget | null;
}
