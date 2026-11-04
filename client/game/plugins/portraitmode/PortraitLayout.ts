import { CONFIG_PREFIX } from "@runelite/client/config/ConfigManager";
import { alignPosition, alignSize, type WidgetLike } from "../../../widgets/layout/WidgetLayout";

/**
 * Portrait arrangement of the mobile gameframe (toplevel_osm, 601).
 *
 * The cache only lays 601 out for a landscape phone: chat bottom-left, minimap top-right,
 * two columns of tab stones on the right edge with the side panel beside them. On an upright
 * phone that leaves everything crammed against the short edges, so after the cache layout
 * this moves the gameframe's panes:
 *
 *   chat across the top, the minimap and orbs bottom-left above two rows of tab stones,
 *   and the side panel (inventory etc.) bottom-right. Left-handed mode swaps those sides.
 *
 * Only computed geometry and the fold arrow's display angle change after layout,
 * so the cs2 that drives these panes keeps working: its raw values, hides and
 * scripts are untouched, and every relayout reapplies the arrangement.
 */

const ROOT = 601;
const uidOf = (child: number) => ((ROOT << 16) | child) >>> 0;

/** toplevel_osm components (gameval names). */
export const PORTRAIT_COMPONENTS = {
    safezone: uidOf(19),
    mapContainer: uidOf(22),
    hudContainerFront: uidOf(26),
    mainModal: uidOf(27),
    mainCrm: uidOf(28),
    sideLeftChat: uidOf(41),
    chatContainer: uidOf(49),
    sideRightTabs: uidOf(50),
    tabsGroupRight: uidOf(61),
    tabsGroupLeft: uidOf(87),
    tabsToggleArrow: uidOf(110),
    sideContainer: uidOf(111),
} as const;

/** Gap kept between the panes and the gameframe's edges, in layout px. */
const EDGE = 2;
/** side_right_tabs' cache width: two stone columns, which become two rows this tall. */
const TAB_ROWS_HEIGHT = 85;
/** Cache sizes of the panes along the bottom and the chat across the top. */
const MAP_HEIGHT = 207;
const SIDE_PANEL_HEIGHT = 275;
const CHAT_HEIGHT = 165;
/** The main modal's cache height (bank, shops...). */
const MAIN_MODAL_HEIGHT = 334;

/** Top of the minimap / side panel along the bottom, for a gameframe this tall. */
export function portraitBottomHudTop(frameH: number): number {
    return Math.min(frameH - TAB_ROWS_HEIGHT - MAP_HEIGHT - EDGE * 2, frameH - SIDE_PANEL_HEIGHT - EDGE);
}

type LayoutNode = WidgetLike & { uid?: number; parentUid?: number; spriteAngle?: number };

/** PortraitModePlugin's configKey; its enabled flag lives under the `runelite` config group. */
export const PORTRAIT_MODE_CONFIG_KEY = "portraitmode";

function readStoredEnabled(): boolean {
    try {
        return typeof localStorage !== "undefined" &&
            localStorage.getItem(`${CONFIG_PREFIX}runelite.${PORTRAIT_MODE_CONFIG_KEY}`) === "true";
    } catch {
        return false;
    }
}

/**
 * Whether the Portrait Mode plugin is on. Read from its stored enabled flag at load, because
 * the landscape lock and the first layout run before plugins start; the plugin keeps it current.
 */
let enabled = readStoredEnabled();
const enabledListeners = new Set<() => void>();

export function isPortraitModeEnabled(): boolean {
    return enabled;
}

export function setPortraitModeEnabled(value: boolean): void {
    if (enabled === value) return;
    enabled = value;
    for (const listener of [...enabledListeners]) listener();
}

export function subscribePortraitModeEnabled(listener: () => void): () => void {
    enabledListeners.add(listener);
    return () => enabledListeners.delete(listener);
}

let leftHanded = false;
const handednessListeners = new Set<() => void>();

export function isPortraitLeftHanded(): boolean { return leftHanded; }

export function setPortraitLeftHanded(value: boolean): void {
    if (leftHanded === value) return;
    leftHanded = value;
    for (const listener of handednessListeners) listener();
}

export function subscribePortraitHandedness(listener: () => void): () => void {
    handednessListeners.add(listener);
    return () => { handednessListeners.delete(listener); };
}

/** The bottom toolbar can make a nearly square portrait window's canvas wider than it is tall. */
export function isPortraitViewport(fallbackWidth: number, fallbackHeight: number): boolean {
    if (typeof window !== "undefined" && window.innerWidth > 0 && window.innerHeight > 0) {
        return window.innerHeight >= window.innerWidth;
    }
    return fallbackHeight >= fallbackWidth;
}

let active = false;
/** The tab group containers and their child containers, whose children are transposed into rows. */
const transposedParents = new Set<number>();

/** Whether the portrait arrangement is applied (mobile layout on a taller-than-wide surface). */
export function isMobilePortraitLayoutActive(): boolean {
    return active;
}

/**
 * Turn the arrangement on for a mobile layout surface taller than it is wide.
 * Returns whether that changed, so the caller can relayout.
 */
export function setMobilePortraitLayoutActive(value: boolean): boolean {
    if (active === value) return false;
    active = value;
    return true;
}

/**
 * Lay a widget out as if its parent were rotated a quarter turn, then swap the axes back:
 * a column of tab stones becomes a row. Containers swap their size too; graphics keep
 * theirs (sprites are not rotated) and only move.
 */
function transpose(w: LayoutNode, parentW: number, parentH: number): void {
    alignSize(w, parentH, parentW);
    alignPosition(w, parentH, parentW);
    const x = w.x ?? 0;
    const y = w.y ?? 0;
    w.x = y;
    w.y = x;
    if ((w.type ?? 0) === 0) {
        const width = w.width ?? 0;
        w.width = w.height ?? 0;
        w.height = width;
    } else {
        // Re-centre the sprite on the swapped slot, so a 33x36 icon stays in its 40x40 stone.
        const width = w.width ?? 0;
        const height = w.height ?? 0;
        w.x = (w.x ?? 0) + ((height - width) >> 1);
        w.y = (w.y ?? 0) + ((width - height) >> 1);
    }
}

/**
 * The layout adjuster (widgets/layout/WidgetLayout.ts): runs after each widget's cache
 * alignment, with the parent size it was aligned against.
 */
export function adjustMobilePortraitWidget(node: WidgetLike, parentW: number, parentH: number): void {
    const w = node as LayoutNode;
    const uid = w.uid;
    if (typeof uid !== "number" || uid >>> 16 !== ROOT) return;
    // The native left/right arrow becomes down/up, and resets when the phone turns sideways.
    if (uid === PORTRAIT_COMPONENTS.tabsToggleArrow) w.spriteAngle = active ? 16384 : 0;
    if (!active) {
        // Native scripts centre these on taller landscape surfaces; keep the responsive HUD bottom-aligned.
        if (enabled && (uid === PORTRAIT_COMPONENTS.sideContainer || uid === PORTRAIT_COMPONENTS.sideRightTabs)) {
            w.y = Math.max(0, parentH - (w.height ?? 0) - EDGE);
        }
        return;
    }

    const parentUid = w.parentUid ?? -1;
    if (parentUid !== -1 && transposedParents.has(parentUid >>> 0)) {
        transpose(w, parentW, parentH);
        if ((w.type ?? 0) === 0) transposedParents.add(uid >>> 0);
        return;
    }

    switch (uid >>> 0) {
        case PORTRAIT_COMPONENTS.safezone: {
            // The safezone script (4731) never lets the gameframe get narrower than 680,
            // the landscape minimum; a portrait screen is narrower than that.
            const x = w.x ?? 0;
            const width = w.width ?? 0;
            if (x + width > parentW) {
                w.x = Math.min(x, Math.max(0, parentW - width));
                w.width = Math.min(width, parentW - w.x);
            }
            break;
        }
        case PORTRAIT_COMPONENTS.hudContainerFront: {
            // Hosts the main modal (bank, shops), which centres itself in it. Landscape
            // keeps it between the chat buttons and the tab stones; portrait gives it the
            // whole width and the space between the chat and the bottom HUD. A screen too
            // short for both lets the modal cover the chat rather than its own inventory.
            const hudTop = portraitBottomHudTop(parentH);
            const top = Math.max(0, Math.min(CHAT_HEIGHT, hudTop - MAIN_MODAL_HEIGHT));
            w.x = 0;
            w.y = top;
            w.width = parentW;
            w.height = Math.max(0, hudTop - top);
            break;
        }
        case PORTRAIT_COMPONENTS.mainModal:
        case PORTRAIT_COMPONENTS.mainCrm: {
            // Landscape hangs it 64px below centre (raw y); portrait centres it in the space
            // the host leaves between chat and HUD.
            w.y = Math.max(0, (parentH - (w.height ?? 0)) >> 1);
            break;
        }
        case PORTRAIT_COMPONENTS.chatContainer: {
            // Across the top, full width.
            w.x = 0;
            w.y = 0;
            w.width = parentW;
            break;
        }
        case PORTRAIT_COMPONENTS.sideLeftChat: {
            // The logout / chat / keyboard buttons stay on the left edge, over the chat's
            // left end, where the chatbox leaves room for them.
            w.x = 0;
            break;
        }
        case PORTRAIT_COMPONENTS.sideRightTabs: {
            // Two rows of stones along the bottom, beside the inventory.
            const columnH = w.height ?? 0;
            // Native Show More/Less changes the columns' width (58/85); transpose that too.
            const rowsHeight = w.width ?? TAB_ROWS_HEIGHT;
            w.width = columnH;
            w.height = rowsHeight;
            w.x = leftHanded ? parentW - columnH - EDGE : EDGE;
            w.y = parentH - rowsHeight - EDGE;
            break;
        }
        case PORTRAIT_COMPONENTS.tabsGroupLeft:
        case PORTRAIT_COMPONENTS.tabsGroupRight: {
            transpose(w, parentW, parentH);
            transposedParents.add(uid >>> 0);
            break;
        }
        case PORTRAIT_COMPONENTS.mapContainer: {
            // Minimap and orbs above the tab rows.
            w.x = leftHanded ? parentW - (w.width ?? 0) - EDGE : EDGE;
            w.y = parentH - TAB_ROWS_HEIGHT - MAP_HEIGHT - EDGE * 2;
            break;
        }
        case PORTRAIT_COMPONENTS.sideContainer: {
            // The side panel goes opposite the minimap and tabs.
            w.x = leftHanded ? EDGE : parentW - (w.width ?? 0) - EDGE;
            w.y = parentH - (w.height ?? 0) - EDGE;
            break;
        }
    }
}
