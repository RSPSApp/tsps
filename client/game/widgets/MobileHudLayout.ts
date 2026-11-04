import type { CSSProperties } from "react";
import { getCanvasCssSize } from "../../common/utils/DeviceUtil";
import type { WidgetLike } from "../../widgets/layout/WidgetLayout";
import type { OsrsClient } from "../OsrsClient";
import { RENDER_CONSTANTS } from "../../render/render/constants";
import { TimersPlugin } from "../plugins/statustimer/TimersPlugin";
import { adjustMobilePortraitWidget } from "../plugins/portraitmode/PortraitLayout";

const MOBILE_ROOT = 601;
const PVP_GROUP = 90;
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
export function combatTimerCount(client: OsrsClient, before = 6): number {
    return client.runeLite?.pluginManager.getPlugin(TimersPlugin)?.visibleInfoboxCount(before) ?? 0;
}

export function combatStatusAnchor(client: OsrsClient):
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
        return {
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
    return {
        right: minimap._absX + minimap._absWidth - 80 * widgetScale - GAP * sx,
        top: minimap._absY + minimap._absHeight + 8 * widgetScale,
        rowHeight:
            Math.max(PVP_HEIGHT * widgetScale, COMBAT_INFOBOX_SIZE * sy * hudScale) +
            GAP * sy * hudScale,
        mobile: false,
        ...scale,
    };
}

/** Post-cache alignment: keep the native skull, multi-combat icon, level and combat range. */
export function adjustMobileHudWidget(
    node: WidgetLike,
    parentW: number,
    parentH: number,
    manager: { getWidgetByUid(uid: number): WidgetLike | undefined },
): void {
    adjustMobilePortraitWidget(node, parentW, parentH);
    const uid = (node as WidgetLike & { uid?: number }).uid;
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
    const css = getCanvasCssSize(canvas);
    slot = combatTimerCount(client, slot);
    if (manager.rootInterface !== MOBILE_ROOT) {
        const anchor = combatStatusAnchor(client);
        if (!anchor) return;
        return {
            left: Math.max(
                8,
                (anchor.right * css.width) / canvas.width - TIMER_SIZE - slot * (TIMER_SIZE + GAP),
            ),
            top: (anchor.top * css.height) / canvas.height,
            right: "auto",
            bottom: "auto",
            width: TIMER_SIZE,
            height: TIMER_SIZE,
        };
    }
    const scale = mobileHudScale(manager.rootInterface, css.width, manager.canvasWidth);
    return {
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        left:
            ((8 + PVP_WIDTH) * css.width) / manager.canvasWidth +
            (GAP + slot * (TIMER_SIZE + GAP)) * scale,
        top: (HUD_TOP * css.height) / manager.canvasHeight,
        right: "auto",
        bottom: "auto",
        width: TIMER_SIZE,
        height: TIMER_SIZE,
    };
}
