import assert from "node:assert/strict";
import { PlayerAnimController } from "../game/PlayerAnimController";
import { PlayerEcs } from "../game/ecs/PlayerEcs";

// A chopping axe swing: three frames of two client ticks, a sound on frame 1, looping.
const CHOP = 879;
const chop = {
    frameIds: [1, 2, 3],
    frameStep: 3,
    maxLoops: 99,
    getFrameLength: () => 2,
    frameSounds: new Map([[1, [{ id: 2735, loops: 1, location: 1 }]]]),
};

const ecs = new PlayerEcs();
const played: Array<[number, number]> = [];
const controller = new PlayerAnimController(
    ecs,
    { load: (id: number) => (id === CHOP ? chop : undefined) } as any,
    {} as any,
    (serverId, _index, _seqType, frame) => played.push([serverId, frame]),
);
ecs.allocatePlayer(7);

controller.handleServerSequence(7, CHOP);
controller.tick(2);
assert.deepEqual(played, [[7, 0]], "frames without sounds are offered too; the handler picks the sounds");
played.length = 0;
controller.tick(4);
assert.deepEqual(played, [[7, 1], [7, 2]], "each frame once, as it starts, not every client tick");
played.length = 0;
controller.tick(2);
assert.deepEqual(played, [[7, 0]], "the loop starts the swing again");
