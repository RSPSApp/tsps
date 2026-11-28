import type { CSSProperties } from "react";
import { getCanvasCssSize } from "../../common/utils/DeviceUtil";
import { alignPosition, alignSize, type WidgetLike } from "../../widgets/layout/WidgetLayout";
import type { OsrsClient } from "../OsrsClient";
import { RENDER_CONSTANTS } from "../../render/render/constants";
import { TimersPlugin } from "../plugins/statustimer/TimersPlugin";
import { adjustMobilePortraitWidget, isMobilePortraitLayoutActive } from "../plugins/portraitmode/PortraitLayout";
import { TimersPosition } from "../plugins/statustimer/TimersConfig";
import { packTimers, timersScale } from "../plugins/statustimer/TimersLayout";
import { loadGameframePaneRedirect, STANDARD_GAMEFRAME_ROOT, SIDE_MODAL_CHILD } from "./gameframePanes";

const MOBILE_ROOT = 601;
const PVP_GROUP = 90;
/** The mobile main modal (601:27) hosts All Settings (134) and other main modals. */
const MOBILE_MAIN_MODAL = (MOBILE_ROOT << 16) | 27;
const ALL_SETTINGS_GROUP = 134;
/** Cache proc mobile_mainmodal_open: closes the side panel when a main window cannot fit beside it. */
const MOBILE_MAINMODAL_OPEN_SCRIPT = 2527;
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
    getSubInterface?(uid: number): { group: number } | undefined;
};

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
    parentTop = 0,
): void {
    const extended = screenH - HIDDEN_CHAT_WINDOW_TOP - HIDDEN_CHAT_WINDOW_BOTTOM;
    // The window is positioned inside its parent, which does not start at the top of the screen
    // (the main modal sits well below it), so the gap above the window is measured from there.
    const top = HIDDEN_CHAT_WINDOW_TOP - parentTop;
    if ((node.heightMode ?? 0) !== 0 || (node.yPositionMode ?? 0) !== 1) {
        if (extended <= (node.height ?? 0)) return;
        node.height = extended;
        node.y = top;
        return;
    }
    let stretched = stretchedWindows.get(node);
    // A script that rewrote the raw values has laid the window out afresh. One that only
    // re-centred our stretched height (the resize script does, on every relayout) has not:
    // the sizes recorded before the stretch are still the ones to give back.
    if (stretched && node.rawHeight !== stretched.stretchedRawHeight) {
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
    const stretchedRawY = top - (((parentH - extended) / 2) | 0); // the inverse of layout's centring, which divides toward zero
    node.rawHeight = extended;
    node.rawY = stretchedRawY;
    stretchedWindows.set(node, { rawY, rawHeight, stretchedRawY, stretchedRawHeight: extended });
    stretchedByUs.add(node);
    alignSize(node, parentW, parentH);
    alignPosition(node, parentW, parentH);
}

/** The raw values the main modal had before it was made to fill its parent, and the ones the fill wrote. */
type FilledModal = { rawY: number; rawHeight: number; filledRawHeight: number };
const filledModals = new WeakMap<WidgetLike, FilledModal>();

/**
 * A window stretched over the space the hidden chat leaves is clipped to the main modal that
 * hosts it, a 512x334 box well below the top of the screen. While such a window is open, let
 * the modal take the whole height of its parent so the window shows in full.
 */
export function fillParentForStretchedWindow(node: WidgetLike, parentW: number, parentH: number): void {
    if ((node.heightMode ?? 0) !== 0 || (node.yPositionMode ?? 0) !== 1) return;
    let filled = filledModals.get(node);
    // A script that rewrote the raw size has laid the modal out afresh.
    if (filled && node.rawHeight !== filled.filledRawHeight) filled = undefined;
    const rawY = filled?.rawY ?? node.rawY ?? 0;
    const rawHeight = filled?.rawHeight ?? node.rawHeight ?? 0;
    if (rawHeight >= parentH) return;
    node.rawY = 0;
    node.rawHeight = parentH;
    filledModals.set(node, { rawY, rawHeight, filledRawHeight: parentH });
    alignSize(node, parentW, parentH);
    alignPosition(node, parentW, parentH);
}

/** Give the main modal its own size back once nothing stretched needs the room. */
export function restoreModalFromFilledParent(node: WidgetLike, parentW: number, parentH: number): void {
    const filled = filledModals.get(node);
    if (!filled) return;
    filledModals.delete(node);
    if (node.rawHeight !== filled.filledRawHeight) return;
    node.rawY = filled.rawY;
    node.rawHeight = filled.rawHeight;
    alignSize(node, parentW, parentH);
    alignPosition(node, parentW, parentH);
}

/** Undo extendWindowIntoHiddenChat once the chat is back, so the window returns to its own size. */
export function restoreWindowFromHiddenChat(node: WidgetLike, parentW: number, parentH: number): void {
    const stretched = stretchedWindows.get(node);
    if (!stretched) return;
    stretchedWindows.delete(node);
    stretchedByUs.delete(node);
    if (node.rawHeight !== stretched.stretchedRawHeight) return;
    node.rawY = stretched.rawY;
    node.rawHeight = stretched.rawHeight;
    alignSize(node, parentW, parentH);
    alignPosition(node, parentW, parentH);
}

/** The layout size the fit check last ran at, while All Settings stays open. */
const fitCheckedSizes = new WeakMap<object, string>();

/**
 * The cache runs mobile_mainmodal_open as a main window opens, but nothing runs it for All
 * Settings, so on an iPad the open side panel covered the window and its close button. Run it as
 * All Settings opens, and again when the layout changes size under it (interface scaling,
 * rotation). A panel the player reopens afterwards stays open.
 */
export function fitAllSettingsBesideSidePanel(
    manager: {
        rootInterface: number;
        canvasWidth: number;
        canvasHeight: number;
        getSubInterface(uid: number): { group: number } | undefined;
    },
    runScript: (scriptId: number) => void,
): void {
    const open =
        manager.rootInterface === MOBILE_ROOT &&
        // Portrait Mode stacks the panel under the window, which the cache's width test knows nothing of.
        !isMobilePortraitLayoutActive() &&
        manager.getSubInterface(MOBILE_MAIN_MODAL)?.group === ALL_SETTINGS_GROUP;
    if (!open) {
        fitCheckedSizes.delete(manager);
        return;
    }
    const size = `${manager.canvasWidth}x${manager.canvasHeight}`;
    if (fitCheckedSizes.get(manager) === size) return;
    fitCheckedSizes.set(manager, size);
    runScript(MOBILE_MAINMODAL_OPEN_SCRIPT);
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
        const allSettingsOpen = manager.getSubInterface?.(MOBILE_MAIN_MODAL)?.group === ALL_SETTINGS_GROUP;
        if (allSettingsOpen && manager.isMobileChatDisabled?.()) {
            fillParentForStretchedWindow(node, parentW, parentH);
        } else {
            restoreModalFromFilledParent(node, parentW, parentH);
        }
        return;
    }
    if (uid === ALL_SETTINGS_WINDOW) {
        if (manager.isMobileChatDisabled?.()) {
            const parentTop = manager.getWidgetByUid(MOBILE_MAIN_MODAL)?.y ?? 0;
            extendWindowIntoHiddenChat(node, parentW, parentH, manager.canvasHeight || parentH, parentTop);
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
