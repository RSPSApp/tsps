import assert from "node:assert/strict";

// PicoGL expects a browser global when SceneRaycaster imports WebGLMapSquare.
(globalThis as any).self = globalThis;
const { SceneRaycaster } = require("../game/scene/SceneRaycaster");
const { Ray, rayIntersectsBox } = require("../game/math/Raycast");
const { vec3 } = require("gl-matrix");

/**
 * The hover raycast walks only the tiles the ray crosses. It used to test every tile in the
 * rectangle around the ray's segment against a tall tile column; both must find the same tiles.
 */
const BASE_X = 3200;
const BASE_Y = 3200;
const SPAN = 64;
const map = {
    getRenderBaseTileX: () => BASE_X,
    getRenderBaseTileY: () => BASE_Y,
    getLocalTileSpan: () => SPAN,
};
const raycaster = new SceneRaycaster({}, {});
let walked = new Set<string>();
raycaster.collectTileHits = (_map: unknown, _ray: unknown, x: number, y: number) => {
    walked.add(`${x},${y}`);
};

let seed = 12345;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

for (let i = 0; i < 2000; i++) {
    const origin = vec3.fromValues(BASE_X + random() * SPAN, -5 - random() * 20, BASE_Y + random() * SPAN);
    const direction = vec3.normalize(vec3.create(), [random() * 2 - 1, 0.2 + random(), random() * 2 - 1]);
    if (i % 50 === 0) vec3.set(direction, 0, 1, 0); // straight down
    if (i % 50 === 1) vec3.normalize(direction, [1, 1, 0]); // along a tile row
    const ray = new Ray(origin, direction);
    const box = rayIntersectsBox(ray, [BASE_X, -1000, BASE_Y], [BASE_X + SPAN, 1000, BASE_Y + SPAN]);
    const tEnter = Math.max(box.tMin, 0);
    const tExit = Math.min(box.tMax, 40);

    walked = new Set();
    raycaster.traverseMapTiles(map, ray, tEnter, tExit, 40, [], 0);

    const entry = ray.at(tEnter, vec3.create());
    const exit = ray.at(tExit, vec3.create());
    const expected = new Set<string>();
    for (let x = Math.floor(Math.min(entry[0], exit[0])); x <= Math.floor(Math.max(entry[0], exit[0])); x++) {
        for (let y = Math.floor(Math.min(entry[2], exit[2])); y <= Math.floor(Math.max(entry[2], exit[2])); y++) {
            if (x < BASE_X || y < BASE_Y || x >= BASE_X + SPAN || y >= BASE_Y + SPAN) continue;
            const hit = rayIntersectsBox(ray, [x, -500, y], [x + 1, 500, y + 1]);
            // Corner grazes (zero-length crossings) are either side of float error.
            if (hit && hit.tMin <= tExit && hit.tMax - hit.tMin > 1e-6) expected.add(`${x},${y}`);
        }
    }
    for (const tile of expected) assert.ok(walked.has(tile), `ray ${i} missed tile ${tile}`);
    assert.ok(walked.size <= expected.size + 2, `ray ${i} walked ${walked.size} tiles for ${expected.size}`);
}

console.log("Hover raycast walks the tiles the ray crosses");
