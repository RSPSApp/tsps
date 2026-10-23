import assert from "node:assert/strict";
import { test } from "node:test";

import { NpcEcs } from "../game/ecs/NpcEcs";
import { SeqType } from "../rs/config/seqtype/SeqType";
import { updateNpcClientAnimations } from "../render/webgpu/actors/actorPacking";

test("crowded NPCs share frame timings while movement loops and actions finish independently", () => {
    const ecs = new NpcEcs();
    const seq = new SeqType(1, { game: "oldschool", revision: 241 } as any);
    seq.frameIds = [1, 2, 3];
    let timingReads = 0;
    seq.frameLengths = new Proxy([0, 2, 1], {
        get: (target, key, receiver) => {
            if (typeof key === "string" && /^\d+$/.test(key)) timingReads++;
            return Reflect.get(target, key, receiver);
        },
        set: () => { throw new Error("shared frame timings must remain unchanged"); },
    });
    const client = {
        npcEcs: ecs,
        playerEcs: {},
        npcTypeLoader: { load: () => ({ getMovementSeqSet: () => ({ idle: 1, walk: 1 }) }) },
        seqTypeLoader: { load: () => seq },
    } as any;
    const ids = Array.from({ length: 64 }, (_, i) => {
        const id = ecs.createNpc(50, 50, 1, 1, 64, 64, 0, 0, 0, 0);
        ecs.setServerMapping(id, i + 1);
        ecs.setSequenceId(id, 1);
        return id;
    });
    const map = { mapX: 50, mapY: 50 } as any;
    updateNpcClientAnimations(client, map, 3);
    for (const id of ids) {
        assert.equal(ecs.getMovementFrameIndex(id), 2);
        assert.equal(ecs.getFrameIndex(id), 2);
    }
    updateNpcClientAnimations(client, map, 1);
    for (const id of ids) {
        assert.equal(ecs.getMovementFrameIndex(id), 0, "movement loops");
        assert.equal(ecs.getSeqId(id), -1, "the completed action stops");
    }
    assert.equal(timingReads, ids.length * 4 * 2, "read only the current movement/action frame per cycle");
    assert.deepEqual(seq.frameLengths, [0, 2, 1], "zero-length frames retain their timing");
});

test("disabled animation smoothing skips per-NPC sequence resolution", async () => {
    (globalThis as any).self = globalThis;
    const { isNpcAnimationSmoothed } = await import("../render/render/anim/npc2");
    let sequenceReads = 0;
    const host = {
        osrsClient: { clientPlugins: { smoothsNpcs: () => false } },
        dynamicNpcAnimLoader: { isReady: () => true },
        resolveNpcMovementSequenceIds: () => { sequenceReads++; },
    } as any;
    for (let id = 1; id <= 256; id++) assert.equal(isNpcAnimationSmoothed(host, id), false);
    assert.equal(sequenceReads, 0);
});
