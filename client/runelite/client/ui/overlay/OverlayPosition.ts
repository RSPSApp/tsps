/** RuneLite's OverlayPosition: the snap corners an overlay can sit in (DYNAMIC, TOOLTIP and DETACHED are not ported). */
export const OverlayPosition = {
    TOP_LEFT: "TOP_LEFT",
    TOP_CENTER: "TOP_CENTER",
    TOP_RIGHT: "TOP_RIGHT",
    BELOW_MINIMAP: "BELOW_MINIMAP",
    BOTTOM_LEFT: "BOTTOM_LEFT",
    BOTTOM_RIGHT: "BOTTOM_RIGHT",
    ABOVE_CHATBOX_RIGHT: "ABOVE_CHATBOX_RIGHT",
    CANVAS_TOP_RIGHT: "CANVAS_TOP_RIGHT",
} as const;
export type OverlayPosition = (typeof OverlayPosition)[keyof typeof OverlayPosition];
