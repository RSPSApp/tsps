import assert from "node:assert/strict";

import { ClientState } from "../game/ClientState";
import { ClickMode } from "../game/InputManager";
import { InteractType } from "../render/InteractType";
import { checkInteractions } from "../render/render/interact/check";
import { buildSimpleMenuEntries } from "../render/render/interact/menu";
import { MenuState } from "../ui/menu/MenuState";

// Single mouse button mode (varp 170): a left click on a target with more than one option opens
// the Choose Option menu, as a right click would. The press that opens it is spent, so the menu
// overlay can't read it again as a click on the menu and close it at once.

const { createCacheVm } = require("../scripts/cache/cs2-sweep");
const { vm } = createCacheVm();
const npcTypes = vm.context.npcTypeLoader;
const MAN = 385;
const CLICK_X = 300;
const CLICK_Y = 200;

function leftClickWorld(leftClickOpensMenu: boolean, overNpc: boolean) {
    const tileX = 3222, tileY = 3221, mapId = ((tileX >> 6) << 8) | (tileY >> 6);
    const localX = ((tileX & 63) << 7) + 64, localY = ((tileY & 63) << 7) + 64;
    // Mirrors InputManager: the left click reads through the click mode latched for this frame.
    const input: any = {
        clickMode3: ClickMode.LEFT, saveClickX: CLICK_X, saveClickY: CLICK_Y,
        get leftClickX() { return this.clickMode3 === ClickMode.LEFT ? this.saveClickX : -1; },
        get leftClickY() { return this.clickMode3 === ClickMode.LEFT ? this.saveClickY : -1; },
        getInteractionMouseX: () => CLICK_X, getInteractionMouseY: () => CLICK_Y,
        dragX: -1, dragY: -1, pickX: -1, pickY: -1,
    };
    const ran: string[] = [];
    const client: any = {
        inputManager: input,
        camera: { viewMatrix: new Float32Array(16), projectionMatrix: new Float32Array(16), containsScreenPoint: () => true },
        menuOpenedFrame: -100, menuOpen: false, tooltips: true, isPointOverWidget: () => false,
        hasCloseOnOutsideClickModal: () => false,
        clientPlugins: { shouldKeepWorldMenuOpen: () => false }, closeMenu() {},
        hoveredTile: { tileX, tileY, plane: 0 }, npcTypeLoader: npcTypes, varManager: vm.context.varManager,
        controlledPlayerServerId: 1, menuState: new MenuState(), settings: { leftClickOpensMenu },
        menuActiveSimpleEntries: [],
        npcEcs: { isActive: () => true, isLinked: () => true, getSize: () => 1, getMapId: () => mapId,
            getX: () => localX, getY: () => localY, getNpcTypeId: () => MAN, getServerId: () => 5,
            getLevel: () => 0, queryByTile: () => [1] },
        playerEcs: { getAllActiveIndices: () => [], getServerIdForIndex: () => -1, getName: () => "",
            getLevel: () => 0, getCombatLevel: () => 3, getTeam: () => 0,
            getIndexForServerId: () => -1, getX: () => 0, getY: () => 0 },
    };
    const canvas: any = {};
    const host: any = {
        osrsClient: client, stats: { frameCount: 100 }, app: { width: 900, height: 600, gl: { canvas } }, canvas,
        cachedMenuEntries: [], cachedClientMenuEntries: [], cachedLocIds: new Set(), cachedObjIds: new Set(),
        cachedNpcIds: new Set(), cachedPlayerIds: new Set(), boundToCssEvent: () => ({}),
        computeTileAt: () => ({ tileX, tileY, plane: 0 }), isMouseInUIRegion: () => false,
        sampleHeightAtExactPlane: () => 0, worldToScreen: () => undefined,
        screenToRay: () => ({}), getPlayerRawPlane: () => 0, getEffectiveNpcType: (id: number) => npcTypes.load(id),
        updateInteractHighlightHoverTarget() {}, performWorldEntryAction() {},
        onInteractHighlightEntryInvoked: (entry: any) => ran.push(entry.option),
        toGLClickXY: () => ({ sx: CLICK_X, sy: CLICK_Y }), spawnClickCross() {},
        sceneRaycaster: { raycast: () => overNpc ? [{ interactType: InteractType.NPC, interactId: MAN,
            npcServerId: 5, npcEcsId: 1, tileX, tileY, mapId }] : [] },
        buildSimpleMenuEntries: (entries: any, options: any) => buildSimpleMenuEntries(host, entries, options),
    };
    checkInteractions(host);
    return { client, input, ui: canvas.__ui, ran };
}

const previous = { baseX: ClientState.baseX, baseY: ClientState.baseY };
Object.assign(ClientState, { baseX: 3200, baseY: 3200 });
try {
    {
        const { client, input, ui } = leftClickWorld(true, true);
        assert.equal(client.menuOpen, true, "a left click on the Man opens the menu");
        assert.deepEqual([client.menuX, client.menuY], [CLICK_X, CLICK_Y], "the menu opens at the click");
        assert.equal(input.clickMode3, ClickMode.NONE, "the press that opened the menu is spent");
        assert.equal(input.leftClickX, -1, "the overlay sees no left click left to pick with");
        assert.equal(ui?.menu?.open, true, "the Choose Option overlay gets the open menu");
        const options = ui.menu.entries.map((entry: any) => entry.option);
        assert.ok(options.includes("Talk-to") && options.includes("Walk here") && options.includes("Cancel"),
            `the menu lists the Man's options: ${options.join(", ")}`);
    }
    {
        const { client, input, ran } = leftClickWorld(false, true);
        assert.equal(client.menuOpen, false, "with the setting off, a left click runs the top option");
        assert.deepEqual(ran, ["Talk-to"]);
        assert.equal(input.clickMode3, ClickMode.LEFT, "and its press isn't consumed by a menu");
    }
    {
        const { client, ran } = leftClickWorld(true, false);
        assert.equal(client.menuOpen, false, "a tile with only Walk here still walks on a left click");
        assert.deepEqual(ran, ["Walk here"]);
    }
} finally {
    Object.assign(ClientState, previous);
}

console.log("single mouse button menu: ok");
