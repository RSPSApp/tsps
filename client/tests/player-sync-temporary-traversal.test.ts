import assert from "node:assert/strict";
import { PlayerSyncContext } from "../game/sync/PlayerSyncContext";
import { PlayerUpdateDecoder } from "../game/sync/PlayerUpdateDecoder";
import { PlayerSyncManager } from "../game/sync/PlayerSyncManager";
import { PlayerMovementSync } from "../game/movement/PlayerMovementSync";
import { PlayerAnimController } from "../game/PlayerAnimController";
import { PlayerEcs } from "../game/ecs/PlayerEcs";
import { createPlayerSyncState, encodePlayerSync } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

const base = { x: 2944, y: 2944 }, start = { x: 3000, y: 3000, level: 0 };
const state = createPlayerSyncState(1, start), context = new PlayerSyncContext();
context.setBase(base.x, base.y); context.setLocalIndex(1); context.activate(1, start);
for (const index of context.emptyIndices) context.flags[index] = 1;
const view: any = { index: 1, ...start, appearance: Buffer.alloc(0), movementType: 2 };
function decode(tick: number) {
    const payload = encodePlayerSync(1, base.x, base.y, tick, [view], state).subarray(3);
    const length = payload.readUInt16BE(10);
    return new PlayerUpdateDecoder().decode(payload.subarray(12, 12 + length), context, { packetSize: length, loopCycle: tick });
}
decode(1);
view.y -= 2; view.temporaryMovementType = 1;
const crossing = decode(2), walk = crossing.movements.find(event => event.index === 1);
assert.equal(walk?.mode, "walk");
assert.deepEqual(walk?.tile, { x: 3000, y: 2998, level: 0 });
// The compact two-tile opcode creates one pending destination, not two explicit path nodes.
assert.deepEqual(walk?.traversals, [1]);
assert.equal(walk?.snap, undefined);
assert.equal(crossing.updateBlocks.get(1)?.movementFlag, 1);
assert.equal(context.states[1].movementType, 2, "the client keeps its persistent run type");

delete view.temporaryMovementType; view.x += 2;
const ordinary = decode(3).movements.find(event => event.index === 1);
assert.equal(ordinary?.mode, "run");
assert.deepEqual(ordinary?.traversals, [2], "the next movement uses the cached type");

view.x += 2; view.resetPath = true; view.temporaryMovementType = 1;
const placement = decode(4), teleport = placement.movements.find(event => event.index === 1);
assert.equal(placement.updateBlocks.get(1)?.movementFlag, 127);
assert.equal(teleport?.mode, "teleport"); assert.equal(teleport?.snap, true);
console.log("player-sync-temporary-traversal: ok");

// A decoder-only assertion misses an endpoint that the movement bridge turns into a snap.
// Exercise self and an observer through the production manager and real interpolating ECS.
const fine = (tile: number) => tile * 128 + 64;
let scenarios = 0;
for (const actor of [1, 2]) for (const delta of [[0, -2], [2, 2], [1, 0]]) {
    const origin = { x: 3000, y: 3000, level: 0 };
    const server = createPlayerSyncState(1, origin), receiver = new PlayerSyncContext();
    receiver.setBase(2944, 2944); receiver.setLocalIndex(1); receiver.activate(1, origin);
    if (actor === 2) receiver.activate(2, origin);
    for (const index of receiver.emptyIndices) receiver.flags[index] = 1;
    const views: any[] = [{ index: 1, ...origin, appearance: Buffer.alloc(0), movementType: 2 }];
    if (actor === 2) views.push({ ...views[0], index: 2 });
    const target = views[actor - 1];
    const frame = (tick: number) => {
        const payload = encodePlayerSync(1, 2944, 2944, tick, views, server).subarray(3);
        const size = payload.readUInt16BE(10);
        return new PlayerUpdateDecoder().decode(payload.subarray(12, 12 + size), receiver,
            { packetSize: size, loopCycle: tick });
    };
    const ecs = new PlayerEcs();
    const animations = new PlayerAnimController(ecs,
        { load: () => ({ priority: 1, forcedPriority: 5 }) } as any, {} as any);
    const movement = new PlayerMovementSync(ecs, animations, undefined, undefined, undefined, () => 0);
    const manager = new PlayerSyncManager({ ecs, movementSync: movement, animController: animations });
    for (const view of views) {
        const index = ecs.allocatePlayer(view.index);
        ecs.teleport(index, origin.x, origin.y, 0);
        movement.registerEntity({ serverId: view.index, ecsIndex: index, tile: origin,
            level: 0, subX: fine(origin.x), subY: fine(origin.y) });
    }
    manager.handleFrame(frame(1));
    const index = ecs.getIndexForServerId(actor)!;
    target.x += delta[0]; target.y += delta[1]; target.temporaryMovementType = 1;
    manager.handleFrame(frame(2));
    assert.deepEqual([ecs.getX(index), ecs.getY(index)], [fine(3000), fine(3000)],
        "compact WALK queues movement instead of snapping the visible actor");
    assert.equal(ecs.isMoving(index), true);
    assert.ok(movement.getLastSteps(actor).every(step => !step.run && step.traversal === 1));
    ecs.updateClient(1);
    assert.notDeepEqual([ecs.getX(index), ecs.getY(index)], [fine(3000), fine(3000)],
        "the real ECS advances the walking actor");
    assert.notDeepEqual([ecs.getX(index), ecs.getY(index)], [fine(target.x), fine(target.y)],
        "walking interpolates rather than reaching the destination in one client cycle");
    ecs.updateClient(120);
    assert.deepEqual([ecs.getX(index), ecs.getY(index)], [fine(target.x), fine(target.y)]);

    delete target.temporaryMovementType; target.x += 2;
    manager.handleFrame(frame(3));
    assert.equal(ecs.isMoving(index), true, "following ordinary RUN still interpolates");
    assert.ok(movement.getLastSteps(actor).every(step => step.run && step.traversal === 2));

    target.x += 2; target.resetPath = true; target.temporaryMovementType = 1;
    manager.handleFrame(frame(4));
    assert.deepEqual([ecs.getX(index), ecs.getY(index)], [fine(target.x), fine(target.y)],
        "explicit reset127 keeps its immediate placement priority");
    assert.equal(ecs.isMoving(index), false);

    target.resetPath = false; target.x += 3;
    manager.handleFrame(frame(5));
    assert.deepEqual([ecs.getX(index), ecs.getY(index)], [fine(target.x), fine(target.y)],
        "a distant WALK endpoint retains existing placement behaviour");
    assert.equal(ecs.isMoving(index), false);
    scenarios++;
}
console.log(`temporary traversal manager/ECS: ${scenarios} scenarios passed`);
