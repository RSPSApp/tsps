import assert from "node:assert/strict";
import { LocAnimated } from "../render/loc/LocAnimated";

/** A loc playing `seqId` at one spot; only what carryOver and the constructor read. */
function loc(seqId: number, x = 10, cycle = 0): LocAnimated {
    const seqType: any = { id: seqId, frameStep: 1, frameIds: [1, 2, 3], frameLengths: [5, 5, 5], isSkeletalSeq: () => false };
    return new LocAnimated(0, 0, 0, 0, 0, 0, 0, 0, {} as any, seqType, cycle, false, 44776, x, 20, 0, 1);
}

// The Giants' Foundry crucible empties mid-pour: its square is rebuilt, and the pour goes on.
{
    const before = loc(9447);
    before.frame = 2;
    before.cycleStart = 40;
    const after = [loc(9447, 10, 300)];
    LocAnimated.carryOver([before], after);
    assert.equal(after[0].frame, 2, "the rebuilt loc keeps its frame");
    assert.equal(after[0].cycleStart, 40, "and its timing");
}

// Another sequence, or another loc, starts fresh.
{
    const before = loc(9447);
    before.frame = 2;
    const other = [loc(9449, 10, 300), loc(9447, 11, 300)];
    LocAnimated.carryOver([before], other);
    assert.equal(other[0].frame, 0, "a new sequence starts at its first frame");
    assert.equal(other[1].frame, 0, "a loc elsewhere starts at its first frame");
}

// Course ropes are baked at map load and use their unanimated cache pose until the packet.
{
    const seqType = {
        id: 497, frameStep: -1, frameIds: [1, 2, 3], frameLengths: [5, 5, 5],
        isSkeletalSeq: () => false, getFrameLength: () => 5,
    } as any;
    const makeRope = (level: number) => new LocAnimated(
        0, -1, -1, -1, -1, -1, -1, -1, { frames: [], baseFrame: 3 },
        seqType, 100, false, 23131, 10, 20, level, 0,
        { tileX: 55, tileY: 30, shape: 10 },
    );
    const ground = makeRope(0);
    const upstairs = makeRope(1);
    const tile = { x: 2551, y: 3550 };
    assert.equal(ground.drawFrame(), 3, "before the packet, draw the cache rest pose");
    assert.equal(LocAnimated.playPrepared([upstairs, ground], tile, 23131, 0, 10, 0, 497, 120), true);
    assert.equal(ground.drawFrame(), 0, "the packet starts the swing at its first frame");
    assert.equal(upstairs.drawFrame(), 3, "the same object on another floor stays idle");
    assert.equal(LocAnimated.playPrepared([ground], { x: tile.x + 1, y: tile.y }, 23131, 0, 10, 0, 497, 121), false);
    ground.update({} as any, 126);

    const refreshed = makeRope(0);
    LocAnimated.carryOver([ground], [refreshed]);
    assert.equal(refreshed.drawFrame(), 1, "unrelated map refresh preserves the active pose");
    assert.equal(refreshed.cycleStart, ground.cycleStart, "the refresh preserves its timing");
    refreshed.update({} as any, 135);
    assert.equal(refreshed.drawFrame(), 3, "the one-shot swing returns to the original rest pose");
    const idle = makeRope(0);
    LocAnimated.carryOver([refreshed], [idle]);
    assert.equal(idle.drawFrame(), 3, "a refresh after the swing stays at rest");
}

console.log("loc anim carry-over checks passed");
