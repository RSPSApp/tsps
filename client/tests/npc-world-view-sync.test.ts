import assert from "node:assert/strict";

import {
    createNpcSyncState,
    encodeNpcSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { NpcUpdateDecoder } from "../game/sync/NpcUpdateDecoder";

const decoder = new NpcUpdateDecoder();
const worldViewBase = (id: number) =>
    id === 3000 ? { x: 9600, y: 9600 } : id === 3001 ? { x: 9728, y: 9728 } : undefined;
const decode = (packet: Uint8Array, state: NpcUpdateDecoder) =>
    state.decode(packet.subarray(14), {
        large: packet[7] === 1,
        loopCycle: 1,
        clientCycle: 1,
        localTileX: 9610,
        localTileY: 9620,
        rootTileX: 3200,
        rootTileY: 3200,
        level: 0,
        worldViewBase,
    });

const base = {
    level: 0, rotation: 0, walkDirection: -1, runDirection: -1,
    appearance: Buffer.alloc(0),
};

const state = createNpcSyncState();
const packet = encodeNpcSync(1, { x: 3200, y: 3200, level: 0 }, [
    { ...base, index: 10, typeId: 100, x: 9610, y: 9620, worldView: 3000 },
    { ...base, index: 11, typeId: 101, x: 9728 + 5, y: 9728 + 7, worldView: 3001 },
    { ...base, index: 12, typeId: 102, x: 3204, y: 3206 },
] as any, state, { x: 9610, y: 9620, level: 0 }, worldViewBase);

const frame = decode(packet, decoder);
const byId = new Map(frame.spawns.map((spawn) => [spawn.npcId, spawn]));
assert.deepEqual(byId.get(10), {
    npcId: 10, typeId: 100, tileX: 9610, tileY: 9620, level: 0, rot: 256, teleport: false, worldViewId: 3000,
});
assert.deepEqual(byId.get(11), {
    npcId: 11, typeId: 101, tileX: 9733, tileY: 9735, level: 0, rot: 256, teleport: false, worldViewId: 3001,
});
assert.deepEqual(byId.get(12), {
    npcId: 12, typeId: 102, tileX: 3204, tileY: 3206, level: 0, rot: 256, teleport: false, worldViewId: -1,
});

// A world-view change is a remove/re-add so the client cannot keep a ghost on the old deck.
const transitionState = createNpcSyncState();
const transitionDecoder = new NpcUpdateDecoder();
const first = decode(encodeNpcSync(1, { x: 3200, y: 3200, level: 0 }, [
    { ...base, index: 20, typeId: 200, x: 9610, y: 9620, worldView: 3000 },
] as any, transitionState, { x: 9610, y: 9620, level: 0 }, worldViewBase), transitionDecoder);
assert.equal(first.spawns[0].worldViewId, 3000);
const second = decode(encodeNpcSync(1, { x: 3200, y: 3200, level: 0 }, [
    { ...base, index: 20, typeId: 200, x: 9728 + 5, y: 9728 + 7, worldView: 3001 },
] as any, transitionState, { x: 9610, y: 9620, level: 0 }, worldViewBase), transitionDecoder);
assert.equal(second.spawns.find((spawn) => spawn.npcId === 20)?.worldViewId, 3001);
assert.equal(second.spawns.find((spawn) => spawn.npcId === 20)?.tileX, 9733);
const third = decode(encodeNpcSync(1, { x: 3200, y: 3200, level: 0 }, [
    { ...base, index: 20, typeId: 200, x: 3204, y: 3206 },
] as any, transitionState, { x: 9610, y: 9620, level: 0 }, worldViewBase), transitionDecoder);
assert.equal(third.spawns.find((spawn) => spawn.npcId === 20)?.worldViewId, -1,
    "leaving the deck re-adds the NPC in the main world");
assert.equal(third.spawns.find((spawn) => spawn.npcId === 20)?.tileX, 3204);

console.log("npc world view sync: ok");
