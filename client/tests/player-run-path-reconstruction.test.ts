import assert from "node:assert/strict";
import { CollisionFlag } from "../common/CollisionFlag";
import { MovementDirection } from "../common/Direction";
import { PlayerAnimController } from "../game/PlayerAnimController";
import { PlayerEcs } from "../game/ecs/PlayerEcs";
import { PlayerMovementSync } from "../game/movement/PlayerMovementSync";
import { PlayerSyncContext } from "../game/sync/PlayerSyncContext";
import { PlayerSyncManager } from "../game/sync/PlayerSyncManager";
import { PlayerUpdateDecoder } from "../game/sync/PlayerUpdateDecoder";
import {
    createPlayerSyncState,
    encodePlayerSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

const playerEcs = {
    setInteractionOrientationProvider() {},
    trimQueuedStepsAfter() {
        return true;
    },
    setServerPos() {
        return true;
    },
    setRunning() {},
    getInteractionIndex() {
        return -1;
    },
};

const movement = new PlayerMovementSync(
    playerEcs as any,
    undefined,
    undefined,
    undefined,
    undefined,
    (_plane, x, y) => (x === 1 && y === 0 ? CollisionFlag.OBJECT : 0),
);

movement.registerEntity({
    serverId: 1,
    ecsIndex: 0,
    tile: { x: 0, y: 0 },
    level: 0,
    subX: 64,
    subY: 64,
});

const { path } = movement.receiveUpdate({
    serverId: 1,
    ecsIndex: 0,
    x: (1 << 7) + 64,
    y: (1 << 7) + 64,
    level: 0,
    running: true,
    moved: true,
    directions: [MovementDirection.NorthEast],
    traversals: [2],
});

assert.equal(path.steps.length, 2);
assert.notEqual(path.steps[0].direction, MovementDirection.NorthEast);
assert.deepEqual(path.steps.at(-1)?.tile, { x: 1, y: 1 });

const start = { x: 3081, y: 3506, level: 0 };
const serverState = createPlayerSyncState(1, start);
const packet = encodePlayerSync(
    1,
    3040,
    3472,
    1,
    [{
        index: 1,
        x: 3080,
        y: 3507,
        level: 0,
        appearance: Buffer.alloc(0),
        movementType: 2,
    }],
    serverState,
);
const payload = packet.subarray(3);
const syncLength = payload.readUInt16BE(10);
const context = new PlayerSyncContext();
context.setBase(payload.readUInt16BE(0), payload.readUInt16BE(2));
context.setLocalIndex(1);
context.activate(1, start);
for (const index of context.emptyIndices) context.flags[index] = 1;

const frame = new PlayerUpdateDecoder().decode(
    payload.subarray(12, 12 + syncLength),
    context,
    { packetSize: syncLength, loopCycle: 1 },
);
assert.equal(frame.movements[0]?.mode, "run");
assert.equal(frame.movements[0]?.snap, undefined);
assert.equal(frame.movements[0]?.directions, undefined);
assert.deepEqual(frame.movements[0]?.tile, { x: 3080, y: 3507, level: 0 });

console.log("player run path reconstruction check passed");

const fine = (tile: number) => (tile << 7) + 64;

// A one-tile moveTo (for example, placement onto a chair) must not be decoded
// as a walking step while its animation has already started.
for (const level of [0, 1]) for (const index of [1, 2]) {
    const state = createPlayerSyncState(1, start);
    const ctx = new PlayerSyncContext();
    ctx.setBase(3040, 3472);
    ctx.setLocalIndex(1);
    ctx.activate(1, start);
    for (const empty of ctx.emptyIndices) ctx.flags[empty] = 1;
    const views = [1, 2].map(id => ({ index: id, ...start, appearance: Buffer.alloc(0) }));
    const decode = (tick: number) => {
        const data = encodePlayerSync(1, 3040, 3472, tick, views, state).subarray(3);
        const length = data.readUInt16BE(10);
        return new PlayerUpdateDecoder().decode(data.subarray(12, 12 + length), ctx,
            { packetSize: length, loopCycle: tick });
    };
    const ecs = new PlayerEcs();
    const animations = new PlayerAnimController(ecs,
        { load: () => ({ priority: 1, forcedPriority: 5 }) } as any, {} as any);
    const movementSync = new PlayerMovementSync(ecs, animations);
    const manager = new PlayerSyncManager({ ecs, movementSync, animController: animations });
    const ecsIndex = ecs.allocatePlayer(index);
    ecs.teleport(ecsIndex, start.x, start.y, 0);
    movementSync.registerEntity({ serverId: index, ecsIndex, tile: start,
        level: 0, subX: fine(start.x), subY: fine(start.y) });
    manager.handleFrame(decode(1));
    ecs.setServerPos(ecsIndex, fine(start.x), fine(start.y + 1));
    ecs.setServerPos(ecsIndex, fine(start.x), fine(start.y + 2));
    Object.assign(views[index - 1], { y: start.y + 1, level, resetPath: true,
        animation: { id: 4103, delay: 0 }, faceDirection: 256 });
    const placed = decode(2);
    const move = placed.movements.find(event => event.index === index);
    assert.equal(move?.mode, "teleport", "placement must snap for both self and observers");
    assert.equal(move?.snap, true);
    assert.deepEqual(move?.tile, { ...start, y: start.y + 1, level });
    assert.equal(placed.updateBlocks.get(index)?.faceDir, 256);
    assert.deepEqual(placed.updateBlocks.get(index)?.animation, { seqId: 4103, delay: 0 });
    manager.handleFrame(placed);
    assert.equal(ecs.getAnimSeqId(ecsIndex), 4103, "placement preserves its same-packet animation");
    assert.equal(ecs.getForcedMovementSteps(ecsIndex), 0);
    ecs.updateClient(100);
    assert.deepEqual([ecs.getX(ecsIndex), ecs.getY(ecsIndex), ecs.getLevel(ecsIndex)],
        [fine(start.x), fine(start.y + 1), level], "old steps cannot move the player after placement");
}
console.log("player placement reset checks passed");

// Relocation discards the approach path and its animation snapshot, even when
// another forced movement was still running (stairs, teleports, interrupted jumps).
for (const forced of [false, true]) {
    const ecs = new PlayerEcs();
    const index = ecs.allocatePlayer(1);
    ecs.teleport(index, 100, 100);
    const animations = new PlayerAnimController(ecs,
        { load: () => ({ priority: 1, forcedPriority: 5 }) } as any, {} as any);
    const sync = new PlayerMovementSync(ecs, animations);
    sync.registerEntity({ serverId: 1, ecsIndex: index, tile: { x: 100, y: 100 },
        level: 0, subX: fine(100), subY: fine(100) });
    ecs.setServerPos(index, fine(100), fine(101));
    ecs.updateClient();
    ecs.setServerPos(index, fine(100), fine(102));
    animations.handleServerSequence(1, 828);
    assert.equal(ecs.getForcedMovementSteps(index), 2);
    if (forced) {
        ecs.startForcedMovement(index, 1, 70, fine(100), fine(101), fine(100), fine(104), 1024);
        ecs.setServerPos(index, fine(100), fine(105));
    }
    sync.receiveUpdate({ serverId: 1, ecsIndex: index, x: fine(200), y: fine(200),
        level: 1, moved: true, snap: true });
    assert.equal(ecs.isMoving(index), false, "teleport clears queued approach steps");
    assert.equal(ecs.getForcedMovementSteps(index), 0, "teleport clears sequencePathLength");
    assert.equal(ecs.isForcedMovementActive(index, 2), false, "teleport cancels an old jump");
    assert.equal(ecs.getAnimSeqId(index), 828, "relocation preserves the action animation");
    assert.equal(ecs.getLevel(index), 1);
    ecs.updateClient(100);
    assert.deepEqual([ecs.getX(index), ecs.getY(index)], [fine(200), fine(200)]);
    sync.receiveUpdate({ serverId: 1, ecsIndex: index, x: fine(200), y: fine(201),
        level: 1, moved: true, directions: [MovementDirection.North], traversals: [1] });
    assert.equal(ecs.getAnimSeqId(index), -1, "walking still cancels move-sensitive animations");
}

// The forced endpoint is the next path's origin, even before the rendered
// player has landed. Walking must wait until the final forced-movement cycle.
{
    const ecs = new PlayerEcs();
    const index = ecs.allocatePlayer(1);
    ecs.teleport(index, 100, 99);
    const movementSync = new PlayerMovementSync(ecs);
    movementSync.registerEntity({ serverId: 1, ecsIndex: index,
        tile: { x: 100, y: 100 }, level: 0, subX: fine(100), subY: fine(100) });
    const manager = new PlayerSyncManager({ ecs, movementSync });
    manager.handleFrame({ baseX: 0, baseY: 0, localIndex: 1, loopCycle: 1,
        movements: [], spawns: [], removals: [], updateBlocks: new Map([[1, {
            forcedMovement: { startDeltaX: 0, startDeltaY: 0, endDeltaX: 0, endDeltaY: 3,
                startTileX: 100, startTileY: 100, endTileX: 100, endTileY: 103,
                startCycle: 2, endCycle: 12, direction: 1024 },
        }]]) });
    ecs.updateClient(4);
    assert.equal(ecs.getY(index), fine(100) + Math.trunc(2 * 384 / 10));
    const beforeWalk = ecs.getY(index);
    movementSync.receiveUpdate({ serverId: 1, ecsIndex: index,
        x: fine(100), y: fine(104), level: 0, running: false, moved: true,
        directions: [MovementDirection.North], traversals: [1] });
    assert.equal(ecs.getY(index), beforeWalk, "a queued walk must not snap a jump to its endpoint");
    for (let cycle = 5; cycle <= 12; cycle++) {
        ecs.updateClient();
        assert.equal(ecs.getY(index), fine(100) + Math.trunc((cycle - 2) * 384 / 10),
            "walking must not alter forced interpolation");
    }
    ecs.updateClient();
    assert.ok(ecs.getY(index) > fine(103) && ecs.getY(index) < fine(104),
        "the first step after landing walks smoothly from the endpoint");
    ecs.updateClient(70);
    assert.equal(ecs.getY(index), fine(104));
    assert.equal(ecs.isMoving(index), false);
}
console.log("player relocation and forced movement checks passed");
