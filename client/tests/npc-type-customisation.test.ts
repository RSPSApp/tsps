import assert from "node:assert/strict";

import { CustomNpcTypeLoader } from "../custom/npcs/CustomNpcTypeLoader";
import { npcModelOverrideFor, registerNpcModelOverride } from "../custom/npcs/NpcModelOverrideRegistry";
import { NpcUpdateDecoder } from "../game/sync/NpcUpdateDecoder";
import type { NpcType } from "../rs/config/npctype/NpcType";
import type { NpcTypeLoader } from "../rs/config/npctype/NpcTypeLoader";
import {
    createNpcSyncState,
    encodeNpcSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

/**
 * NPC type customisation (OSRS npc body customisation, name change and level change). Live's
 * Echo Hunllef (rsprox.net 1158) is the normal Corrupted Hunllef, 9035, sent model 60373 as its
 * body, the name "Corrupted Hunllef (Echo)" and level 1,117.
 */
function decodeNpcs(packet: Buffer, decoder: NpcUpdateDecoder) {
    const body = packet.subarray(3);
    const length = body.readUInt16BE(9);
    return decoder.decode(body.subarray(11, 11 + length), {
        large: body[4] === 1,
        loopCycle: 0,
        clientCycle: 100,
        localTileX: 3200,
        localTileY: 3200,
        level: 0,
    });
}

function roundTrip(): void {
    const state = createNpcSyncState();
    const decoder = new NpcUpdateDecoder();
    const local = { x: 3200, y: 3200, level: 0 };
    const view = (typeCustomisation?: object) => ({
        index: 9, typeId: 9035, x: 3204, y: 3204, level: 0,
        rotation: 0, walkDirection: -1, runDirection: -1, typeCustomisation,
        forcedChat: "before", transparency: { startCycles: 0, endCycles: 30, from: -1, to: 0 },
    });
    let decoded = decodeNpcs(encodeNpcSync(1, local, [view() as any], state), decoder);
    assert.equal(decoded.updateBlocks.get(9)?.typeCustomisation, undefined, "none unless sent");

    const echo = { models: [60373], recolours: [], name: "Corrupted Hunllef (Echo)", combatLevel: 1117 };
    decoded = decodeNpcs(encodeNpcSync(2, local, [view(echo) as any], state), decoder);
    assert.deepEqual(decoded.updateBlocks.get(9)?.typeCustomisation, echo);
    assert.equal(decoded.updateBlocks.get(9)?.say, "before", "the blocks before it stay aligned");
    assert.deepEqual(decoded.updateBlocks.get(9)?.transparency?.to, 0);

    const recoloured = { models: [60217, 60216], recolours: [{ from: 10, to: 20 }, { from: 30, to: 40 }] };
    decoded = decodeNpcs(encodeNpcSync(3, local, [view(recoloured) as any], state), decoder);
    assert.deepEqual(decoded.updateBlocks.get(9)?.typeCustomisation, recoloured, "only the fields sent");

    decoded = decodeNpcs(encodeNpcSync(4, local, [view({}) as any], state), decoder);
    assert.deepEqual(decoded.updateBlocks.get(9)?.typeCustomisation, {}, "a reset carries no fields");
}

function resolvesTheType(): void {
    const base = {
        id: 2267, name: "Dagannoth Rex", combatLevel: 303, modelIds: [9941],
        recolorFrom: [1, 2, 3, 4], recolorTo: [5, 6, 7, 8], size: 3,
    } as unknown as NpcType;
    const loader = new CustomNpcTypeLoader({
        load: (id: number) => {
            assert.equal(id, 2267);
            return base;
        },
        getCount: () => 20000,
        clearCache: () => {},
    } as NpcTypeLoader);
    const id = registerNpcModelOverride(2267, [], { models: [60217, 60216], recolours: [], name: "Dagannoth Rex (Echo)", combatLevel: 454 });
    const type = loader.load(id);
    assert.deepEqual(type.modelIds, [60217, 60216], "the whole model list replaces the type's");
    assert.deepEqual(type.recolorFrom, [], "an empty recolour list drops the type's");
    assert.equal(type.name, "Dagannoth Rex (Echo)", "menus read the synthetic type's name");
    assert.equal(type.combatLevel, 454);
    assert.equal(type.size, 3, "everything else stays the cache's");
    assert.deepEqual(base.modelIds, [9941], "the cache's type is untouched");
    assert.equal(registerNpcModelOverride(2267, [], { models: [60217, 60216], recolours: [], name: "Dagannoth Rex (Echo)", combatLevel: 454 }), id,
        "the same set reuses its id");
    assert.equal(npcModelOverrideFor(id)?.baseId, 2267);

    const slots = registerNpcModelOverride(2267, [{ slot: 0, modelId: 99 }]);
    assert.deepEqual(loader.load(slots).modelIds, [99], "slot swaps alone still work");
    assert.equal(loader.load(slots).name, "Dagannoth Rex");
}

roundTrip();
resolvesTheType();
console.log("NPC type customisation tests passed");
