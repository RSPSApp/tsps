import assert from "node:assert/strict";
import { test } from "node:test";

import { ClientState } from "../game/ClientState";
import { InteractType } from "../render/InteractType";
import { checkInteractions } from "../render/render/interact/check";
import { buildSimpleMenuEntries } from "../render/render/interact/menu";
import { MenuState } from "../ui/menu/MenuState";

// OSRS, two players on one tile and both under the cursor: each is listed once for itself and
// once as the other's tile-mate (the nearest hit's rows on top), and the player you are fighting
// is added last, so on top.

const { createCacheVm } = require("../scripts/cache/cs2-sweep");
const { vm } = createCacheVm();

function attackOrder(hitOrder: number[], combatTarget: number): number[] {
    const tileX = 2427, tileY = 3078, mapId = ((tileX >> 6) << 8) | (tileY >> 6);
    const input = { getInteractionMouseX: () => 100, getInteractionMouseY: () => 100,
        dragX: -1, dragY: -1, pickX: -1, pickY: -1, leftClickX: -1, leftClickY: -1 };
    const client: any = {
        inputManager: input,
        camera: { viewMatrix: new Float32Array(16), projectionMatrix: new Float32Array(16), containsScreenPoint: () => true },
        menuOpenedFrame: -100, menuOpen: false, tooltips: true, isPointOverWidget: () => false,
        clientPlugins: { shouldKeepWorldMenuOpen: () => false }, closeMenu() {},
        hoveredTile: { tileX, tileY, plane: 0 }, npcTypeLoader: vm.context.npcTypeLoader, varManager: vm.context.varManager,
        controlledPlayerServerId: 1, menuState: new MenuState(), settings: {}, menuActiveSimpleEntries: [],
        npcEcs: { queryByTile: () => [] },
        playerEcs: { getAllActiveIndices: () => [2, 3], getServerIdForIndex: (index: number) => index, getName: (index: number) => `P${index}`,
            getLevel: () => 0, getCombatLevel: () => 126, getTeam: (index: number) => index,
            getIndexForServerId: () => 0, getX: () => (tileX << 7) + 64, getY: () => (tileY << 7) + 64 },
    };
    const canvas = {};
    const host: any = {
        osrsClient: client, stats: { frameCount: 100 }, app: { width: 900, height: 600, gl: { canvas } }, canvas,
        cachedMenuEntries: [], cachedClientMenuEntries: [], cachedLocIds: new Set(), cachedObjIds: new Set(),
        cachedNpcIds: new Set(), cachedPlayerIds: new Set(), boundToCssEvent: () => ({}),
        computeTileAt: () => ({ tileX, tileY, plane: 0 }), isMouseInUIRegion: () => false,
        screenToRay: () => ({}), getPlayerRawPlane: () => 0, getEffectiveNpcType: () => undefined,
        updateInteractHighlightHoverTarget() {}, performWorldEntryAction() {},
        sceneRaycaster: { raycast: () => hitOrder.map((index) => ({ interactType: InteractType.NPC,
            interactId: 0x8000 | index, playerEcsIndex: index, tileX, tileY, mapId })) },
        buildSimpleMenuEntries: (entries: any, options: any) => buildSimpleMenuEntries(host, entries, options),
    };
    const previous = { playerAttackOption: ClientState.playerAttackOption, localPlayerCombatLevel: ClientState.localPlayerCombatLevel,
        combatTargetPlayerIndex: ClientState.combatTargetPlayerIndex, baseX: ClientState.baseX, baseY: ClientState.baseY };
    ClientState.playerOptions.set(1, { option: "Attack", priority: true, opcode: 44 });
    Object.assign(ClientState, { playerAttackOption: 2, localPlayerCombatLevel: 126, combatTargetPlayerIndex: combatTarget, baseX: 2368, baseY: 3072 });
    try {
        checkInteractions(host);
        return client.menuActiveSimpleEntries.filter((entry: any) => entry.option === "Attack").map((entry: any) => entry.playerServerId);
    } finally {
        ClientState.playerOptions.delete(1);
        Object.assign(ClientState, previous);
    }
}

test("two stacked players are each listed twice, the nearest on top", () => {
    assert.deepEqual(attackOrder([2, 3], -1), [2, 3, 3, 2]);
});

test("the player being fought is on top whichever was hit last", () => {
    assert.deepEqual(attackOrder([2, 3], 3), [3, 2, 3, 2]);
    assert.deepEqual(attackOrder([3, 2], 3), [3, 2, 2, 3]);
    assert.deepEqual(attackOrder([2, 3], 2), [2, 3, 3, 2]);
});
