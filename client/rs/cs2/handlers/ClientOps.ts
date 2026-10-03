/**
 * Client operations: stats, inventory, world info, viewport, camera, settings
 */
import { PostProcessedObjTypeLoader } from "../../config/objtype/ObjTypeLoader";
import {
    ClientState,
    DEFAULT_SCREEN_HEIGHT,
    DEFAULT_SCREEN_WIDTH,
} from "../../../game/ClientState";
import { getClientClock } from "../../../game/TransmitCycles";
import { getSafeAreaBounds, isTouchDevice } from "../../../common/utils/DeviceUtil";
import { VARBIT_ROOF_REMOVAL } from "../../../common/vars";
import { MenuTargetType } from "../../MenuEntry";
import { chatHistory } from "../ChatHistory";
import { Opcodes } from "../Opcodes";
import type { HandlerMap } from "./HandlerTypes";

const DEVICE_OPTION_INTERFACE_SCALING = 27;
// Fixed layout toplevel (OSRS fixed mode).
const FIXED_GAMEFRAME_ROOT = 548;
const UIZOOM_DEFAULT_DESKTOP_PERCENT = 100;
const UIZOOM_DEFAULT_MOBILE_PERCENT = 175;
const UIZOOM_MAX_PERCENT = 400;
const BACKPACK_INVENTORY = 93;
const EQUIPMENT_INVENTORY = 94;
const BOOK_OF_THE_DEAD = 25818;
const SPELL_REQUIREMENT_SCRIPT = 19;

function getUiZoomDefaultPercent(ctx: any): number {
    const wm = ctx.widgetManager as any;
    return wm?.rootInterface === 601 || isTouchDevice
        ? UIZOOM_DEFAULT_MOBILE_PERCENT
        : UIZOOM_DEFAULT_DESKTOP_PERCENT;
}

function normalizeUiZoomPercent(percent: number, minPercent: number): number {
    if (!Number.isFinite(percent)) return minPercent;
    return Math.round(Math.max(minPercent, Math.min(UIZOOM_MAX_PERCENT, percent)));
}

export function registerClientOps(handlers: HandlerMap): void {
    // === Clock ===
    // clientclock returns Client.cycleCntr (20ms cycles)
    handlers.set(Opcodes.CLIENTCLOCK, (ctx) => {
        ctx.pushInt(getClientClock() | 0);
    });

    // === Idle timer ===
    // OSRS uses this for the AFK logout warning (script 5327: logout_timer_notifier).
    // Returns milliseconds remaining until idle logout.
    handlers.set(Opcodes.IDLETIMER_GET, (ctx) => {
        const getRemainingMs = ctx.getIdleTimerRemainingMs;
        if (!getRemainingMs) {
            throw new Error("IDLETIMER_GET requires ctx.getIdleTimerRemainingMs");
        }
        ctx.pushInt(getRemainingMs() | 0);
    });

    // === Stats ===
    handlers.set(Opcodes.STAT, (ctx) => {
        const skillId = ctx.intStack[--ctx.intStackSize];
        const level = ctx.getStatLevel?.(skillId) ?? 1;
        ctx.pushInt(level);
    });

    handlers.set(Opcodes.STAT_BASE, (ctx) => {
        const skillId = ctx.intStack[--ctx.intStackSize];
        const baseLevel = ctx.getStatBase?.(skillId) ?? 1;
        ctx.pushInt(baseLevel);
    });

    handlers.set(Opcodes.STAT_XP, (ctx) => {
        const skillId = ctx.intStack[--ctx.intStackSize];
        const xp = ctx.getStatXp?.(skillId) ?? 0;
        ctx.pushInt(xp);
    });

    handlers.set(Opcodes.STAT_BOOSTED, (ctx) => {
        // Returns the boosted/effective level for a skill (affected by potions/prayers)
        const skillId = ctx.intStack[--ctx.intStackSize];
        // If no boost tracking, return current level as fallback
        const boosted = ctx.getStatBoosted?.(skillId) ?? ctx.getStatLevel?.(skillId) ?? 1;
        ctx.pushInt(boosted);
    });

    // === Inventory ===
    // Common inventory IDs:
    // 93 = Backpack (inventory)
    // 94 = Equipment (worn items)
    // 95 = Bank
    // 90 = Trade offer (INVOTHER uses 90 + 32768 for the counterparty)
    // 516 = Shop
    // etc.
    handlers.set(Opcodes.INV_GETOBJ, (ctx) => {
        const slot = ctx.intStack[--ctx.intStackSize];
        const invId = ctx.intStack[--ctx.intStackSize];
        let itemId = -1;
        const inv = ctx.getInventory(invId);
        if (inv) {
            const item = inv.getSlot(slot);
            if (item) itemId = item.itemId;
        }
        ctx.pushInt(itemId);
    });

    handlers.set(Opcodes.INV_GETNUM, (ctx) => {
        const slot = ctx.intStack[--ctx.intStackSize];
        const invId = ctx.intStack[--ctx.intStackSize];
        let count = 0;
        const inv = ctx.getInventory(invId);
        if (inv) {
            const item = inv.getSlot(slot);
            if (item) count = item.quantity;
        }
        ctx.pushInt(count);
    });

    handlers.set(Opcodes.INV_TOTAL, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const invId = ctx.intStack[--ctx.intStackSize];
        let total = 0;
        const inv = ctx.getInventory(invId);
        if (inv) {
            total = inv.count(itemId);
        }

        // The cache spell-requirement script counts generic items in the backpack,
        // but Book of the dead is equipped in the shield slot.
        if (ctx.currentScriptId === SPELL_REQUIREMENT_SCRIPT && invId === BACKPACK_INVENTORY && itemId === BOOK_OF_THE_DEAD) {
            total = ctx.getInventory(EQUIPMENT_INVENTORY)?.count(itemId) ?? 0;
        }
        ctx.pushInt(total);
    });

    handlers.set(Opcodes.INV_SIZE, (ctx) => {
        const invId = ctx.intStack[--ctx.intStackSize];
        const inv = ctx.getInventory(invId);
        let size: number;
        if (inv) {
            size = inv.capacity;
        } else {
            // Default sizes for common inventories
            const defaultSizes: Record<number, number> = {
                93: 28, // Backpack
                94: 14, // Equipment (11 slots but indexed 0-13)
                95: 1410, // Bank (bankmain_build uses 1410 indexed slots)
                90: 28, // Trade offer
                516: 300, // Shop
            };
            size = defaultSizes[invId] ?? 0;
        }
        ctx.pushInt(size);
    });

    // INVOTHER operations - query another player's inventory (used in trade, duel, etc.)
    handlers.set(Opcodes.INVOTHER_GETOBJ, (ctx) => {
        const slot = ctx.intStack[--ctx.intStackSize];
        const invId = ctx.intStack[--ctx.intStackSize];
        // Try to get from inventories map - other player's inv may be stored with offset
        const inv = ctx.getInventory(invId + 32768); // OSRS convention for "other" inventories
        if (inv) {
            const item = inv.getSlot(slot);
            ctx.pushInt(item?.itemId ?? -1);
        } else {
            ctx.pushInt(-1);
        }
    });

    handlers.set(Opcodes.INVOTHER_GETNUM, (ctx) => {
        const slot = ctx.intStack[--ctx.intStackSize];
        const invId = ctx.intStack[--ctx.intStackSize];
        const inv = ctx.getInventory(invId + 32768);
        if (inv) {
            const item = inv.getSlot(slot);
            ctx.pushInt(item?.quantity ?? 0);
        } else {
            ctx.pushInt(0);
        }
    });

    handlers.set(Opcodes.INVOTHER_TOTAL, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const invId = ctx.intStack[--ctx.intStackSize];
        const inv = ctx.getInventory(invId + 32768);
        if (inv) {
            ctx.pushInt(inv.count(itemId));
        } else {
            ctx.pushInt(0);
        }
    });

    // === Coordinates ===
    // COORD returns the local player's current packed coordinate
    // Does NOT pop from stack - returns player position directly
    handlers.set(Opcodes.COORD, (ctx) => {
        // return the local player's packed world coordinate.
        // In this client, ctx.getPlayerLocalX/Y already return world tile coords.
        const plane = ctx.getPlayerPlane?.() ?? 0;
        const localX = ctx.getPlayerLocalX?.() ?? 0;
        const localY = ctx.getPlayerLocalY?.() ?? 0;
        const worldX = localX | 0;
        const worldY = localY | 0;
        const packed = (plane << 28) | (worldX << 14) | worldY;
        ctx.pushInt(packed);
    });

    handlers.set(Opcodes.COORDX, (ctx) => {
        const packed = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt((packed >> 14) & 0x3fff);
    });

    handlers.set(Opcodes.COORDY, (ctx) => {
        const packed = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(packed & 0x3fff);
    });

    handlers.set(Opcodes.COORDZ, (ctx) => {
        const packed = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt((packed >> 28) & 0x3);
    });

    handlers.set(Opcodes.MOVECOORD, (ctx) => {
        const y = ctx.intStack[--ctx.intStackSize];
        const plane = ctx.intStack[--ctx.intStackSize];
        const x = ctx.intStack[--ctx.intStackSize];
        const packed = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(packed + ((plane << 28) | (x << 14) | y));
    });

    // === World info ===
    handlers.set(Opcodes.MAP_WORLD, (ctx) => {
        ctx.pushInt(301);
    });

    handlers.set(Opcodes.MAP_MEMBERS, (ctx) => {
        ctx.pushInt(PostProcessedObjTypeLoader.membersWorld ? 1 : 0);
    });

    handlers.set(Opcodes.STAFFMODLEVEL, (ctx) => {
        ctx.pushInt(0);
    });

    handlers.set(Opcodes.REBOOTTIMER, (ctx) => {
        ctx.pushInt(-1);
    });

    handlers.set(Opcodes.PLAYERMOD, (ctx) => {
        ctx.pushInt(0);
    });

    handlers.set(Opcodes.WORLDFLAGS, (ctx) => {
        ctx.pushInt(0);
    });

    handlers.set(Opcodes.RUNENERGY_VISIBLE, (ctx) => {
        // OSRS stores run energy as 0-10000 internally, divides by 100 for display (0-100)
        const energy = ctx.getRunEnergy?.() ?? 10000;
        ctx.pushInt((energy / 100) | 0);
    });

    handlers.set(Opcodes.RUNENERGY, (ctx) => {
        // Raw run energy value (0-10000), not divided
        const energy = ctx.getRunEnergy?.() ?? 10000;
        ctx.pushInt(energy);
    });

    handlers.set(Opcodes.RUNWEIGHT_VISIBLE, (ctx) => {
        // Return player weight in kg (can be negative with weight-reducing items)
        ctx.pushInt(ctx.getWeight?.() ?? 0);
    });

    // === Minimap ===
    handlers.set(Opcodes.MINIMAP_SETZOOMABLE, (ctx) => {
        const enabled = ctx.intStack[--ctx.intStackSize] !== 0;
        const setZoomable = ctx.setMinimapZoomable;
        if (!setZoomable) {
            throw new Error("MINIMAP_SETZOOMABLE requires ctx.setMinimapZoomable");
        }
        setZoomable(enabled);
    });

    handlers.set(Opcodes.MINIMAP_SETZOOM, (ctx) => {
        const zoom = ctx.intStack[--ctx.intStackSize];
        const setZoom = ctx.setMinimapZoom;
        if (!setZoom) {
            throw new Error("MINIMAP_SETZOOM requires ctx.setMinimapZoom");
        }
        setZoom(zoom);
    });

    handlers.set(Opcodes.MINIMAP_GETZOOM, (ctx) => {
        const getZoom = ctx.getMinimapZoom;
        if (!getZoom) {
            throw new Error("MINIMAP_GETZOOM requires ctx.getMinimapZoom");
        }
        ctx.pushInt(getZoom() | 0);
    });

    handlers.set(Opcodes.MINIMAP_SETICONZOOMLIMIT, (ctx) => {
        const limit = ctx.intStack[--ctx.intStackSize];
        const setLimit = ctx.setMinimapIconZoomLimit;
        if (!setLimit) {
            throw new Error("MINIMAP_SETICONZOOMLIMIT requires ctx.setMinimapIconZoomLimit");
        }
        setLimit(limit);
    });

    // === Viewport ===
    handlers.set(Opcodes.VIEWPORT_GETEFFECTIVESIZE, (ctx) => {
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        const camera = osrsClient?.camera;
        const vw = ctx.widgetManager.viewportWidget;
        // In OSRS the canvas buffer and widget layout share the same coordinate
        // space, so viewport_geteffectivesize returns values that CS2 scripts can
        // use directly with if_setsize.  Our renderer may use a higher-resolution
        // backing store (HiDPI), so we compute FOV metrics at buffer resolution
        // for correct camera behaviour but return layout-space dimensions to CS2.
        const rendererCanvas = osrsClient?.renderer?.canvas;
        const layoutWidth = Number(ctx.widgetManager.canvasWidth);
        const layoutHeight = Number(ctx.widgetManager.canvasHeight);
        const scaleX =
            rendererCanvas &&
            Number.isFinite(layoutWidth) &&
            layoutWidth > 0 &&
            rendererCanvas.width > 0
                ? rendererCanvas.width / layoutWidth
                : 1;
        const scaleY =
            rendererCanvas &&
            Number.isFinite(layoutHeight) &&
            layoutHeight > 0 &&
            rendererCanvas.height > 0
                ? rendererCanvas.height / layoutHeight
                : 1;
        if (camera && vw) {
            // Compute FOV/clamping at full buffer resolution
            const bufViewportW = Math.max(1, Math.round((vw.width | 0) * scaleX));
            const bufViewportH = Math.max(1, Math.round((vw.height | 0) * scaleY));
            const metrics = camera.computeViewportMetricsForSize(bufViewportW, bufViewportH);
            // Scale the effective dimensions back to layout space for CS2
            const effectiveW = Math.max(1, Math.round(metrics.viewportWidth / scaleX));
            const effectiveH = Math.max(1, Math.round(metrics.viewportHeight / scaleY));
            ctx.pushInt(effectiveW);
            ctx.pushInt(effectiveH);
        } else if (camera && (camera.viewportWidth | 0) > 0 && (camera.viewportHeight | 0) > 0) {
            // No viewport widget: setRootInterface() clears it, so every root swap (the
            // Welcome Screen) lands here. The camera's dimensions are buffer-resolution,
            // so they need the same scale-back as the branch above - handing CS2 raw
            // buffer pixels makes scripts size gameframe containers at 2x on HiDPI.
            ctx.pushInt(Math.max(1, Math.round((camera.viewportWidth | 0) / scaleX)));
            ctx.pushInt(Math.max(1, Math.round((camera.viewportHeight | 0) / scaleY)));
        } else {
            ctx.pushInt(-1);
            ctx.pushInt(-1);
        }
    });

    handlers.set(Opcodes.VIEWPORT_GETZOOM, (ctx) => {
        const range = ctx.getViewportZoomRange();
        ctx.pushInt(range.min);
        ctx.pushInt(range.max);
    });

    handlers.set(Opcodes.VIEWPORT_GETFOV, (ctx) => {
        const values = ctx.getViewportFovValues();
        ctx.pushInt(values.low);
        ctx.pushInt(values.high);
    });

    handlers.set(Opcodes.VIEWPORT_SETZOOM, (ctx) => {
        const max = ctx.popInt();
        const min = ctx.popInt();
        ctx.setViewportZoomRange(min, max);
    });

    handlers.set(Opcodes.VIEWPORT_SETFOV, (ctx) => {
        const high = ctx.popInt();
        const low = ctx.popInt();
        ctx.setViewportFovValues(low, high);
    });

    handlers.set(Opcodes.VIEWPORT_CLAMPFOV, (ctx) => {
        // viewport_clampfov(fovClampMin, fovClampMax, zoomClampMin, zoomClampMax)
        // Sets the FOV and zoom clamp values for the camera
        const zoomClampMax = ctx.intStack[--ctx.intStackSize];
        const zoomClampMin = ctx.intStack[--ctx.intStackSize];
        const fovClampMax = ctx.intStack[--ctx.intStackSize];
        const fovClampMin = ctx.intStack[--ctx.intStackSize];
        ctx.setViewportClampFov?.(fovClampMin, fovClampMax, zoomClampMin, zoomClampMax);
    });

    handlers.set(Opcodes.UIZOOM_SET, (ctx) => {
        const minPercent = getUiZoomDefaultPercent(ctx);
        const percent = normalizeUiZoomPercent(ctx.intStack[--ctx.intStackSize], minPercent);
        ctx.setDeviceOption?.(DEVICE_OPTION_INTERFACE_SCALING, percent);
    });

    handlers.set(Opcodes.UIZOOM_GET, (ctx) => {
        const minPercent = getUiZoomDefaultPercent(ctx);
        const percent = ctx.getDeviceOption?.(DEVICE_OPTION_INTERFACE_SCALING) ?? minPercent;
        ctx.pushInt(normalizeUiZoomPercent(percent, minPercent));
    });

    handlers.set(Opcodes.UIZOOM_RESET, (ctx) => {
        ctx.setDeviceOption?.(DEVICE_OPTION_INTERFACE_SCALING, getUiZoomDefaultPercent(ctx));
    });

    handlers.set(Opcodes.UIZOOM_GETDEFAULT, (ctx) => {
        ctx.pushInt(getUiZoomDefaultPercent(ctx));
    });

    // === Canvas/Window ===
    handlers.set(Opcodes.GETCANVASSIZE, (ctx) => {
        const canvasWidth = ctx.canvasWidth ?? DEFAULT_SCREEN_WIDTH;
        const canvasHeight = ctx.canvasHeight ?? DEFAULT_SCREEN_HEIGHT;
        ctx.pushInt(canvasWidth);
        ctx.pushInt(canvasHeight);
    });

    handlers.set(Opcodes.GETWINDOWMODE, (ctx) => {
        // Fixed mode is a property of the active gameframe, so the root wins over
        // the local preference (the settings layout dropdown reads this back).
        const root = (ctx.widgetManager as any)?.rootInterface;
        if (root === FIXED_GAMEFRAME_ROOT) {
            ctx.pushInt(1);
            return;
        }
        const mode = ctx.windowMode ?? 2;
        ctx.pushInt(mode);
    });

    handlers.set(Opcodes.SETWINDOWMODE, (ctx) => {
        const mode = ctx.intStack[--ctx.intStackSize];
        ctx.setWindowMode?.(mode);
    });

    handlers.set(Opcodes.GETDEFAULTWINDOWMODE, (ctx) => {
        ctx.pushInt(2);
    });

    handlers.set(Opcodes.SETDEFAULTWINDOWMODE, (ctx) => {
        ctx.intStackSize--; // pop mode
    });

    // === Camera ===
    handlers.set(Opcodes.CAM_FORCEANGLE, (ctx) => {
        ctx.intStackSize -= 2;
        const camAngleX = ctx.intStack[ctx.intStackSize] | 0;
        const camAngleY = ctx.intStack[ctx.intStackSize + 1] | 0;
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        const camera = osrsClient?.camera;
        if (!camera) return;
        const clampedCamAngleX = Math.max(128, Math.min(383, camAngleX));
        const pitch = Math.max(
            0,
            Math.min(512, Math.floor(((clampedCamAngleX - 128) * 512) / 255)),
        );
        camera.snapToPitch(pitch);
        camera.snapToYaw(camAngleY & 2047);
    });

    handlers.set(Opcodes.CAM_GETANGLE_XA, (ctx) => {
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        const camera = osrsClient?.camera;
        if (!camera) {
            ctx.pushInt(128);
            return;
        }
        const pitch = Math.max(0, Math.min(512, camera.pitch | 0));
        const camAngleX = 128 + Math.floor((pitch * 255) / 512);
        ctx.pushInt(camAngleX | 0);
    });

    handlers.set(Opcodes.CAM_GETANGLE_YA, (ctx) => {
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        const camera = osrsClient?.camera;
        ctx.pushInt(camera ? (camera.yaw | 0) & 2047 : 0);
    });

    handlers.set(Opcodes.CAM_GETYAW, (ctx) => {
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        const camera = osrsClient?.camera;
        ctx.pushInt(camera ? (camera.yaw | 0) & 2047 : 0);
    });

    handlers.set(Opcodes.CAM_SETFOLLOWHEIGHT, (ctx) => {
        let followHeight = ctx.intStack[--ctx.intStackSize] | 0;
        if (followHeight < 0) {
            followHeight = 0;
        }
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        if (osrsClient) {
            osrsClient.camFollowHeight = followHeight;
        }
    });

    handlers.set(Opcodes.CAM_GETFOLLOWHEIGHT, (ctx) => {
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        const followHeight = osrsClient ? osrsClient.camFollowHeight | 0 : 50;
        ctx.pushInt(followHeight);
    });

    // === Client type ===
    // DEBUG: Track mobile/client type queries - log once
    let loggedOnMobile = false;
    let loggedClientType = false;
    // osm_simulate varbit (6352) allows desktop clients to simulate mobile mode
    const OSM_SIMULATE_VARBIT = 6352;
    handlers.set(Opcodes.ON_MOBILE, (ctx) => {
        // [proc,on_mobile] checks:
        // 1. %osm_simulate = 1 (desktop mobile simulation)
        // 2. clienttype = 7 (mobile client type)
        // 3. on_mobile opcode (touch device check)
        const wm = ctx.widgetManager as any;
        const isMobileInterface = wm?.rootInterface === 601;

        // Check osm_simulate varbit for desktop mobile simulation
        const osmSimulate = ctx.varManager?.getVarbit(OSM_SIMULATE_VARBIT) ?? 0;

        const result = osmSimulate === 1 || isMobileInterface || isTouchDevice ? 1 : 0;
        if (!loggedOnMobile) {
            loggedOnMobile = true;
            console.log(
                `[ON_MOBILE] result=${result} (osmSimulate=${osmSimulate}, rootInterface=${wm?.rootInterface}, isTouchDevice=${isTouchDevice})`,
            );
        }
        ctx.pushInt(result);
    });

    handlers.set(Opcodes.CLIENTTYPE, (ctx) => {
        // Client type constants:
        // 1 = desktop (standard Java client)
        // 2 = android
        // 3 = ios
        // 4 = enhanced (RuneLite/C++ client)
        // 5 = mac
        // 7 = mobile (generic - used by ~on_mobile proc)
        // 10 = steam/enhanced variant
        // Return 2 (android) for mobile interface or touch devices, 10 otherwise.
        // [proc,on_mobile] checks `clienttype = 7` as one condition.
        const wm = ctx.widgetManager as any;
        const isMobileInterface = wm?.rootInterface === 601;
        const result = isMobileInterface || isTouchDevice ? 2 : 10;
        if (!loggedClientType) {
            loggedClientType = true;
            console.log(
                `[CLIENTTYPE] result=${result} (isMobileInterface=${isMobileInterface}, isTouchDevice=${isTouchDevice})`,
            );
        }
        ctx.pushInt(result);
    });

    // === Mobile keyboard ===
    handlers.set(Opcodes.MOBILE_KEYBOARDHIDE, (ctx) => {
        ctx.hideMobileKeyboard?.();
    });

    // MOBILE_KEYBOARDSHOW (6522) - Shows the mobile keyboard for chat input
    // Stack: pops 1 string (hint text), 1 int (keyboard type)
    handlers.set(Opcodes.MOBILE_KEYBOARDSHOW, (ctx) => {
        const hint = String(ctx.stringStack[--ctx.stringStackSize] ?? "");
        const keyboardType = ctx.intStack[--ctx.intStackSize] | 0;
        ctx.showMobileKeyboard?.(hint, keyboardType);
    });

    // MOBILE_KEYBOARDSHOW2 (6523) - Alternative keyboard show variant
    // Stack: pops 1 string, 1 int (same as 6522)
    handlers.set(Opcodes.MOBILE_KEYBOARDSHOW2, (ctx) => {
        const hint = String(ctx.stringStack[--ctx.stringStackSize] ?? "");
        const keyboardType = ctx.intStack[--ctx.intStackSize] | 0;
        ctx.showMobileKeyboard?.(hint, keyboardType);
    });

    handlers.set(Opcodes.MOBILE_SETFPS, (ctx) => {
        // Historically a no-op (stack pop only). Applying the script value caps desktop
        // at ~20 FPS after login. Keep mobile battery caps via explicit UI later if needed.
        ctx.intStackSize--;
    });

    handlers.set(Opcodes.MOBILE_OPENSTORE, (ctx) => {});

    handlers.set(Opcodes.MOBILE_OPENSTORECATEGORY, (ctx) => {
        ctx.intStackSize -= 2;
    });

    handlers.set(Opcodes.MOBILE_BATTERYLEVEL, (ctx) => {
        ctx.pushInt(100);
    });

    handlers.set(Opcodes.MOBILE_BATTERYCHARGING, (ctx) => {
        ctx.pushInt(1);
    });

    handlers.set(Opcodes.MOBILE_WIFIAVAILABLE, (ctx) => {
        ctx.pushInt(1);
    });

    // === Keyboard state ===
    handlers.set(Opcodes.KEYHELD, (ctx) => {
        const keyCode = ctx.intStack[--ctx.intStackSize];
        // Check if key is currently held - delegate to input manager
        const held = ctx.inputManager?.isKeyHeld?.(keyCode) ?? false;
        ctx.pushInt(held ? 1 : 0);
    });

    handlers.set(Opcodes.KEYPRESSED, (ctx) => {
        const keyCode = ctx.intStack[--ctx.intStackSize];
        // Check if key was pressed this frame - delegate to input manager
        const pressed = ctx.inputManager?.wasKeyPressed?.(keyCode) ?? false;
        ctx.pushInt(pressed ? 1 : 0);
    });

    handlers.set(Opcodes.CLIENT_SET_SIDE_PANEL, (ctx) => {
        const interfaceId = ctx.intStack[--ctx.intStackSize];
        ctx.openMobileTab?.(interfaceId);
    });

    // === Settings ===
    handlers.set(Opcodes.MOUSECAM, (ctx) => {
        const enabled = ctx.intStack[--ctx.intStackSize] === 1;
        // Set mouse camera enabled/disabled (used by %mousecam_disabled varbit)
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        if (osrsClient) {
            osrsClient.mouseCamEnabled = enabled;
        }
    });

    handlers.set(Opcodes.SETTAPTODROP, (ctx) => {
        ctx.intStackSize--; // pop enabled
    });

    handlers.set(Opcodes.GETTAPTODROP, (ctx) => {
        ctx.pushInt(0);
    });

    handlers.set(Opcodes.SETSHIFTCLICKDROP, (ctx) => {
        ctx.intStackSize--; // pop enabled
    });

    handlers.set(Opcodes.SETREMOVEROOFS, (ctx) => {
        const enabled = ctx.intStack[--ctx.intStackSize] === 1;
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        if (osrsClient?.setRoofsHidden) {
            osrsClient.setRoofsHidden(enabled);
        }
        try {
            ctx.varManager?.setVarbit?.(VARBIT_ROOF_REMOVAL, enabled ? 1 : 0);
        } catch {
            /* varManager optional on some hosts */
        }
    });

    handlers.set(Opcodes.GETREMOVEROOFS, (ctx) => {
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        const hidden = osrsClient?.roofsHidden === true;
        ctx.pushInt(hidden ? 1 : 0);
    });

    handlers.set(Opcodes.RENDERSELF, (ctx) => {
        const enabled = ctx.intStack[--ctx.intStackSize] === 1;
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        if (osrsClient) {
            osrsClient.renderSelf = enabled;
        }
    });

    // Mobile feedback sprite configuration
    // setfeedbacksprite(graphic, showRipple) - sets click feedback sprite
    handlers.set(Opcodes.SETFEEDBACKSPRITE, (ctx) => {
        const showRipple = ctx.intStack[--ctx.intStackSize] === 1;
        ctx.stringStackSize--; // pop sprite graphic name
        // Store the feedback sprite settings
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        if (osrsClient) {
            osrsClient.feedbackShowRipple = showRipple;
        }
    });

    // setfeedbackshowpopuptext(enabled) - enables/disables popup text on feedback (mobile)
    handlers.set(Opcodes.SETFEEDBACKSHOWPOPUPTEXT, (ctx) => {
        const enabled = ctx.intStack[--ctx.intStackSize] === 1;
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        if (osrsClient) {
            osrsClient.feedbackShowPopupText = enabled;
        }
    });

    handlers.set(Opcodes.SETFOLLOWEROPSLOWPRIORITY, (ctx) => {
        const enabled = ctx.intStack[--ctx.intStackSize] === 1;
        ClientState.followerOpsLowPriority = enabled;
    });

    handlers.set(Opcodes.SETSHOWMOUSEOVERTEXT, (ctx) => {
        const enabled = ctx.intStack[--ctx.intStackSize] === 1;
        // Store the flag on OsrsClient (accessed via widgetManager.osrsClient)
        const osrsClient = (ctx.widgetManager as any).osrsClient;
        if (osrsClient) {
            osrsClient.showMouseOverText = enabled;
        }
    });

    handlers.set(Opcodes.SETSHOWMOUSECROSS, (ctx) => {
        ctx.intStackSize--; // pop enabled
    });

    handlers.set(Opcodes.SETSHOWLOADINGMESSAGES, (ctx) => {
        ctx.intStackSize--; // pop enabled
    });

    handlers.set(Opcodes.SETKEYINPUTENABLED, (ctx) => {
        ctx.intStackSize--; // pop enabled
    });

    // Key input mode control opcodes ()
    // These opcodes control the key input state for chatbox dialogs
    // Type 0 = no dialog active (all widgets can receive input)
    // Type 1 = default/reset state
    // Type 2 = interface-scoped (only widgets in specified interface)
    // Type 3 = widget-scoped (only specified widget can receive input)

    // Opcode 3138: SETKEYINPUTMODE_ALL - Clear input dialog (type 0)
    // No widgets are restricted, input mode is cleared
    handlers.set(Opcodes.SETKEYINPUTMODE_ALL, (ctx) => {
        ctx.cs2Vm.inputDialogType = 0;
        ctx.cs2Vm.inputDialogWidgetId = -1;
        ctx.cs2Vm.inputDialogString = "";
    });

    // Opcode 3139: SETKEYINPUTMODE_KEYBOARD - Enable keyboard input mode (type 1)
    // Used to enable chatbox input for typing
    handlers.set(Opcodes.SETKEYINPUTMODE_KEYBOARD, (ctx) => {
        ctx.cs2Vm.inputDialogType = 1;
    });

    // Opcode 3140: GETKEYINPUTMODE - Get current key input mode
    // Returns the current input dialog type
    handlers.set(Opcodes.GETKEYINPUTMODE, (ctx) => {
        ctx.pushInt(ctx.cs2Vm.inputDialogType);
    });

    handlers.set(Opcodes.SETFPSINTERFACEOVERLAY, (ctx) => {
        ctx.intStackSize--; // pop enabled
    });

    handlers.set(Opcodes.SETHIDETOOLTIP, (ctx) => {
        // Pop one int, no side effects.
        --ctx.intStackSize;
    });

    handlers.set(Opcodes.SETHIDEUSERNAME, (ctx) => {
        ctx.intStackSize--; // pop enabled
    });

    handlers.set(Opcodes.GETHIDEUSERNAME, (ctx) => {
        ctx.pushInt(0);
    });

    handlers.set(Opcodes.SETREMEMBERUSERNAME, (ctx) => {
        ctx.intStackSize--; // pop enabled
    });

    handlers.set(Opcodes.GETREMEMBERUSERNAME, (ctx) => {
        ctx.pushInt(1);
    });

    handlers.set(Opcodes.SHOW_IOS_REVIEW, () => {
        // No-op
    });

    // === Mobile Local Notifications ===
    // local_notification(id, delayMs, title, body) - schedules a push notification
    // Used by [proc,local_notification] (script 5360)
    handlers.set(Opcodes.LOCAL_NOTIFICATION, (ctx) => {
        const body = ctx.stringStack[--ctx.stringStackSize];
        const title = ctx.stringStack[--ctx.stringStackSize];
        const delayMs = ctx.intStack[--ctx.intStackSize];
        const id = ctx.intStack[--ctx.intStackSize];
        // No-op on web - would schedule a mobile push notification
        void id;
        void delayMs;
        void title;
        void body;
    });

    // local_notification_cancel(id) - cancels a scheduled notification
    handlers.set(Opcodes.LOCAL_NOTIFICATION_CANCEL, (ctx) => {
        ctx.intStackSize--; // pop id
    });

    // local_notification_cancelall() - cancels all scheduled notifications
    handlers.set(Opcodes.LOCAL_NOTIFICATION_CANCELALL, () => {
        // No-op
    });

    // local_notification_supported() -> boolean - checks if notifications are supported
    handlers.set(Opcodes.LOCAL_NOTIFICATION_SUPPORTED, (ctx) => {
        ctx.pushInt(0); // Not supported on web
    });

    // === Mouse position ===
    // returns mouse position in widget-logical coordinates.
    // InputManager coordinates are in canvas-buffer space; divide by the UI
    // render scale so CS2 scripts see positions matching the widget layout.
    handlers.set(Opcodes.MOUSE_GETX, (ctx) => {
        const osrsClient = (ctx.widgetManager as any)?.osrsClient;
        const mouseX = osrsClient?.inputManager?.mouseX;
        if (typeof mouseX !== "number") {
            ctx.pushInt(-1);
            return;
        }
        const layoutW = ctx.widgetManager?.canvasWidth ?? 0;
        const bufW: number = osrsClient?.renderer?.canvas?.width ?? layoutW;
        const scale = layoutW > 0 && bufW > 0 ? bufW / layoutW : 1;
        ctx.pushInt(scale > 1 ? Math.round(mouseX / scale) : mouseX | 0);
    });

    handlers.set(Opcodes.MOUSE_GETY, (ctx) => {
        const osrsClient = (ctx.widgetManager as any)?.osrsClient;
        const mouseY = osrsClient?.inputManager?.mouseY;
        if (typeof mouseY !== "number") {
            ctx.pushInt(-1);
            return;
        }
        const layoutH = ctx.widgetManager?.canvasHeight ?? 0;
        const bufH: number = osrsClient?.renderer?.canvas?.height ?? layoutH;
        const scale = layoutH > 0 && bufH > 0 ? bufH / layoutH : 1;
        ctx.pushInt(scale > 1 ? Math.round(mouseY / scale) : mouseY | 0);
    });

    const consumeHighlightSetup = (ctx: any) => {
        ctx.intStackSize -= 5;
    };
    const consumeHighlightInt1 = (ctx: any) => {
        ctx.intStackSize--;
    };
    const consumeHighlightInt2 = (ctx: any) => {
        ctx.intStackSize -= 2;
    };
    const consumeHighlightInt3 = (ctx: any) => {
        ctx.intStackSize -= 3;
    };
    const consumeHighlightInt4 = (ctx: any) => {
        ctx.intStackSize -= 4;
    };
    const consumeHighlightStringInt = (ctx: any) => {
        ctx.intStackSize--;
        ctx.stringStackSize--;
    };
    const consumeHighlightStringIntGet = (ctx: any) => {
        consumeHighlightStringInt(ctx);
        ctx.pushInt(0);
    };

    handlers.set(Opcodes.HIGHLIGHT_NPC_SETUP, consumeHighlightSetup);
    handlers.set(Opcodes.HIGHLIGHT_NPC_ON, consumeHighlightInt3);
    handlers.set(Opcodes.HIGHLIGHT_NPC_OFF, consumeHighlightInt3);
    handlers.set(Opcodes.HIGHLIGHT_NPC_GET, (ctx) => {
        consumeHighlightInt3(ctx);
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.HIGHLIGHT_NPC_CLEAR, consumeHighlightInt1);
    handlers.set(Opcodes.HIGHLIGHT_NPCTYPE_SETUP, consumeHighlightSetup);
    handlers.set(Opcodes.HIGHLIGHT_NPCTYPE_ON, consumeHighlightInt2);
    handlers.set(Opcodes.HIGHLIGHT_NPCTYPE_OFF, consumeHighlightInt2);
    handlers.set(Opcodes.HIGHLIGHT_NPCTYPE_GET, (ctx) => {
        consumeHighlightInt2(ctx);
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.HIGHLIGHT_NPCTYPE_CLEAR, consumeHighlightInt1);
    handlers.set(Opcodes.HIGHLIGHT_LOC_SETUP, consumeHighlightSetup);
    handlers.set(Opcodes.HIGHLIGHT_LOC_ON, consumeHighlightInt4);
    handlers.set(Opcodes.HIGHLIGHT_LOC_OFF, consumeHighlightInt4);
    handlers.set(Opcodes.HIGHLIGHT_LOC_GET, (ctx) => {
        consumeHighlightInt4(ctx);
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.HIGHLIGHT_LOC_CLEAR, consumeHighlightInt1);
    handlers.set(Opcodes.HIGHLIGHT_LOCTYPE_SETUP, consumeHighlightSetup);
    handlers.set(Opcodes.HIGHLIGHT_LOCTYPE_ON, consumeHighlightInt2);
    handlers.set(Opcodes.HIGHLIGHT_LOCTYPE_OFF, consumeHighlightInt2);
    handlers.set(Opcodes.HIGHLIGHT_LOCTYPE_GET, (ctx) => {
        consumeHighlightInt2(ctx);
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.HIGHLIGHT_LOCTYPE_CLEAR, consumeHighlightInt1);
    handlers.set(Opcodes.HIGHLIGHT_OBJ_SETUP, consumeHighlightSetup);
    handlers.set(Opcodes.HIGHLIGHT_OBJ_ON, consumeHighlightInt4);
    handlers.set(Opcodes.HIGHLIGHT_OBJ_OFF, consumeHighlightInt4);
    handlers.set(Opcodes.HIGHLIGHT_OBJ_GET, (ctx) => {
        consumeHighlightInt4(ctx);
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.HIGHLIGHT_OBJTYPE_SETUP, consumeHighlightSetup);
    handlers.set(Opcodes.HIGHLIGHT_OBJTYPE_ON, consumeHighlightInt2);
    handlers.set(Opcodes.HIGHLIGHT_OBJTYPE_OFF, consumeHighlightInt2);
    handlers.set(Opcodes.HIGHLIGHT_OBJTYPE_GET, (ctx) => {
        consumeHighlightInt2(ctx);
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.HIGHLIGHT_PLAYER_SETUP, consumeHighlightSetup);
    handlers.set(Opcodes.HIGHLIGHT_PLAYER_ON, consumeHighlightStringInt);
    handlers.set(Opcodes.HIGHLIGHT_PLAYER_OFF, consumeHighlightStringInt);
    handlers.set(Opcodes.HIGHLIGHT_PLAYER_GET, consumeHighlightStringIntGet);

    handlers.set(Opcodes.HIGHLIGHT_TILE_SETUP, (ctx) => {
        const flags = ctx.popInt();
        const alphaPercent = ctx.popInt();
        const thickness = ctx.popInt();
        const rawColor = ctx.popInt();
        const slot = ctx.popInt();
        ctx.configureTileHighlight(
            slot,
            rawColor >= 0 ? rawColor : undefined,
            thickness,
            alphaPercent,
            flags,
        );
    });

    handlers.set(Opcodes.HIGHLIGHT_TILE_ON, (ctx) => {
        const group = ctx.popInt();
        const slot = ctx.popInt();
        const coordPacked = ctx.popInt();
        ctx.setTileHighlight(coordPacked, slot, group);
    });

    handlers.set(Opcodes.HIGHLIGHT_TILE_OFF, (ctx) => {
        const group = ctx.popInt();
        const slot = ctx.popInt();
        const coordPacked = ctx.popInt();
        ctx.removeTileHighlight(coordPacked, slot, group);
    });

    handlers.set(Opcodes.HIGHLIGHT_TILE_GET, (ctx) => {
        const group = ctx.popInt();
        const slot = ctx.popInt();
        const coordPacked = ctx.popInt();
        ctx.pushInt(ctx.hasTileHighlight(coordPacked, slot, group) ? 1 : 0);
    });

    handlers.set(Opcodes.HIGHLIGHT_TILE_CLEAR, (ctx) => {
        const slot = ctx.popInt();
        ctx.clearTileHighlights(slot);
    });

    handlers.set(Opcodes.HIGHLIGHT_GROUP_SETUP, consumeHighlightSetup);
    handlers.set(Opcodes.HIGHLIGHT_GROUP_ON, consumeHighlightStringInt);
    handlers.set(Opcodes.HIGHLIGHT_GROUP_OFF, consumeHighlightStringInt);
    handlers.set(Opcodes.HIGHLIGHT_GROUP_GET, consumeHighlightStringIntGet);
    handlers.set(Opcodes.HIGHLIGHT_GROUP_CLEAR, consumeHighlightInt1);

    type MinMenuSnapshot = {
        option: string;
        target: string;
        numOps: number;
        type: number;
        hasComponentHover: boolean;
    };

    const getOsrsClient = (ctx: any): any => (ctx?.widgetManager as any)?.osrsClient;

    const getMinMenuEntryType = (entry: any): number => {
        const targetType =
            typeof entry?.targetType === "number" ? entry.targetType | 0 : MenuTargetType.NONE;
        switch (targetType) {
            case MenuTargetType.NPC:
                return 2;
            case MenuTargetType.LOC:
                return 3;
            case MenuTargetType.OBJ:
                return 4;
            case MenuTargetType.PLAYER:
                return 6;
            default: {
                const option = typeof entry?.option === "string" ? entry.option.toLowerCase() : "";
                return option === "walk here" ? 1 : 0;
            }
        }
    };

    const getInteractionCanvases = (osrsClient: any): any[] => {
        const renderer = osrsClient?.renderer as any;
        const widgetCanvas =
            typeof renderer?.getWidgetsGLCanvas === "function"
                ? renderer.getWidgetsGLCanvas()
                : undefined;
        const mainCanvas = renderer?.canvas;
        const canvases: any[] = [];
        if (widgetCanvas) canvases.push(widgetCanvas);
        if (mainCanvas && mainCanvas !== widgetCanvas) canvases.push(mainCanvas);
        return canvases;
    };

    const getUi = (osrsClient: any): any => {
        for (const canvasAny of getInteractionCanvases(osrsClient)) {
            if (canvasAny?.__ui) return canvasAny.__ui;
        }
        return undefined;
    };

    const getHoverTarget = (osrsClient: any): any => {
        for (const canvasAny of getInteractionCanvases(osrsClient)) {
            const clicks =
                (canvasAny?.__input as any)?.getClicks?.() ||
                (canvasAny?.__inputBridge as any)?.getClicks?.() ||
                canvasAny?.__clicks;
            if (!clicks) continue;
            // Re-pick at the live pointer position instead of trusting the cached
            // hover id: CS2 timers rebuild widget rows (e.g., the side journal),
            // which unregisters the hovered target and nulls the hover id while the
            // pointer is stationary - making the mouseover text vanish mid-hover.
            const ui = canvasAny?.__ui;
            if (
                typeof clicks.pick === "function" &&
                typeof ui?.mouseX === "number" &&
                typeof ui?.mouseY === "number"
            ) {
                const sxRaw = Number(canvasAny?.__uiInputScaleX ?? 1);
                const syRaw = Number(canvasAny?.__uiInputScaleY ?? 1);
                const sx = Number.isFinite(sxRaw) && sxRaw > 0 ? sxRaw : 1;
                const sy = Number.isFinite(syRaw) && syRaw > 0 ? syRaw : 1;
                const px = Math.round(ui.mouseX * sx);
                const py = Math.round(ui.mouseY * sy);
                // Prefer the topmost target with menu text: listener-only widgets
                // (e.g., the diary rows' hover-highlight rects) layer above the
                // op-bearing rows and would otherwise blank the minimenu.
                const hit =
                    clicks.pick(px, py, (t: any) => !!t?.primaryOption?.option) ||
                    clicks.pick(px, py);
                if (hit) return hit;
            }
            const hoverTarget = clicks?.getHoverTarget?.();
            if (hoverTarget) return hoverTarget;
        }
        return undefined;
    };

    const getMinMenuSnapshot = (ctx: any): MinMenuSnapshot => {
        const osrsClient = getOsrsClient(ctx);
        const hoverTarget = getHoverTarget(osrsClient);

        const hoverId = typeof hoverTarget?.id === "string" ? hoverTarget.id : "";
        const componentTargetFromClicks =
            hoverId.startsWith("widget:") || hoverId.startsWith("__menu_opt_");
        const hoveredWidgetsByUid: Map<number, any> | undefined = (osrsClient as any)
            ?.hoveredWidgetsByUid as Map<number, any> | undefined;
        const hasHoveredWidgetState = !!(hoveredWidgetsByUid && hoveredWidgetsByUid.size > 0);
        const hasComponentHover = componentTargetFromClicks || hasHoveredWidgetState;
        const primaryOption = hoverTarget?.primaryOption;
        let componentOption = typeof primaryOption?.option === "string" ? primaryOption.option : "";
        let componentTarget = typeof primaryOption?.target === "string" ? primaryOption.target : "";
        // CS2 mouseover scripts treat numops as actionable options (exclude Cancel).
        const componentNumOpsRaw =
            typeof hoverTarget?.menuOptionsCount === "number"
                ? Math.max(0, hoverTarget.menuOptionsCount | 0)
                : 0;
        const componentNumOps = Math.max(0, componentNumOpsRaw - 1);
        const componentHasText =
            componentOption.trim().length > 0 || componentTarget.trim().length > 0;

        // When hovering UI components, prefer component metadata. If there is no menu text
        // available, treat minimenu as empty so CS2 mouseover_text does not create stray top-left labels.
        if (hasComponentHover) {
            return {
                option: componentOption,
                target: componentTarget,
                numOps: componentHasText ? Math.max(componentNumOps, 1) : componentNumOps,
                type: componentHasText ? 7 : 0,
                hasComponentHover: true,
            };
        }

        const worldEntries: any[] = Array.isArray(osrsClient?.menuActiveSimpleEntries)
            ? (osrsClient.menuActiveSimpleEntries as any[])
            : [];
        let worldTop: any = undefined;
        let worldNumOps = 0;
        for (let i = 0; i < worldEntries.length; i++) {
            const row = worldEntries[i];
            const optionText = typeof row?.option === "string" ? row.option.trim() : "";
            if (optionText.toLowerCase() === "cancel") continue;
            worldNumOps++;
            if (!worldTop) worldTop = row;
        }
        if (!worldTop) worldTop = worldEntries[0];

        // when no actionable minimenu entries exist, selected item/spell still shows
        // "Use <item> ->" / "<spellAction> <spell> ->" hover text.
        if (worldNumOps <= 0) {
            if (ClientState.isItemSelected === 1) {
                const itemName = String(ClientState.selectedSpellName || "").trim();
                return {
                    option: "Use",
                    target: itemName.length > 0 ? `${itemName} ->` : "->",
                    numOps: 1,
                    type: 1,
                    hasComponentHover: false,
                };
            }
            if (ClientState.isSpellSelected) {
                const spellAction = String(ClientState.selectedSpellActionName || "Cast").trim();
                const spellName = String(ClientState.selectedSpellName || "").trim();
                return {
                    option: spellAction.length > 0 ? spellAction : "Cast",
                    target: spellName.length > 0 ? `${spellName} ->` : "->",
                    numOps: 1,
                    type: 1,
                    hasComponentHover: false,
                };
            }
        }

        const worldOption = typeof worldTop?.option === "string" ? worldTop.option : "";
        const worldTarget = typeof worldTop?.target === "string" ? worldTop.target : "";
        const worldTargetType =
            typeof worldTop?.targetType === "number"
                ? worldTop.targetType | 0
                : MenuTargetType.NONE;

        let worldType = 0;
        switch (worldTargetType) {
            case MenuTargetType.NPC:
                worldType = 2;
                break;
            case MenuTargetType.LOC:
                worldType = 3;
                break;
            case MenuTargetType.OBJ:
                worldType = 4;
                break;
            case MenuTargetType.PLAYER:
                worldType = 6;
                break;
            default: {
                const lower = worldOption.toLowerCase();
                worldType = lower === "walk here" ? 1 : 0;
                break;
            }
        }

        return {
            option: worldOption,
            target: worldTarget,
            numOps: Math.max(0, worldNumOps),
            type: worldType,
            hasComponentHover: false,
        };
    };

    const getMinMenuEntries = (ctx: any): any[] => {
        const osrsClient = getOsrsClient(ctx);
        const ui = getUi(osrsClient);
        const uiEntries =
            ui?.menu?.open === true && Array.isArray(ui?.menu?.entries)
                ? ui.menu.entries
                : undefined;
        if (uiEntries && uiEntries.length > 0) return uiEntries;
        if (
            osrsClient?.menuOpen === true &&
            Array.isArray(osrsClient?.menuPinnedEntries) &&
            osrsClient.menuPinnedEntries.length > 0
        ) {
            return osrsClient.menuPinnedEntries;
        }
        return Array.isArray(osrsClient?.menuActiveSimpleEntries)
            ? osrsClient.menuActiveSimpleEntries
            : [];
    };

    const getMinMenuEntryAt = (ctx: any, index: number): any => {
        const entries = getMinMenuEntries(ctx);
        if (entries.length === 0) return undefined;
        const safeIndex = Math.max(0, Math.min(entries.length - 1, index | 0));
        return entries[safeIndex];
    };

    const getMinMenuHoveredIndex = (ctx: any): number => {
        const osrsClient = getOsrsClient(ctx);
        const hoverTarget = getHoverTarget(osrsClient);
        const id = typeof hoverTarget?.id === "string" ? hoverTarget.id : "";
        const match = /^__menu_(?:opt|sub)_(\d+)$/.exec(id);
        if (!match) return -1;
        const index = Number(match[1]);
        return Number.isFinite(index) ? index | 0 : -1;
    };

    handlers.set(Opcodes.MINIMENU_ISOPEN, (ctx) => {
        const osrsClient = getOsrsClient(ctx);
        const ui = getUi(osrsClient);
        const menu: any = ui?.menu;
        const uiMenuOpen = !!(
            menu?.open &&
            Array.isArray(menu?.entries) &&
            menu.entries.length > 0
        );
        const isOpen = osrsClient?.menuOpen === true || uiMenuOpen;
        ctx.pushInt(isOpen ? 1 : 0);
    });

    handlers.set(Opcodes.MINIMENU_ENTRY, (ctx) => {
        const snap = getMinMenuSnapshot(ctx);
        ctx.pushString(snap.option);
        ctx.pushString(snap.target);
    });

    handlers.set(Opcodes.MINIMENU_NUMOPS, (ctx) => {
        const snap = getMinMenuSnapshot(ctx);
        ctx.pushInt(Math.max(0, snap.numOps | 0));
    });

    handlers.set(Opcodes.MINIMENU_TYPE, (ctx) => {
        const snap = getMinMenuSnapshot(ctx);
        ctx.pushInt(snap.type | 0);
    });

    handlers.set(Opcodes.MINIMENU_FINDCOMPONENT, (ctx) => {
        const snap = getMinMenuSnapshot(ctx);
        ctx.pushInt(snap.hasComponentHover ? 1 : 0);
    });

    handlers.set(Opcodes.MINIMENU_FINDNPC, (ctx) => {
        const snap = getMinMenuSnapshot(ctx);
        ctx.pushInt(!snap.hasComponentHover && (snap.type | 0) === 2 ? 1 : 0);
    });

    handlers.set(Opcodes.MINIMENU_FINDLOC, (ctx) => {
        const snap = getMinMenuSnapshot(ctx);
        ctx.pushInt(!snap.hasComponentHover && (snap.type | 0) === 3 ? 1 : 0);
    });

    handlers.set(Opcodes.MINIMENU_FINDOBJ, (ctx) => {
        const snap = getMinMenuSnapshot(ctx);
        ctx.pushInt(!snap.hasComponentHover && (snap.type | 0) === 4 ? 1 : 0);
    });

    handlers.set(Opcodes.MINIMENU_FINDPLAYER, (ctx) => {
        const snap = getMinMenuSnapshot(ctx);
        ctx.pushInt(!snap.hasComponentHover && (snap.type | 0) === 6 ? 1 : 0);
    });

    handlers.set(Opcodes.MINIMENU_TYPEAT, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(getMinMenuEntryType(getMinMenuEntryAt(ctx, index)));
    });

    handlers.set(Opcodes.MINIMENU_FINDNPCAT, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(getMinMenuEntryType(getMinMenuEntryAt(ctx, index)) === 2 ? 1 : 0);
    });

    handlers.set(Opcodes.MINIMENU_FINDLOCAT, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(getMinMenuEntryType(getMinMenuEntryAt(ctx, index)) === 3 ? 1 : 0);
    });

    handlers.set(Opcodes.MINIMENU_FINDOBJAT, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(getMinMenuEntryType(getMinMenuEntryAt(ctx, index)) === 4 ? 1 : 0);
    });

    handlers.set(Opcodes.MINIMENU_FINDPLAYERAT, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(getMinMenuEntryType(getMinMenuEntryAt(ctx, index)) === 6 ? 1 : 0);
    });

    handlers.set(Opcodes.MINIMENU_HOVERED_INDEX, (ctx) => {
        ctx.pushInt(getMinMenuHoveredIndex(ctx));
    });

    handlers.set(Opcodes.MINIMENU_SETBLOCKMODE, (ctx) => {
        const mode = ctx.intStack[--ctx.intStackSize] | 0;
        const block = ctx.intStack[--ctx.intStackSize] | 0;
        const osrsClient = getOsrsClient(ctx);
        if (osrsClient && block >= 0) {
            if (!Array.isArray(osrsClient.minimenuBlockModes)) osrsClient.minimenuBlockModes = [];
            osrsClient.minimenuBlockModes[block] = mode;
        }
    });

    handlers.set(Opcodes.MINIMENU_SETLEFTCLICKOPENS, (ctx) => {
        const enabled = ctx.intStack[--ctx.intStackSize] === 1;
        const osrsClient = getOsrsClient(ctx);
        if (osrsClient?.settings) {
            osrsClient.settings.leftClickOpensMenu = enabled;
        }
    });

    handlers.set(Opcodes.MINIMENU_RESETORDER, () => {
        // Menu order editing is tracked client-side when supported by the renderer.
    });

    handlers.set(Opcodes.MINIMENU_SETORDEREDIT, (ctx) => {
        const enabled = ctx.intStack[--ctx.intStackSize] === 1;
        const osrsClient = getOsrsClient(ctx);
        if (osrsClient) {
            osrsClient.minimenuOrderEdit = enabled;
        }
    });

    handlers.set(Opcodes.MINIMENU_TOGGLESCROLL, (ctx) => {
        const osrsClient = getOsrsClient(ctx);
        if (osrsClient) {
            osrsClient.minimenuScrollEnabled = !osrsClient.minimenuScrollEnabled;
        }
    });

    handlers.set(Opcodes.MINIMENU_GETSCROLL, (ctx) => {
        const osrsClient = getOsrsClient(ctx);
        ctx.pushInt(osrsClient?.minimenuScrollEnabled ? 1 : 0);
    });

    // === Safe Area (Mobile) ===
    // Returns safe-area BOUNDS (absolute coordinates in canvas space), matching OSRS semantics.
    // On cutout/notched devices this excludes unsafe areas; on normal displays this is full canvas.
    const getSafeBounds = (ctx: any) => {
        const rawWidth = Number(ctx.canvasWidth);
        const rawHeight = Number(ctx.canvasHeight);
        const canvasWidth = Number.isFinite(rawWidth) ? rawWidth : DEFAULT_SCREEN_WIDTH;
        const canvasHeight = Number.isFinite(rawHeight) ? rawHeight : DEFAULT_SCREEN_HEIGHT;
        return getSafeAreaBounds(canvasWidth, canvasHeight);
    };

    handlers.set(Opcodes.SAFEAREA_GETMINX, (ctx) => {
        ctx.pushInt(getSafeBounds(ctx).minX | 0);
    });

    handlers.set(Opcodes.SAFEAREA_GETMINY, (ctx) => {
        ctx.pushInt(getSafeBounds(ctx).minY | 0);
    });

    handlers.set(Opcodes.SAFEAREA_GETMAXX, (ctx) => {
        ctx.pushInt(getSafeBounds(ctx).maxX | 0);
    });

    handlers.set(Opcodes.SAFEAREA_GETMAXY, (ctx) => {
        ctx.pushInt(getSafeBounds(ctx).maxY | 0);
    });

    // Alternative safe area opcode (6231) - same as SAFEAREA_GETMAXY
    // Used in some mobile scripts (e.g., script 5355)
    handlers.set(Opcodes.SAFEAREA_GETMAXY_ALT, (ctx) => {
        ctx.pushInt(getSafeBounds(ctx).maxY | 0);
    });

    // Enhanced client-side context menu hooks.
    // These install/remove transient client-owned ops (Tag, Lookup, Mark tile, etc.).
    // We do not surface the enhanced desktop/mobile menu entries yet, but the cache relies on
    // these opcodes existing so unrelated scripts do not abort while wiring interface state.
    const consumeClientOpSet = (ctx: any) => {
        ctx.intStackSize -= 2; // slot, scriptId
        ctx.stringStackSize--; // label
    };
    const consumeClientOpDel = (ctx: any) => {
        ctx.intStackSize--; // slot
    };

    handlers.set(Opcodes.CLIENTOP_NPC_SET, consumeClientOpSet);
    handlers.set(Opcodes.CLIENTOP_NPC_DEL, consumeClientOpDel);
    handlers.set(Opcodes.CLIENTOP_LOC_SET, consumeClientOpSet);
    handlers.set(Opcodes.CLIENTOP_LOC_DEL, consumeClientOpDel);
    handlers.set(Opcodes.CLIENTOP_OBJ_SET, consumeClientOpSet);
    handlers.set(Opcodes.CLIENTOP_OBJ_DEL, consumeClientOpDel);
    handlers.set(Opcodes.CLIENTOP_PLAYER_SET, consumeClientOpSet);
    handlers.set(Opcodes.CLIENTOP_PLAYER_DEL, consumeClientOpDel);
    handlers.set(Opcodes.CLIENTOP_TILE_SET, consumeClientOpSet);
    handlers.set(Opcodes.CLIENTOP_TILE_DEL, consumeClientOpDel);

    handlers.set(Opcodes.LOGIN_LOGOUT_NOTIFY, (ctx) => {
        ctx.intStackSize--; // pop flag
    });

    handlers.set(Opcodes.LOGOUT, (ctx) => {
        ctx.requestLogout?.();
    });

    // === Direct Volume Control ===
    // setvolumemusic(volume) - volume is 0-127
    handlers.set(Opcodes.SETVOLUMEMUSIC, (ctx) => {
        const volume = ctx.intStack[--ctx.intStackSize];
        ctx.setMusicVolume?.(volume);
    });

    // getvolumemusic() -> volume (0-127)
    handlers.set(Opcodes.GETVOLUMEMUSIC, (ctx) => {
        const volume = ctx.getMusicVolume?.() ?? 0;
        ctx.pushInt(volume);
    });

    // setvolumesounds(volume) - volume is 0-127
    handlers.set(Opcodes.SETVOLUMESOUNDS, (ctx) => {
        const volume = ctx.intStack[--ctx.intStackSize];
        ctx.setSoundVolume?.(volume);
    });

    // getvolumesounds() -> volume (0-127)
    handlers.set(Opcodes.GETVOLUMESOUNDS, (ctx) => {
        const volume = ctx.getSoundVolume?.() ?? 0;
        ctx.pushInt(volume);
    });

    // setvolumeareasounds(volume) - volume is 0-127
    handlers.set(Opcodes.SETVOLUMEAREASOUNDS, (ctx) => {
        const volume = ctx.intStack[--ctx.intStackSize];
        ctx.setAreaSoundVolume?.(volume);
    });

    // getvolumeareasounds() -> volume (0-127)
    handlers.set(Opcodes.GETVOLUMEAREASOUNDS, (ctx) => {
        const volume = ctx.getAreaSoundVolume?.() ?? 0;
        ctx.pushInt(volume);
    });

    // === Client/Game/Device Options ===
    // These control engine-level settings like audio volume, brightness, etc.
    // clientoption_set(optionId, value)
    handlers.set(Opcodes.CLIENTOPTION_SET, (ctx) => {
        const value = ctx.intStack[--ctx.intStackSize];
        const optionId = ctx.intStack[--ctx.intStackSize];
        ctx.setClientOption?.(optionId, value);
    });

    // clientoption_get(optionId) -> value
    handlers.set(Opcodes.CLIENTOPTION_GET, (ctx) => {
        const optionId = ctx.intStack[--ctx.intStackSize];
        const value = ctx.getClientOption?.(optionId) ?? 0;
        ctx.pushInt(value);
    });

    // gameoption_set(optionId, value)
    handlers.set(Opcodes.GAMEOPTION_SET, (ctx) => {
        const value = ctx.intStack[--ctx.intStackSize];
        const optionId = ctx.intStack[--ctx.intStackSize];
        ctx.setGameOption?.(optionId, value);
    });

    // gameoption_get(optionId) -> value
    handlers.set(Opcodes.GAMEOPTION_GET, (ctx) => {
        const optionId = ctx.intStack[--ctx.intStackSize];
        const value = ctx.getGameOption?.(optionId) ?? 0;
        ctx.pushInt(value);
    });

    // deviceoption_set(optionId, value)
    handlers.set(Opcodes.DEVICEOPTION_SET, (ctx) => {
        const value = ctx.intStack[--ctx.intStackSize];
        const optionId = ctx.intStack[--ctx.intStackSize];
        ctx.setDeviceOption?.(optionId, value);
    });

    // deviceoption_get(optionId) -> value
    handlers.set(Opcodes.DEVICEOPTION_GET, (ctx) => {
        const optionId = ctx.intStack[--ctx.intStackSize];
        const value = ctx.getDeviceOption?.(optionId) ?? 0;
        ctx.pushInt(value);
    });

    // deviceoption_getrange(optionId) -> (min, max)
    handlers.set(Opcodes.DEVICEOPTION_GETRANGE, (ctx) => {
        const optionId = ctx.intStack[--ctx.intStackSize];
        if (optionId === DEVICE_OPTION_INTERFACE_SCALING) {
            ctx.pushInt(getUiZoomDefaultPercent(ctx));
            ctx.pushInt(UIZOOM_MAX_PERCENT);
            return;
        }
        ctx.pushInt(0);
        ctx.pushInt(100);
    });

    // === RT7 Enhanced Graphics (stubs for future) ===
    handlers.set(Opcodes.RT7_SETENABLED, (ctx) => {
        ctx.intStackSize--; // pop enabled flag
    });

    handlers.set(Opcodes.RT7_SD, (ctx) => {
        // Switch to SD mode - stub
    });

    handlers.set(Opcodes.RT7_HD, (ctx) => {
        // Switch to HD mode - stub
    });

    // === String Vectors ===
    const stringVectors = new Map<number, string[]>();
    const getStringVector = (id: number): string[] => {
        let values = stringVectors.get(id);
        if (!values) {
            values = [];
            stringVectors.set(id, values);
        }
        return values;
    };
    const normalizeVectorValue = (value: string, ignoreCase: boolean): string =>
        ignoreCase ? value.toLowerCase() : value;
    const vectorContains = (values: string[], value: string, ignoreCase: boolean): boolean => {
        const needle = normalizeVectorValue(value, ignoreCase);
        return values.some((candidate) => normalizeVectorValue(candidate, ignoreCase) === needle);
    };

    handlers.set(Opcodes.STRINGVECTOR_ADDUNIQUE, (ctx) => {
        const ignoreCase = ctx.popInt() !== 0;
        const vectorId = ctx.popInt() | 0;
        const value = String(ctx.popString() ?? "");
        const values = getStringVector(vectorId);
        if (!vectorContains(values, value, ignoreCase)) {
            values.push(value);
        }
    });

    handlers.set(Opcodes.STRINGVECTOR_REMOVE, (ctx) => {
        const ignoreCase = ctx.popInt() !== 0;
        const vectorId = ctx.popInt() | 0;
        const value = String(ctx.popString() ?? "");
        const values = getStringVector(vectorId);
        for (let i = values.length - 1; i >= 0; i--) {
            if (
                normalizeVectorValue(values[i], ignoreCase) ===
                normalizeVectorValue(value, ignoreCase)
            ) {
                values.splice(i, 1);
            }
        }
    });

    handlers.set(Opcodes.STRINGVECTOR_GET, (ctx) => {
        const index = ctx.popInt() | 0;
        const vectorId = ctx.popInt() | 0;
        ctx.pushString(getStringVector(vectorId)[index] ?? "");
    });

    handlers.set(Opcodes.STRINGVECTOR_SIZE, (ctx) => {
        const vectorId = ctx.popInt() | 0;
        ctx.pushInt(getStringVector(vectorId).length | 0);
    });

    handlers.set(Opcodes.STRINGVECTOR_CONTAINS, (ctx) => {
        const alternateMatch = ctx.popInt() !== 0;
        const ignoreCase = ctx.popInt() !== 0;
        const vectorId = ctx.popInt() | 0;
        const value = String(ctx.popString() ?? "");
        ctx.pushInt(
            vectorContains(getStringVector(vectorId), value, ignoreCase || alternateMatch) ? 1 : 0,
        );
    });

    handlers.set(Opcodes.STRINGVECTOR_CLEAR, (ctx) => {
        const vectorId = ctx.popInt() | 0;
        getStringVector(vectorId).length = 0;
    });

    // === Notification System ===
    // NOTIFICATIONS_SENDLOCAL (6800): Display a notification using the authentic OSRS CS2 system
    // Stack: pops 2 ints (unused args), 2 strings (body, title) in reverse order
    // Returns: notification ID (always 0 for now)
    handlers.set(Opcodes.NOTIFICATIONS_SENDLOCAL, (ctx) => {
        // Pop 2 unused int args (arg1, arg2)
        ctx.intStackSize -= 2;
        // Pop body and title strings
        const body = ctx.stringStack[--ctx.stringStackSize] ?? "";
        const title = ctx.stringStack[--ctx.stringStackSize] ?? "";

        // Default notification color (orange, same as loot notifications)
        const color = 0xff981f;

        // Trigger the notification via callback
        ctx.onNotificationDisplay?.(title, body, color);

        // Return notification ID (always 0 for now)
        ctx.pushInt(0);
    });

    // === Loot Tracker ===
    const consumeLootTrackerString = (ctx: any) => {
        ctx.stringStackSize--;
    };
    const consumeLootTrackerInt = (ctx: any) => {
        ctx.intStackSize--;
    };

    handlers.set(Opcodes.LOOTTRACKER_SOURCEADD, (ctx) => {
        ctx.intStackSize -= 3;
        ctx.stringStackSize--;
    });
    handlers.set(Opcodes.LOOTTRACKER_SOURCENAMECOUNT, (ctx) => {
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.LOOTTRACKER_SOURCENAME, (ctx) => {
        consumeLootTrackerInt(ctx);
        ctx.pushString("");
    });
    handlers.set(Opcodes.LOOTTRACKER_SOURCEID, (ctx) => {
        consumeLootTrackerString(ctx);
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.LOOTTRACKER_SOURCECOUNT, (ctx) => {
        consumeLootTrackerString(ctx);
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.LOOTTRACKER_SOURCEQUERY_NEW, (ctx) => {
        ctx.intStackSize -= 3;
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.LOOTTRACKER_SOURCEQUERY_GET, (ctx) => {
        consumeLootTrackerInt(ctx);
        ctx.pushInt(-1);
    });
    handlers.set(Opcodes.LOOTTRACKER_GETDROPLIMIT, (ctx) => {
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.LOOTTRACKER_LOOTCOUNT_BYNAME, (ctx) => {
        consumeLootTrackerString(ctx);
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.LOOTTRACKER_LOOTCOUNT_BYID, (ctx) => {
        consumeLootTrackerInt(ctx);
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.LOOTTRACKER_LOOTGET_BYNAME, (ctx) => {
        consumeLootTrackerInt(ctx);
        consumeLootTrackerString(ctx);
        ctx.pushInt(0);
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.LOOTTRACKER_LOOTGET_BYID, (ctx) => {
        ctx.intStackSize -= 2;
        ctx.pushInt(0);
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.LOOTTRACKER_LOOTDEL_BYNAME, consumeLootTrackerString);
    handlers.set(Opcodes.LOOTTRACKER_LOOTDEL_BYID, consumeLootTrackerInt);
    handlers.set(Opcodes.LOOTTRACKER_IGNORELOOTADD, consumeLootTrackerString);
    handlers.set(Opcodes.LOOTTRACKER_IGNORELOOTDEL, consumeLootTrackerString);
    handlers.set(Opcodes.LOOTTRACKER_IGNORELOOTCOUNT, (ctx) => {
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.LOOTTRACKER_IGNORELOOTGET, (ctx) => {
        consumeLootTrackerInt(ctx);
        ctx.pushString("");
    });
    handlers.set(Opcodes.LOOTTRACKER_IGNORELOOTCLEAR, () => {});
    handlers.set(Opcodes.LOOTTRACKER_IGNORESOURCEADD, consumeLootTrackerString);
    handlers.set(Opcodes.LOOTTRACKER_IGNORESOURCEDEL, consumeLootTrackerString);
    handlers.set(Opcodes.LOOTTRACKER_IGNORESOURCECOUNT, (ctx) => {
        ctx.pushInt(0);
    });
    handlers.set(Opcodes.LOOTTRACKER_IGNORESOURCEGET, (ctx) => {
        consumeLootTrackerInt(ctx);
        ctx.pushString("");
    });
    handlers.set(Opcodes.LOOTTRACKER_IGNORESOURCECLEAR, () => {});
    handlers.set(Opcodes.LOOTTRACKER_LOOTADD, (ctx) => {
        ctx.intStackSize -= 3;
        ctx.stringStackSize--;
    });
    handlers.set(Opcodes.LOOTTRACKER_SOURCEDROPNAME, (ctx) => {
        consumeLootTrackerInt(ctx);
        ctx.pushString("");
    });

    // === Sound ===
    // CS2: sound_synth(soundId, loops, delay) pushes [soundId, loops, delay]
    // Stack pops in reverse: delay, loops, soundId
    handlers.set(Opcodes.SOUND_SYNTH, (ctx) => {
        const delay = ctx.intStack[--ctx.intStackSize];
        const loops = ctx.intStack[--ctx.intStackSize];
        const soundId = ctx.intStack[--ctx.intStackSize];
        if (loops !== 0) ctx.playSoundEffect?.(soundId, delay, loops - 1);
    });

    // SOUND_SONG pops 5 params from stack
    handlers.set(Opcodes.SOUND_SONG, (ctx) => {
        const fadeInDuration = ctx.intStack[--ctx.intStackSize];
        const fadeInDelay = ctx.intStack[--ctx.intStackSize];
        const fadeOutDuration = ctx.intStack[--ctx.intStackSize];
        const fadeOutDelay = ctx.intStack[--ctx.intStackSize];
        const songId = ctx.intStack[--ctx.intStackSize]; // Track ID
        ctx.playSong?.(songId, fadeOutDelay, fadeOutDuration, fadeInDelay, fadeInDuration);
    });

    // SOUND_JINGLE pops jingleId and jingleDelay, then plays the jingle.
    handlers.set(Opcodes.SOUND_JINGLE, (ctx) => {
        const delay = ctx.intStack[--ctx.intStackSize];
        const jingleId = ctx.intStack[--ctx.intStackSize]; // Jingle track ID
        ctx.playJingle?.(jingleId, delay);
    });

    // MUSIC_STOP (3220) - Stop/fade current music
    handlers.set(Opcodes.MUSIC_STOP, (ctx) => {
        const fadeOutDuration = ctx.intStack[--ctx.intStackSize];
        const fadeOutDelay = ctx.intStack[--ctx.intStackSize];
        ctx.stopMusic?.(fadeOutDelay, fadeOutDuration);
    });

    // MUSIC_DUAL (3221) - Preload two tracks for crossfade
    handlers.set(Opcodes.MUSIC_DUAL, (ctx) => {
        const fadeInDuration = ctx.intStack[--ctx.intStackSize];
        const fadeInDelay = ctx.intStack[--ctx.intStackSize];
        const fadeOutDuration = ctx.intStack[--ctx.intStackSize];
        const fadeOutDelay = ctx.intStack[--ctx.intStackSize];
        const track2 = ctx.intStack[--ctx.intStackSize];
        const track1 = ctx.intStack[--ctx.intStackSize];
        ctx.playDualTracks?.(
            track1,
            track2,
            fadeOutDelay,
            fadeOutDuration,
            fadeInDelay,
            fadeInDuration,
        );
    });

    // MUSIC_CROSSFADE (3222) - Crossfade between the two loaded tracks
    handlers.set(Opcodes.MUSIC_CROSSFADE, (ctx) => {
        const fadeInDuration = ctx.intStack[--ctx.intStackSize];
        const fadeInDelay = ctx.intStack[--ctx.intStackSize];
        const fadeOutDuration = ctx.intStack[--ctx.intStackSize];
        const fadeOutDelay = ctx.intStack[--ctx.intStackSize];
        ctx.crossfadeTracks?.(fadeOutDelay, fadeOutDuration, fadeInDelay, fadeInDuration);
    });

    // Note: SOUND_VORBIS, SOUND_VORBIS_VOLUME, SOUND_SPEECH opcodes were removed
    // as their opcode numbers (3212-3214) conflict with DEVICEOPTION_SET, GAMEOPTION_SET, DEVICEOPTION_GET

    // === Misc client opcodes ===
    // MES opcode: Display a game message in the chatbox (type 0 = game message)
    handlers.set(Opcodes.MES, (ctx) => {
        const text = ctx.stringStack[--ctx.stringStackSize];
        // Add to chat history as a game message (type 0)
        chatHistory.addMessage(0, text);
    });

    handlers.set(Opcodes.ANIM, (ctx) => {
        ctx.intStackSize -= 2; // pop delay, animId
    });

    handlers.set(Opcodes.IF_CLOSE, (ctx) => {
        // defer close until script return.
        ctx.deferIfClose();
    });

    // RESUME_COUNTDIALOG (3104): Completes a numeric input dialog
    // Pops string from stack, converts to int, sends to server
    handlers.set(Opcodes.RESUME_COUNTDIALOG, (ctx) => {
        const inputString = ctx.stringStack[--ctx.stringStackSize] ?? "";
        const trimmed = inputString.trim();
        let value = 0;

        // Only parse if string is a valid number
        if (/^-?\d+$/.test(trimmed)) {
            value = parseInt(trimmed, 10);
            if (!Number.isFinite(value)) value = 0;
            // Clamp to signed 32-bit int range
            value = Math.max(-2147483648, Math.min(2147483647, value));
        }

        // Send to server via callback
        if (ctx.cs2Vm.onInputDialogComplete) {
            ctx.cs2Vm.onInputDialogComplete("count", value);
        }

        // Clear input dialog state
        ctx.cs2Vm.inputDialogType = 0;
        ctx.cs2Vm.inputDialogWidgetId = -1;
        ctx.cs2Vm.inputDialogString = "";
    });

    // RESUME_NAMEDIALOG (3105): Completes a name/string input dialog
    // Pops string from stack, sends to server as-is
    handlers.set(Opcodes.RESUME_NAMEDIALOG, (ctx) => {
        const inputString = ctx.stringStack[--ctx.stringStackSize] ?? "";

        // Send to server via callback
        if (ctx.cs2Vm.onInputDialogComplete) {
            ctx.cs2Vm.onInputDialogComplete("name", inputString);
        }

        // Clear input dialog state
        ctx.cs2Vm.inputDialogType = 0;
        ctx.cs2Vm.inputDialogWidgetId = -1;
        ctx.cs2Vm.inputDialogString = "";
    });

    // RESUME_STRINGDIALOG (3106): Completes a string input dialog
    // Same as name dialog but different packet
    handlers.set(Opcodes.RESUME_STRINGDIALOG, (ctx) => {
        const inputString = ctx.stringStack[--ctx.stringStackSize] ?? "";

        // Send to server via callback
        if (ctx.cs2Vm.onInputDialogComplete) {
            ctx.cs2Vm.onInputDialogComplete("string", inputString);
        }

        // Clear input dialog state
        ctx.cs2Vm.inputDialogType = 0;
        ctx.cs2Vm.inputDialogWidgetId = -1;
        ctx.cs2Vm.inputDialogString = "";
    });

    handlers.set(Opcodes.RESUME_OBJDIALOG, (ctx) => {
        ctx.cs2Vm.onInputDialogComplete?.("obj", ctx.popInt());
    });

    handlers.set(Opcodes.OPPLAYER, (ctx) => {
        const option = ctx.intStack[--ctx.intStackSize];
        const playerName = String(ctx.stringStack[--ctx.stringStackSize] ?? "");
        if (playerName.length > 0) {
            ctx.sendPlayerOption?.(playerName, option);
        }
    });

    handlers.set(Opcodes.OPENURL, (ctx) => {
        ctx.intStackSize--; // pop internal
        ctx.stringStackSize--; // pop url
    });

    handlers.set(Opcodes.BUG_REPORT, (ctx) => {
        ctx.intStackSize--; // pop type
    });
}
