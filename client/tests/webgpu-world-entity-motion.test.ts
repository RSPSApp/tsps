import assert from "node:assert/strict";

const { WorldEntityAnimator } = require("../render/WorldEntityAnimator");
const { WorldEntity } = require("../game/worldview/WorldEntity");
const { updateWorldEntityMotion, projectDeckToWorld } = require("../render/render/worldEntityMotion");

// The WebGPU renderer places boat decks through the same motion helpers as WebGL, with a host
// shaped like { worldEntityAnimator, worldEntityOverlays, osrsClient.worldViewManager }. A deck
// scene is in its own coordinates (region 150 here); the matrix must put its centre where the
// synced entity position is, so deck tiles project to the boat and the camera/actors follow.
const FINE = 128;
const ENTITY = 3000;
const entity = new WorldEntity(ENTITY);
entity.setPosition({ x: 3075 * FINE, y: 0, z: 2987 * FINE, orientation: 0 });

const host: any = {
    worldEntityAnimator: new WorldEntityAnimator(undefined, undefined, undefined),
    worldEntityOverlays: new Map([
        [ENTITY, { configId: -1, regionX: 150, regionY: 150, sizeX: 8, sizeZ: 8 }],
    ]),
    osrsClient: {
        worldViewManager: { getWorldEntity: (id: number) => (id === ENTITY ? entity : undefined) },
    },
};

updateWorldEntityMotion(host);

// centreX = regionX * 8 + sizeX * 64 / 128 = 1200 + 4: the deck centre is the boat.
const centre = 1204 * FINE;
const close = (value: number, tile: number) => Math.abs(value / FINE - tile) < 0.01;

let projected = projectDeckToWorld(host, ENTITY, centre, centre)!;
assert.ok(projected, "deck centre projects once the entity has a position");
assert.ok(close(projected.x, 3075) && close(projected.y, 2987), "deck centre maps to the boat");

// Orientation 512 is a quarter turn clockwise: +1 tile east on the deck points north.
entity.setPosition({ x: 3075 * FINE, y: 0, z: 2987 * FINE, orientation: 512 });
updateWorldEntityMotion(host);
projected = projectDeckToWorld(host, ENTITY, centre + FINE, centre)!;
assert.ok(close(projected.x, 3075) && close(projected.y, 2986), "a quarter turn rotates the deck");

console.log("webgpu world entity motion check passed");
