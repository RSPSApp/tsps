import assert from "node:assert/strict";
import { dispatchGfxFrameSounds } from "../render/gfx/GfxFrameSounds";

// The Demonic Pacts reflect: spotanim 3613 (leagues_6_fire_shield) plays seq 13740, with sound 11428 on frame 1.
const REFLECT = 3613;
const REFLECT_SEQ = 13740;
const seq = { id: REFLECT_SEQ, frameSounds: new Map([[1, [{ id: 11428, loops: 1, location: 0 }]]]) };
const plain = { id: 1, frameSounds: new Map() };
const calls: Array<{ frame: number; isLocalPlayer: boolean; position?: { x: number; y: number; z?: number } }> = [];
const client: any = {
    controlledPlayerServerId: 42,
    spotAnimTypeLoader: { load: (id: number) => ({ sequenceId: id === REFLECT ? REFLECT_SEQ : 1 }) },
    seqTypeLoader: { load: (id: number) => (id === REFLECT_SEQ ? seq : plain) },
    playerEcs: { getX: () => 3200 * 128, getY: () => 3201 * 128, getLevel: () => 0, getServerIdForIndex: (pid: number) => (pid === 5 ? 42 : 9) },
    npcEcs: { getX: () => 100, getY: () => 200, getLevel: () => 1 },
    handleSeqFrameSounds: (_seq: unknown, frame: number, context: any) =>
        calls.push({ frame, isLocalPlayer: context.isLocalPlayer, position: context.position }),
};

const mine: any = { spotId: REFLECT };
for (const frame of [0, 1, 1, 1, 2]) dispatchGfxFrameSounds(client, mine, frame, { pid: 5 });
assert.deepEqual(calls.map((call) => call.frame), [0, 1, 2], "each frame once as it is drawn, however often it is drawn");
assert.equal(calls[1].isLocalPlayer, true, "on the local player: its location-0 sound is heard (SoundEffectSystem)");

calls.length = 0;
dispatchGfxFrameSounds(client, { spotId: REFLECT } as any, 1, { pid: 6 });
assert.equal(calls[0].isLocalPlayer, false, "another player's");
dispatchGfxFrameSounds(client, { spotId: REFLECT } as any, 1, { ecsId: 3 });
assert.deepEqual(calls[1].position, { x: 100, y: 200, z: 128 }, "an NPC's, at the NPC");
dispatchGfxFrameSounds(client, { spotId: REFLECT, world: { tileX: 10, tileY: 20, level: 0 } } as any, 1);
assert.deepEqual(calls[2].position, { x: 10 * 128 + 64, y: 20 * 128 + 64, z: 0 }, "a world graphic's, at its tile");

calls.length = 0;
dispatchGfxFrameSounds(client, { spotId: 99 } as any, 1, { pid: 5 });
assert.equal(calls.length, 0, "a graphic whose sequence has no sounds asks nothing");

console.log("gfx-frame-sounds: ok");
