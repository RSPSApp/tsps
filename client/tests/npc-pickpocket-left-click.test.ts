import assert from "node:assert/strict";
import { test } from "node:test";

import { ClientState } from "../game/ClientState";
import { InteractType } from "../render/InteractType";
import { checkInteractions } from "../render/render/interact/check";
import { buildSimpleMenuEntries } from "../render/render/interact/menu";
import { chooseDefaultMenuEntry } from "../ui/menu/MenuEngine";
import { MenuState } from "../ui/menu/MenuState";

// The NPC 'Attack' options setting moves only Attack below Walk here. With "Depends on combat
// levels", a low-level player hovering a higher-level NPC still left-clicks its other option
// (Pickpocket on a Knight of Ardougne), and Attack is the one that needs a right click.

const { createCacheVm } = require("../scripts/cache/cs2-sweep");
const { vm } = createCacheVm();
const KNIGHT = 60000;
const knight = { ...vm.context.npcTypeLoader.load(385), id: KNIGHT, name: "Knight of Ardougne", combatLevel: 46,
    actions: [null, "Attack", "Pickpocket", null, null], isInteractable: true, isFollower: false, lowPriorityFollowerOps: false,
    transforms: undefined, entityOps: undefined };
Object.setPrototypeOf(knight, Object.getPrototypeOf(vm.context.npcTypeLoader.load(385)));
const types = { load: (id: number) => (id === KNIGHT ? knight : vm.context.npcTypeLoader.load(id)) };

function menu(npcAttackOption: number, localPlayerCombatLevel: number) {
    const tileX = 2427, tileY = 3078, mapId = ((tileX >> 6) << 8) | (tileY >> 6);
    const localX = ((tileX & 63) << 7) + 64, localY = ((tileY & 63) << 7) + 64;
    const input = { getInteractionMouseX: () => 100, getInteractionMouseY: () => 100,
        dragX: -1, dragY: -1, pickX: -1, pickY: -1, leftClickX: -1, leftClickY: -1 };
    const client: any = {
        inputManager: input,
        camera: { viewMatrix: new Float32Array(16), projectionMatrix: new Float32Array(16), containsScreenPoint: () => true },
        menuOpenedFrame: -100, menuOpen: false, tooltips: true, isPointOverWidget: () => false,
        clientPlugins: { shouldKeepWorldMenuOpen: () => false }, closeMenu() {},
        hoveredTile: { tileX, tileY, plane: 0 }, npcTypeLoader: types, varManager: vm.context.varManager,
        controlledPlayerServerId: 1, menuState: new MenuState(), settings: {}, menuActiveSimpleEntries: [],
        npcEcs: { isActive: () => true, isLinked: () => true, getSize: () => 1, getMapId: () => mapId,
            getX: () => localX, getY: () => localY, getNpcTypeId: () => KNIGHT, getServerId: () => 5,
            getLevel: () => 0, queryByTile: () => [1] },
        playerEcs: { getAllActiveIndices: () => [], getServerIdForIndex: () => undefined, getIndexForServerId: () => 0,
            getCombatLevel: () => localPlayerCombatLevel, getTeam: () => 0, getX: () => 0, getY: () => 0, getLevel: () => 0, getName: () => "" },
    };
    const canvas = {};
    const host: any = {
        osrsClient: client, stats: { frameCount: 100 }, app: { width: 900, height: 600, gl: { canvas } }, canvas,
        cachedMenuEntries: [], cachedClientMenuEntries: [], cachedLocIds: new Set(), cachedObjIds: new Set(),
        cachedNpcIds: new Set(), cachedPlayerIds: new Set(), boundToCssEvent: () => ({}),
        computeTileAt: () => ({ tileX, tileY, plane: 0 }), isMouseInUIRegion: () => false,
        screenToRay: () => ({}), getPlayerRawPlane: () => 0, getEffectiveNpcType: (id: number) => types.load(id),
        updateInteractHighlightHoverTarget() {}, performWorldEntryAction() {},
        sceneRaycaster: { raycast: () => [{ interactType: InteractType.NPC, interactId: KNIGHT, npcServerId: 5, npcEcsId: 1, tileX, tileY, mapId }] },
        buildSimpleMenuEntries: (entries: any, options: any) => buildSimpleMenuEntries(host, entries, options),
    };
    const previous = { npcAttackOption: ClientState.npcAttackOption, localPlayerCombatLevel: ClientState.localPlayerCombatLevel,
        baseX: ClientState.baseX, baseY: ClientState.baseY };
    Object.assign(ClientState, { npcAttackOption, localPlayerCombatLevel, baseX: 2368, baseY: 3072 });
    try {
        checkInteractions(host);
        const entries = client.menuActiveSimpleEntries as any[];
        return {
            leftClick: chooseDefaultMenuEntry(entries, {})?.option,
            lowered: entries.filter((entry) => entry.deprioritized).map((entry) => entry.option).sort(),
        };
    } finally {
        Object.assign(ClientState, previous);
    }
}

test("a higher-level NPC keeps Pickpocket as the left click under \"Depends on combat levels\"", () => {
    assert.deepEqual(menu(0, 3), { leftClick: "Pickpocket", lowered: ["Attack"] });
});

test("\"Always right-click\" lowers only Attack too", () => {
    assert.deepEqual(menu(1, 126), { leftClick: "Pickpocket", lowered: ["Attack"] });
});
