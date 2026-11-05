// An NPC with a turn speed of 0 never turns, and the game draws it at angle 0 whatever angle it is
// added with (issue 2006: Sir Tiffy Cashien's bench is part of his model, so drawing him at the
// angle he is sent, 1024, put his back to the park).
import assert from "node:assert/strict";
import { NpcEcs } from "../game/ecs/NpcEcs";
import { NpcMovementSync } from "../game/movement/NpcMovementSync";
import { npcAddedRotation } from "../game/utils/rotation";

assert.equal(npcAddedRotation(0, 1024), 0, "a turn speed of 0 is drawn at angle 0");
assert.equal(npcAddedRotation(32, 1024), 1024, "other NPCs are drawn at the angle they are sent");
assert.equal(npcAddedRotation(32, 2048 + 512), 512);

const ecs = new NpcEcs(4);
const sync = new NpcMovementSync(ecs);
const mapX = 46, mapY = 52;
const tile = { x: 2997, y: 3373 };
const add = (rotationSpeed: number, serverId: number) => {
    const local = { x: (tile.x - mapX * 64) * 128 + 64, y: (tile.y - mapY * 64) * 128 + 64 };
    const id = ecs.createNpc(mapX, mapY, 4687, 1, local.x, local.y, 0,
        npcAddedRotation(rotationSpeed, 1024), tile.x - mapX * 64, tile.y - mapY * 64, rotationSpeed);
    ecs.setServerMapping(id, serverId);
    ecs.setTargetRot(id, 1024);
    // The add's own snap, as the client sends it for a new NPC.
    sync.applyNpcUpdate({
        serverId, ecsIndex: id, level: 0, rotation: 1024, moved: true, snap: true,
        subX: (tile.x << 7) + 64, subY: (tile.y << 7) + 64,
        localX: local.x, localY: local.y, mapBaseX: mapX << 13, mapBaseY: mapY << 13,
    }, { forceImmediateRotation: true });
    return id;
};

const tiffy = add(0, 1);
assert.equal(ecs.getRotation(tiffy), 0, "the add's snap keeps a turn speed of 0 at angle 0");
assert.equal(ecs.getTargetRot(tiffy), 1024, "the sent angle is still where it would face");

const walker = add(32, 2);
assert.equal(ecs.getRotation(walker), 1024, "an NPC that turns still snaps to the sent angle");

console.log("npc-turn-speed-zero: ok");
