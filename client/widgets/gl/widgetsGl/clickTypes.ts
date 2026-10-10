import type { WidgetNode } from "../../../widgets/WidgetNode";
type Widget = WidgetNode;
type WidgetClickMeta = {
    widget: Widget;
    option: string;
    target?: string;
    hasDropAction: boolean;
    itemId?: number;
    slot?: number;
};

// PERF: Cached click target structure to avoid object allocation per widget per frame
type CachedClickTarget = {
    id: string;
    rect: { x: number; y: number; w: number; h: number };
    priority: number;
    hoverText?: string;
    primaryOption?: { option: string; target?: string };
    /**
     * number of minimenu options for this hover target (including Cancel).
     * Used by CS2 minimenu_* opcodes via ClientOps snapshot logic.
     */
    menuOptionsCount?: number;
    widgetUid?: number; // For OSRS-style visibility filtering during hit testing
    onDown?: (x?: number, y?: number, targetId?: string) => void;
    onClick?: (x?: number, y?: number, targetId?: string) => void;
    persist?: boolean; // If true, survives beginFrame() clearing
};
export type { WidgetClickMeta, CachedClickTarget };

/**
 * A widget's click target persists between frames, hover text included, until it is
 * unregistered. Once the widget has nothing to offer any more (an emptied worn-equipment slot,
 * say), drop it: otherwise hovering it keeps showing its old option ("Remove Bronze arrow")
 * until relog, though its menu, rebuilt on each right-click, is already empty.
 */
export function dropStaleClickTarget(
    cache: Map<number, CachedClickTarget>,
    clicks: { unregister(id: string): void },
    widget: { uid: number },
): void {
    const stale = cache.get(widget.uid);
    if (!stale) return;
    clicks.unregister(stale.id);
    cache.delete(widget.uid);
    (widget as any).__clickTargetId = undefined;
}
