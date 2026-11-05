import { ClientState } from "../../../game/ClientState";
import { clearSpellSelectionWithHandler } from "../../../ui/menu/MenuAction";
import type { WidgetNode } from "../../../widgets/WidgetNode";
// Debug flag: draw purple outlines around clickable areas
export const DEBUG_CLICK_AREAS = false;
export const NOOP = () => {};

// PERF: Cached cancel selection handler to avoid closure allocation per widget.
// The spell's onTargetLeave must run, or it keeps its outline after the cancel (#2052).
export const CANCEL_SELECTION_HANDLER = () => {
    clearSpellSelectionWithHandler();
    ClientState.clearItemSelection();
};
export const WIDGET_MENU_DERIVE_CACHE_MAX = 8192;
export const EMPTY_WIDGETS: WidgetNode[] = [];
export const SCROLLBAR_TRACK_COLOR = 0x23201b;
export const SCROLLBAR_THUMB_COLOR = 0x4d4233;
export const SCROLLBAR_TOP_COLOR = 0x766654;
export const SCROLLBAR_BOTTOM_COLOR = 0x332d25;
export const ARC_TURN_UNITS = 65536;
export const ARC_FULL_RADIANS = Math.PI * 2;
export const WORLD_MAP_LABEL_TINT: [number, number, number] = [0, 0, 0];
export const WORLD_MAP_LABEL_QUADS = {
    data: new Float32Array(16 * 512),
    quadCount: 0,
};
