import type { CSSProperties } from "react";
import { getCanvasCssSize } from "../../common/utils/DeviceUtil";
import { alignPosition, alignSize, type WidgetLike } from "../../widgets/layout/WidgetLayout";
import type { OsrsClient } from "../OsrsClient";
import { RENDER_CONSTANTS } from "../../render/render/constants";
import { TimersPlugin } from "../plugins/statustimer/TimersPlugin";
import { adjustMobilePortraitWidget } from "../plugins/portraitmode/PortraitLayout";
import { TimersPosition } from "../plugins/statustimer/TimersConfig";
import { packTimers, timersScale } from "../plugins/statustimer/TimersLayout";
import { loadGameframePaneRedirect, STANDARD_GAMEFRAME_ROOT, SIDE_MODAL_CHILD } from "./gameframePanes";

const MOBILE_ROOT = 601;
const PVP_GROUP = 90;
/** The mobile main modal (601:27) hosts All Settings (134) and other main modals. */
const MOBILE_MAIN_MODAL = (MOBILE_ROOT << 16) | 27;
const ALL_SETTINGS_GROUP = 134;
/** Right-hand side-panel containers: the side modal (74), the popout panel (134) and the tab panes. */
const MOBILE_SIDE_PANES = [74, 134, ...Array.from({ length: 14 }, (_, index) => 116 + index)];
/** Space kept between the All Settings window and an open right-hand panel. */
const SIDE_PANEL_GAP = 8;
const PVP_WIDTH = 64;
const PVP_HEIGHT = 54;
export const COMBAT_INFOBOX_SIZE = 28;
const TIMER_SIZE = COMBAT_INFOBOX_SIZE - 2;
// Reserve the chatbox's native height even when collapsed, so its buttons never cover this row.
const HUD_TOP = 165 + 8;
const GAP = 4;

/** Phone-sized CSS controls grow with the native mobile gameframe on larger surfaces. */
export function mobileHudScale(
    root: number | undefined,
    cssWidth: number,
    layoutWidth: number | undefined,
): number {
    return root === MOBILE_ROOT && layoutWidth && cssWidth > 0
        ? Math.max(1, (cssWidth / layoutWidth) * RENDER_CONSTANTS.MOBILE_GAMEPLAY_UI_SCALE)
        : 1;
}

/** Count only enabled, visible timers so inactive effects leave no empty slots. */
export function combatTimerCount(client: OsrsClient, before = 7): number {
    return client.runeLite?.pluginManager.getPlugin(TimersPlugin)?.visibleInfoboxCount(before) ?? 0;
}

function nativeCombatStatusAnchor(client: OsrsClient):
    | {
          right: number;
          top: number;
          rowHeight: number;
          mobile: boolean;
          scaleX: number;
          scaleY: number;
      }
    | undefined {
    const manager = client.widgetManager;
    const canvas = client.renderer?.canvas;
    const minimap = manager?.minimapWidget;
    if (!canvas || !manager) return;
    const css = getCanvasCssSize(canvas);
    const sx = canvas.width / css.width;
    const sy = canvas.height / css.height;
    const hudScale = mobileHudScale(manager.rootInterface, css.width, manager.canvasWidth);
    const scale = { scaleX: sx * hudScale, scaleY: sy * hudScale };
    if (manager.rootInterface === MOBILE_ROOT) {
        const anchor = {
            right: ((8 + PVP_WIDTH) * canvas.width) / manager.canvasWidth + GAP * sx * hudScale,
            top: (HUD_TOP * canvas.height) / manager.canvasHeight,
            rowHeight:
                Math.max(
                    (PVP_HEIGHT * canvas.height) / manager.canvasHeight,
                    COMBAT_INFOBOX_SIZE * sy * hudScale,
                ) +
                GAP * sy * hudScale,
            mobile: true,
            ...scale,
        };
        return anchor;
    }
    if (
        !minimap?._absWidth ||
        !minimap.width ||
        minimap._absX === undefined ||
        minimap._absY === undefined ||
        !minimap._absHeight
    )
        return;
    const widgetScale = minimap._absWidth / minimap.width;
    const anchor = {
        right: minimap._absX + minimap._absWidth - 80 * widgetScale - GAP * sx,
        top: minimap._absY + minimap._absHeight + 8 * widgetScale,
        rowHeight:
            Math.max(PVP_HEIGHT * widgetScale, COMBAT_INFOBOX_SIZE * sy * hudScale) +
            GAP * sy * hudScale,
        mobile: false,
        ...scale,
    };
    return anchor;
}

type CombatAnchor = NonNullable<ReturnType<typeof nativeCombatStatusAnchor>>;

export function combatStatusAnchor(client: OsrsClient): CombatAnchor | undefined {
    const anchor = nativeCombatStatusAnchor(client);
    return anchor && reserveTimerRows(client, anchor);
}

function timerLayout(client: OsrsClient, anchor: CombatAnchor) {
    const canvas = client.renderer!.canvas;
    const css = getCanvasCssSize(canvas);
    const manager = client.widgetManager;
    const plugin = client.runeLite?.pluginManager.getPlugin(TimersPlugin);
    const configured = plugin?.config.position();
    const position = Object.values(TimersPosition).includes(configured!) ? configured : TimersPosition.COMBAT_ROW;
    const scale = mobileHudScale(manager.rootInterface, css.width, manager.canvasWidth) * timersScale(plugin?.config.scale() ?? 100);
    const sx = css.width / canvas.width;
    const sy = css.height / canvas.height;
    const top = anchor.top * sy;
    const margin = 8;
    const bounds = {
        left: anchor.mobile ? ((8 + PVP_WIDTH) * css.width) / manager.canvasWidth + GAP * scale : margin,
        top,
        right: anchor.mobile ? css.width - margin : anchor.right * sx,
        bottom: css.height - margin,
    };
    if (position !== TimersPosition.COMBAT_ROW) {
        bounds.left = margin;
        bounds.right = css.width - margin;
        bounds.top += anchor.rowHeight * sy;
        // Read the native chat geometry, rather than assuming a desktop size.
        for (const widget of manager.getAllGroupRoots?.(162) ?? []) {
                if (manager.isEffectivelyHidden(widget.uid) || !widget._absWidth || !widget._absHeight) continue;
                const y = (widget._absY ?? 0) * sy;
                if (y > bounds.top) bounds.bottom = Math.min(bounds.bottom, y - margin);
        }
        // Tabs replace their content interfaces. Reserve their native pane owners instead,
        // using the same cache redirects that mount them on each gameframe.
        const root = manager.rootInterface;
        const redirect = root === STANDARD_GAMEFRAME_ROOT ? undefined
            : loadGameframePaneRedirect(client.loaderFactory?.getEnumTypeLoader(), root);
        const sidePanes = [SIDE_MODAL_CHILD, ...Array.from({ length: 14 }, (_, i) => 76 + i)];
        for (const standardChild of sidePanes) {
            const child = root === STANDARD_GAMEFRAME_ROOT ? standardChild : redirect?.get(standardChild);
            if (child === undefined || child < 0) continue;
            const uid = (root << 16) | child;
            const widget = manager.getWidgetByUid?.(uid);
            if (!widget?._absWidth || !widget._absHeight || manager.isEffectivelyHidden(uid)) continue;
            const x = (widget._absX ?? 0) * sx;
            if (x > bounds.left) bounds.right = Math.min(bounds.right, x - margin);
        }
        if (anchor.mobile) bounds.bottom = Math.min(bounds.bottom, css.height - 64 * scale);
    }
    // An interface in a very short viewport must not create a negative packing rectangle.
    bounds.top = Math.max(margin, Math.min(bounds.top, css.height - margin - 28));
    bounds.bottom = Math.max(bounds.top + 1, bounds.bottom);
    bounds.right = Math.max(bounds.left + 1, bounds.right);
    const packed = packTimers(combatTimerCount(client), bounds, scale,
        position === TimersPosition.TOP_RIGHT || position === TimersPosition.BOTTOM_RIGHT ||
            (position === TimersPosition.COMBAT_ROW && !anchor.mobile),
        position === TimersPosition.BOTTOM_LEFT || position === TimersPosition.BOTTOM_RIGHT);
    return { ...packed, position, top: bounds.top };
}

/** Keep the shared Boosts corner below the whole wrapped/scaled upper timer group. */
function reserveTimerRows(client: OsrsClient, anchor: CombatAnchor): CombatAnchor {
    if (combatTimerCount(client) === 0) return anchor;
    const layout = timerLayout(client, anchor);
    if (layout.position === TimersPosition.BOTTOM_LEFT || layout.position === TimersPosition.BOTTOM_RIGHT) return anchor;
    const canvas = client.renderer!.canvas;
    const css = getCanvasCssSize(canvas);
    const timerBottom = layout.top + layout.height;
    return { ...anchor, rowHeight: Math.max(anchor.rowHeight, timerBottom * canvas.height / css.height - anchor.top + GAP * anchor.scaleY) };
}

/** All Settings (group 134) window; its script sizes it to the canvas minus the chat's height. */
const ALL_SETTINGS_WINDOW = (134 << 16) | 1;
/** Gaps kept above and below a window that grows into the space the hidden chat leaves. */
const HIDDEN_CHAT_WINDOW_TOP = 6;
const HIDDEN_CHAT_WINDOW_BOTTOM = 15;

type MobileHudManager = {
    getWidgetByUid(uid: number): WidgetLike | undefined;
    canvasHeight?: number;
    isMobileChatDisabled?: (() => boolean) | null;
    isEffectivelyHidden?(uid: number): boolean;
    getSubInterface?(uid: number): { group: number } | undefined;
    renderScaleX?: number;
};

type PositionedWidget = WidgetLike & { uid?: number; _absX?: number; _absWidth?: number };

/** Layout-space left edge of an open right-hand side panel, or undefined when none is open. */
export function openRightSidePanelLeft(
    manager: MobileHudManager,
    layoutW: number,
): number | undefined {
    const scale = manager.renderScaleX && manager.renderScaleX > 0 ? manager.renderScaleX : 1;
    let left: number | undefined;
    for (const child of MOBILE_SIDE_PANES) {
        const uid = (MOBILE_ROOT << 16) | child;
        const widget = manager.getWidgetByUid(uid) as PositionedWidget | undefined;
        if (!widget || !(widget._absWidth ?? 0)) continue;
        if (manager.isEffectivelyHidden?.(uid)) continue;
        if (!manager.getSubInterface?.(uid)?.group) continue;
        const x = (widget._absX ?? 0) / scale;
        // A portrait side panel sits along the bottom; only a right-hand panel constrains x.
        if (x < layoutW * 0.5) continue;
        left = left === undefined ? x : Math.min(left, x);
    }
    return left;
}

/** The main modal's own x before this adjuster shifted it, while All Settings is open. */
const shiftedMainModals = new WeakMap<WidgetLike, number>();

/**
 * Keep the mobile All Settings window clear of an open right-hand side panel. The cache
 * centres the main modal without reserving the side panel, so on a tablet at high interface
 * scaling the window covers the inventory/other side panel. Shift it left just enough to
 * clear the panel, never past the left edge, and restore it when either closes.
 */
function shiftMainModalFromSidePanel(
    node: WidgetLike,
    layoutW: number,
    manager: MobileHudManager,
): void {
    const allSettingsOpen = manager.getSubInterface?.(MOBILE_MAIN_MODAL)?.group === ALL_SETTINGS_GROUP;
    const panelLeft = allSettingsOpen ? openRightSidePanelLeft(manager, layoutW) : undefined;
    const shiftedFrom = shiftedMainModals.get(node);
    if (panelLeft === undefined) {
        if (shiftedFrom !== undefined) {
            node.rawX = shiftedFrom;
            node.x = shiftedFrom;
            shiftedMainModals.delete(node);
        }
        return;
    }
    const base = shiftedFrom ?? (node.rawX ?? node.x ?? 0);
    const width = node.width ?? 0;
    const desired = Math.max(SIDE_PANEL_GAP, panelLeft - SIDE_PANEL_GAP - width);
    if (desired < base) {
        if (shiftedFrom === undefined) shiftedMainModals.set(node, base);
        node.rawX = desired;
        node.x = desired;
    } else if (shiftedFrom !== undefined) {
        node.rawX = base;
        node.x = base;
        shiftedMainModals.delete(node);
    }
}

/** The raw values a window had before it was stretched, and the ones the stretch wrote. */
type StretchedWindow = {
    rawY: number;
    rawHeight: number;
    stretchedRawY: number;
    stretchedRawHeight: number;
};
const stretchedWindows = new WeakMap<WidgetLike, StretchedWindow>();
/** Nodes this hook has stretched; a cache script may rewrite their raw values on resize. */
const stretchedByUs = new WeakSet<WidgetLike>();

/**
 * Windows that reserve the chatbox's height keep doing so after the chat is hidden, leaving
 * the top of the screen empty. With the chat hidden, stretch such a window over the whole
 * screen height, leaving a small gap at the top and bottom. Never shrinks it.
 *
 * The stretch is written into the raw size and position, not just the computed ones: later
 * position-only layout passes re-centre the window from its raw values and would otherwise
 * push the stretched window off the bottom of the screen.
 */
export function extendWindowIntoHiddenChat(
    node: WidgetLike,
    parentW: number,
    parentH: number,
    screenH: number,
): void {
    const extended = screenH - HIDDEN_CHAT_WINDOW_TOP - HIDDEN_CHAT_WINDOW_BOTTOM;
    if ((node.heightMode ?? 0) !== 0 || (node.yPositionMode ?? 0) !== 1) {
        if (extended <= (node.height ?? 0)) return;
        node.height = extended;
        node.y = HIDDEN_CHAT_WINDOW_TOP;
        return;
    }
    let stretched = stretchedWindows.get(node);
    // A script that rewrote the raw values has laid the window out afresh.
    if (stretched && (node.rawY !== stretched.stretchedRawY || node.rawHeight !== stretched.stretchedRawHeight)) {
        stretched = undefined;
    }
    const rawY = stretched?.rawY ?? node.rawY ?? 0;
    const rawHeight = stretched?.rawHeight ?? node.rawHeight ?? 0;
    // A cache layout script may already have set this exact height from the canvas (the
    // Settings window sizes itself to the canvas minus the chat), while still centring it
    // in its much shorter parent. Take that height over, but correct the raw position.
    // A window this hook already stretched may shrink again when the scale grows; one that
    // was naturally taller than the space stays untouched.
    if (extended < (node.height ?? 0) && !stretchedByUs.has(node)) return;
    const stretchedRawY = HIDDEN_CHAT_WINDOW_TOP - ((parentH - extended) >> 1);
    node.rawHeight = extended;
    node.rawY = stretchedRawY;
    stretchedWindows.set(node, { rawY, rawHeight, stretchedRawY, stretchedRawHeight: extended });
    stretchedByUs.add(node);
    alignSize(node, parentW, parentH);
    alignPosition(node, parentW, parentH);
}

/** Undo extendWindowIntoHiddenChat once the chat is back, so the window returns to its own size. */
export function restoreWindowFromHiddenChat(node: WidgetLike, parentW: number, parentH: number): void {
    const stretched = stretchedWindows.get(node);
    if (!stretched) return;
    stretchedWindows.delete(node);
    stretchedByUs.delete(node);
    if (node.rawY !== stretched.stretchedRawY || node.rawHeight !== stretched.stretchedRawHeight) return;
    node.rawY = stretched.rawY;
    node.rawHeight = stretched.rawHeight;
    alignSize(node, parentW, parentH);
    alignPosition(node, parentW, parentH);
}

/** Post-cache alignment: keep the native skull, multi-combat icon, level and combat range. */
export function adjustMobileHudWidget(
    node: WidgetLike,
    parentW: number,
    parentH: number,
    manager: MobileHudManager,
): void {
    adjustMobilePortraitWidget(node, parentW, parentH);
    const uid = (node as WidgetLike & { uid?: number }).uid;
    if (uid === MOBILE_MAIN_MODAL) {
        shiftMainModalFromSidePanel(node, parentW, manager);
        return;
    }
    if (uid === ALL_SETTINGS_WINDOW) {
        if (manager.isMobileChatDisabled?.()) {
            extendWindowIntoHiddenChat(node, parentW, parentH, manager.canvasHeight || parentH);
        } else {
            restoreWindowFromHiddenChat(node, parentW, parentH);
        }
        return;
    }
    if (uid === undefined || uid >>> 16 !== PVP_GROUP) return;
    switch (uid & 0xffff) {
        case 43: {
            // pvp_icons:icons_dodger; compensate for the cache's inner margins.
            const parent = manager.getWidgetByUid((PVP_GROUP << 16) | 2);
            Object.assign(node, {
                x: 8 - (parent?.x ?? 0),
                y: HUD_TOP - (parent?.y ?? 0),
                width: PVP_WIDTH,
                height: PVP_HEIGHT,
            });
            break;
        }
        case 44: // pvp_icons:icons
            Object.assign(node, { x: 0, y: 0, width: PVP_WIDTH, height: PVP_HEIGHT });
            break;
        case 45: // Skull/safe-zone icon container.
            Object.assign(node, { x: (PVP_WIDTH - 20) / 2, y: 0, width: 20, height: 20 });
            break;
        case 46:
        case 47:
            Object.assign(node, { x: 0, y: 0, width: 20, height: 20 });
            break;
    }
}

/** CSS timers share the native PvP indicator's position, independent of device pixel density. */
export function mobileCombatTimerStyle(
    client: OsrsClient,
    slot: number,
): CSSProperties | undefined {
    const manager = client.widgetManager;
    const canvas = client.renderer?.canvas;
    if (!canvas || !manager?.canvasWidth || !manager.canvasHeight) return;
    const anchor = nativeCombatStatusAnchor(client);
    if (!anchor) return;
    const layout = timerLayout(client, anchor);
    const at = layout.slots[combatTimerCount(client, slot)];
    if (!at) return;
    return {
        transform: `scale(${layout.scale})`,
        transformOrigin: "top left",
        left: at.left,
        top: at.top,
        right: "auto",
        bottom: "auto",
        width: TIMER_SIZE,
        height: TIMER_SIZE,
    };
}
