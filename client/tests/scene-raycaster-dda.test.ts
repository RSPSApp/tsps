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

// Large models can reach six tiles away from their anchor. Neighbourhood deduplication must
// retain every anchor on each interaction plane, including bridge changes and 104-tile scenes.
const { mat4 } = require("gl-matrix");
for (const [span, bridge, deck, plane] of [
    [64, false, false, 0], [64, true, false, 0],
    [104, false, false, undefined], [104, true, false, 0],
    [64, false, true, 0],
] as const) {
    const baseX = deck ? 9600 : BASE_X + 8;
    const baseY = deck ? 9600 : BASE_Y + 24;
    const anchors = new Set<string>();
    const crossed: [number, number][] = [];
    const bridgeAt = (x: number) => bridge && (x & 2) !== 0;
    const idAt = (level: number, x: number, y: number) => (level * span + x) * span + y + 1;
    const fixture = {
        id: 1234, mapX: baseX / 64, mapY: baseY / 64, interactionPlane: -1,
        getRenderBaseTileX: () => baseX, getRenderBaseTileY: () => baseY,
        getRenderBaseWorldX: () => baseX, getRenderBaseWorldY: () => baseY,
        getLocalTileSpan: () => span,
        getTileRenderFlag: (level: number, x: number) => level === 1 && bridgeAt(x) ? 2 : 0,
        getLocIdsAtLocal: (level: number, x: number, y: number) => {
            const key = `${level}:${x}:${y}`;
            assert.ok(!anchors.has(key), `anchor ${key} is tested once per ray`);
            anchors.add(key);
            return [idAt(level, x, y)];
        },
        getLocTypeRotsAtLocal: () => [10],
    };
    const picker = new SceneRaycaster({
        visibleMapCount: 1, visibleMaps: [fixture],
        worldEntityMapIds: new Set(deck ? [fixture.id] : []),
    }, {
        renderDistance: 100, clientPlugins: { gpuSettings: () => undefined },
        groundItems: { getStacksAt: () => [] }, npcEcs: { queryByMap: () => [] },
        playerEcs: { getIndexForServerId: () => undefined, size: () => 0 },
        camera: { viewMatrix: mat4.create() },
    });
    picker.sampleHeightAt = () => 0;
    picker.getResolvedLocType = (id: number) => ({ id, actions: ["Use"], sizeX: 1, sizeY: 1 });
    picker.intersectLocModel = (_ray: unknown, _max: number, type: { id: number }) => type.id / 10000;
    const collect = picker.collectTileHits;
    picker.collectTileHits = function (...args: any[]) {
        crossed.push([args[2] - baseX, args[3] - baseY]);
        return collect.apply(this, args);
    };
    if (deck) {
        const transform = mat4.fromTranslation(mat4.create(), [-6400, 0, -6400]);
        picker.worldEntityTransformProvider = () => transform;
    }
    // The outer-room ray catches indices beyond 64, right at the composed scene boundary.
    const localX = span === 104 ? 90.5 : 24.5;
    const origin = [baseX + localX - (deck ? 6400 : 0), -1, baseY + 30.5 - (deck ? 6400 : 0)];
    const pickRay = new Ray(origin, [1, 0, 0.3]);
    const hits = picker.raycast(pickRay, { maxDistance: 24, basePlane: plane });
    assert.ok(crossed.length > 5, "the normal or transformed ray actually crosses the scene");
    const expected = new Set<string>();
    for (const [x, y] of crossed) {
        const levels = plane === undefined ? [0, 1, 2, 3] : [bridgeAt(x) ? 1 : plane];
        for (const level of levels) for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
            if (x + dx >= 0 && y + dy >= 0 && x + dx < span && y + dy < span) {
                expected.add(`${level}:${x + dx}:${y + dy}`);
            }
        }
    }
    assert.deepEqual(anchors, expected, `all neighbourhood anchors: span=${span}, bridge=${bridge}, deck=${deck}`);
    assert.equal(hits.length, expected.size, "every unique synthetic loc remains selectable");
    assert.equal(new Set(hits.map((hit: any) => hit.interactId)).size, hits.length, "no duplicate menu hits");
    for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].t <= hits[i].t, "hit priority stays front to back");
    anchors.clear(); crossed.length = 0;
    assert.deepEqual(picker.raycast(pickRay, { maxDistance: 24, basePlane: plane }), hits,
        "each new ray starts with fresh visited anchors");
}

console.log("Hover neighbourhoods preserve bridge, house and transformed boat loc hits");
