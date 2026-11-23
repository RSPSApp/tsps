import assert from "node:assert/strict";

import { ClientState } from "../game/ClientState";
import { ClickMode } from "../game/InputManager";
import { checkInteractions } from "../render/render/interact/check";
import { buildSimpleMenuEntries } from "../render/render/interact/menu";
import { isMouseInUIRegion } from "../render/render/interact/menu2";
import { MenuState } from "../ui/menu/MenuState";

// A left click on the world beside the resizable side panel walks, as its hover menu ("Walk
// here") says; a left click on the panel itself, where a widget takes it, does not.

const { createCacheVm } = require("../scripts/cache/cs2-sweep");
const { vm } = createCacheVm();

// Classic layout (161) at 998x768: the stone rows start at x 757, the top row at y 433, so this
// point is open world just above the top row.
const WIDTH = 998;
const HEIGHT = 768;
const CLICK_X = 896;
const CLICK_Y = 426;

function leftClick(x: number, y: number, overWidget: boolean): string[] {
    const tileX = 3222, tileY = 3221;
    const input: any = {
        clickMode3: ClickMode.LEFT, saveClickX: x, saveClickY: y,
        get leftClickX() { return this.clickMode3 === ClickMode.LEFT ? this.saveClickX : -1; },
        get leftClickY() { return this.clickMode3 === ClickMode.LEFT ? this.saveClickY : -1; },
        getInteractionMouseX: () => x, getInteractionMouseY: () => y,
        dragX: -1, dragY: -1, pickX: -1, pickY: -1,
    };
    const ran: string[] = [];
    const client: any = {
        inputManager: input,
        camera: { viewMatrix: new Float32Array(16), projectionMatrix: new Float32Array(16), containsScreenPoint: () => true },
        widgetManager: { rootInterface: 161 },
        getWidgetInteractionState: () => ({ isPointerOverMinimapClickTarget: () => false }),
        menuOpenedFrame: -100, menuOpen: false, tooltips: true, isPointOverWidget: () => overWidget,
        hasCloseOnOutsideClickModal: () => false,
        clientPlugins: { shouldKeepWorldMenuOpen: () => false }, closeMenu() {},
        hoveredTile: { tileX, tileY, plane: 0 }, varManager: vm.context.varManager,
        controlledPlayerServerId: 1, menuState: new MenuState(), settings: { leftClickOpensMenu: false },
        menuActiveSimpleEntries: [],
        npcEcs: { isActive: () => false, isLinked: () => false, queryByTile: () => [] },
        playerEcs: { getAllActiveIndices: () => [], getServerIdForIndex: () => -1, getName: () => "",
            getLevel: () => 0, getCombatLevel: () => 3, getTeam: () => 0,
            getIndexForServerId: () => -1, getX: () => 0, getY: () => 0 },
    };
    const canvas: any = { width: WIDTH, height: HEIGHT };
    const host: any = {
        osrsClient: client, stats: { frameCount: 100 }, app: { width: WIDTH, height: HEIGHT, gl: { canvas } }, canvas,
        cachedMenuEntries: [], cachedClientMenuEntries: [], cachedLocIds: new Set(), cachedObjIds: new Set(),
        cachedNpcIds: new Set(), cachedPlayerIds: new Set(), boundToCssEvent: () => ({}),
        computeTileAt: () => ({ tileX, tileY, plane: 0 }),
        isMouseInUIRegion: (mx: number, my: number) => isMouseInUIRegion(host, mx, my),
        sampleHeightAtExactPlane: () => 0, worldToScreen: () => undefined,
        screenToRay: () => ({}), getPlayerRawPlane: () => 0,
        updateInteractHighlightHoverTarget() {}, clearInteractHighlightHoverTarget() {},
        performWorldEntryAction() {},
        onInteractHighlightEntryInvoked: (entry: any) => ran.push(entry.option),
        toGLClickXY: () => ({ sx: x, sy: y }), spawnClickCross() {},
        sceneRaycaster: { raycast: () => [] },
        buildSimpleMenuEntries: (entries: any, options: any) => buildSimpleMenuEntries(host, entries, options),
    };
    checkInteractions(host);
    return ran;
}

const previous = { baseX: ClientState.baseX, baseY: ClientState.baseY };
Object.assign(ClientState, { baseX: 3200, baseY: 3200 });
try {
    assert.deepEqual(leftClick(CLICK_X, CLICK_Y, false), ["Walk here"],
        "a left click on the world just above the stones walks");
    assert.deepEqual(leftClick(CLICK_X, CLICK_Y + 100, true), [],
        "a left click on the panel, where a widget takes it, does not reach the world");
} finally {
    Object.assign(ClientState, previous);
}

console.log("resizable side panel left click: ok");
