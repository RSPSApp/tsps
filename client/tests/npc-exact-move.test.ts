import assert from "node:assert/strict";

import { NpcEcs } from "../game/ecs/NpcEcs";
import { applyNpcExactMove } from "../game/sync/NpcExactMove";
import { applyNpcFaceTile } from "../game/sync/NpcFaceTile";
import { NpcUpdateDecoder } from "../game/sync/NpcUpdateDecoder";
import {
    createNpcSyncState,
    encodeNpcSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

/**
 * NPC exact moves (OSRS npc exact_move): the server teleports the NPC and, the same tick, has
 * the client glide it from the tile it left. A live capture of the Doom of Mokhaiotl's burrowed
 * zooms: 4 tiles a tick, delay1 0, delay2 30, angle 768 (north-west).
 */
function decodeNpcs(packet: Buffer, decoder: NpcUpdateDecoder, clientCycle: number) {
    const body = packet.subarray(3);
    const length = body.readUInt16BE(9);
    return decoder.decode(body.subarray(11, 11 + length), {
        large: body[4] === 1,
        loopCycle: 0,
        clientCycle,
        localTileX: 3200,
        localTileY: 3200,
        level: 0,
    });
}

function roundTrip(): void {
    const state = createNpcSyncState();
    const decoder = new NpcUpdateDecoder();
    const local = { x: 3200, y: 3200, level: 0 };
    const view = (x: number, y: number, exactMove?: any) => ({
        index: 7, typeId: 14709, x, y, level: 0,
        rotation: 0, walkDirection: -1, runDirection: -1, exactMove,
    });

    let decoded = decodeNpcs(encodeNpcSync(1, local, [view(3204, 3196) as any], state), decoder, 100);
    assert.equal(decoded.spawns.length, 1);
    assert.equal(decoded.updateBlocks.get(7)?.exactMove, undefined, "no glide without one");

    // Four tiles north-west in one tick: re-added at the new tile with the glide from the old one.
    const move = {
        startDeltaX: 4, startDeltaY: -4, endDeltaX: 0, endDeltaY: 0,
        startCycleOffset: 0, endCycleOffset: 30, direction: 768,
    };
    decoded = decodeNpcs(encodeNpcSync(2, local, [view(3200, 3200, move) as any], state), decoder, 130);
    const spawn = decoded.spawns.find((entry) => entry.npcId === 7);
    assert.ok(spawn?.teleport, "the teleport re-add");
    assert.ok(!decoded.removals.includes(7), "kept, not destroyed and rebuilt (as the game's client does)");
    assert.deepEqual([spawn!.tileX, spawn!.tileY], [3200, 3200]);
    assert.deepEqual(decoded.updateBlocks.get(7)?.exactMove, {
        startDeltaX: 4, startDeltaY: -4, endDeltaX: 0, endDeltaY: 0,
        startCycle: 130, endCycle: 160, direction: 768,
    });

    // Turning into another NPC is still a removal and a new NPC.
    const other = { ...view(3200, 3200), typeId: 14707 };
    decoded = decodeNpcs(encodeNpcSync(3, local, [other as any], state), decoder, 160);
    assert.ok(decoded.removals.includes(7), "a different NPC at the same index");
    assert.equal(decoded.spawns.find((entry) => entry.npcId === 7)?.typeId, 14707);

    // Leaving view is a removal.
    decoded = decodeNpcs(encodeNpcSync(4, local, [], state), decoder, 190);
    assert.deepEqual(decoded.removals, [7]);
}

function glide(): void {
    const ecs = new NpcEcs(8);
    const mapX = 3200 >> 6;
    const mapY = 3200 >> 6;
    const base = { x: mapX << 13, y: mapY << 13 };
    // A 5x5 NPC: positions are centres, (tile << 7) + 5 * 64.
    const centre = 5 << 6;
    const id = ecs.createNpc(mapX, mapY, 14709, 5, 0, 0, 0, 0, 0, 0);
    ecs.setServerMapping(id, 7);
    const to = { x: (3200 << 7) + centre, y: (3200 << 7) + centre };
    const from = { x: (3204 << 7) + centre, y: (3196 << 7) + centre };
    // The teleport re-add has already put it at the end, with a step queued from before.
    ecs.setXY(id, to.x - base.x, to.y - base.y);
    ecs.setServerState(id, { subX: to.x, subY: to.y, tileX: 3200, tileY: 3200, plane: 0 });
    ecs.enqueueStep(id, 0, 0, 4);

    applyNpcExactMove(ecs, id, {
        startDeltaX: 4, startDeltaY: -4, endDeltaX: 0, endDeltaY: 0,
        startCycle: 130, endCycle: 160, direction: 768,
    }, 130);
    const at = () => [ecs.getX(id) + base.x, ecs.getY(id) + base.y];
    assert.deepEqual(at(), [from.x, from.y], "shown at the start at once, never at the end first");
    assert.ok(ecs.isExactMoveActive(id));

    ecs.updateClient(15);
    assert.deepEqual(at(), [(from.x + to.x) / 2, (from.y + to.y) / 2], "halfway at cycle 15 of 30");
    assert.equal(ecs.getRotation(id), 768, "facing the way it goes");

    ecs.updateClient(15);
    assert.deepEqual(at(), [to.x, to.y], "there at cycle 30");
    ecs.updateClient(1);
    assert.equal(ecs.isExactMoveActive(id), false);
    assert.deepEqual(at(), [to.x, to.y], "the old queued step was dropped");
    assert.equal(ecs.getServerState(id)?.tileX, 3200);
}

/** Crawl steps (half walking speed) and a tile to turn to, as the Doom's larvae and burrow use them. */
function crawlAndFaceTile(): void {
    const state = createNpcSyncState();
    const decoder = new NpcUpdateDecoder();
    const local = { x: 3200, y: 3200, level: 0 };
    const view = (extra: object) => ({
        index: 8, typeId: 14710, x: 3204, y: 3204, level: 0,
        rotation: 0, walkDirection: -1, runDirection: -1, ...extra,
    });
    decodeNpcs(encodeNpcSync(1, local, [view({}) as any], state), decoder, 0);
    // A crawl: one step, traversal 0 (the client moves it at half walking speed).
    let decoded = decodeNpcs(encodeNpcSync(2, local, [view({ y: 3205, walkDirection: 1, crawl: true }) as any], state), decoder, 30);
    assert.deepEqual(decoded.movements, [{ npcId: 8, directions: [1], traversals: [0] }]);
    // The same step without crawling is a walk.
    decoded = decodeNpcs(encodeNpcSync(3, local, [view({ y: 3206, walkDirection: 1 }) as any], state), decoder, 60);
    assert.deepEqual(decoded.movements, [{ npcId: 8, directions: [1], traversals: [1] }]);
    // Face a tile.
    decoded = decodeNpcs(encodeNpcSync(4, local, [view({ y: 3206, faceTile: { x: 3209, y: 3206 } }) as any], state), decoder, 90);
    assert.deepEqual(decoded.updateBlocks.get(8)?.faceTile, { x: 3209, y: 3206 });

    // Turning a 5x5 NPC on corner (2, 2): a corner tile due east of its own faces east.
    const ecs = new NpcEcs(8);
    const mapX = 3200 >> 6;
    const id = ecs.createNpc(mapX, mapX, 14707, 5, 2 * 128 + 320, 2 * 128 + 320, 0, 0, 2, 2);
    applyNpcFaceTile(ecs, id, { x: 3200 + 10, y: 3202 });
    assert.equal(ecs.getTargetRot(id), 1536, "east (0 south, 512 west, 1024 north, 1536 east)");
    applyNpcFaceTile(ecs, id, { x: 3202, y: 3200 + 12 });
    assert.equal(ecs.getTargetRot(id), 1024, "north");
}

roundTrip();
glide();
crawlAndFaceTile();
console.log("NPC exact move tests passed");
