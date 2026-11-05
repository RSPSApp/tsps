// Issue #1679: a partial animation stall is client-side. The server keeps walking the true
// tile; the client withholds the rendered steps while the sequence plays and then catches up
// (the rubber band the Wiki describes). The sequence fields below are the ones the client's
// isActionSequenceBlockingMovement reads: priority 0 with no masks means "withhold steps".
import assert from "node:assert/strict";
import { PlayerEcs } from "../game/ecs/PlayerEcs";
import { PlayerAnimController } from "../game/PlayerAnimController";

const fine = (tile: number) => (tile << 7) + 64;
const CAST = 711; // wind strike; the cache seq carries no masks and an unset priority

const frameLength = 100;
const seqTypes: Record<number, any> = {
    [CAST]: {
        priority: 0,
        precedenceAnimating: 0,
        forcedPriority: 6,
        maxLoops: 0,
        frameStep: 0,
        frameIds: [0],
        frameLengths: [frameLength],
        isSkeletalSeq: () => false,
        getFrameLength: () => frameLength,
    },
};
const loader = { load: (id: number) => seqTypes[id] };

const ecs = new PlayerEcs();
const index = ecs.allocatePlayer(1);
ecs.teleport(index, 100, 100);
ecs.setSeqTypeLoader(loader as any);
const animations = new PlayerAnimController(ecs, loader as any, {} as any);

// The cast starts and the server acknowledges the first step of the walk in the same tick.
animations.handleServerSequence(1, CAST);
ecs.setServerPos(index, fine(100), fine(101));
animations.tick(1);
ecs.updateClient(1);

const heldY = ecs.getY(index);
assert.equal(heldY, fine(100), "the cast holds the rendered tile on the old square");
assert.equal(ecs.getAnimSeqId(index), CAST, "and the animation keeps playing");

// The true tile keeps moving while the animation is on screen.
ecs.setServerPos(index, fine(100), fine(102));
animations.tick(1);
ecs.updateClient(1);
assert.equal(ecs.getY(index), heldY, "the next server step is held too");

// The animation ends; the client catches up to the true tile in a burst.
animations.tick(frameLength + 2);
assert.equal(ecs.getAnimSeqId(index), -1, "the sequence finished");
ecs.updateClient(200);
assert.equal(ecs.getY(index), fine(102), "the player rubber-bands onto their true tile");

console.log("animation stall visual hold and rubber band check passed");
