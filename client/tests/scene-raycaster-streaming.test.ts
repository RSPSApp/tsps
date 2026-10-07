import assert from "node:assert/strict";

// PicoGL expects a browser global when SceneRaycaster imports WebGLMapSquare.
(globalThis as any).self = globalThis;
const { SceneRaycaster } = require("../game/scene/SceneRaycaster");

const modelLoader = { missCount: 0 };
const raycaster = new SceneRaycaster({}, { modelLoader });
let attempts = 0;
raycaster.getInteractLocModelLoader = () => ({
    getModelAnimated: () => {
        if (++attempts === 1) {
            return undefined;
        }
        return {
            verticesCount: 3,
            verticesX: new Int32Array([0, 128, 0]),
            verticesY: new Int32Array([0, 0, -128]),
            verticesZ: new Int32Array(3),
            faceCount: 1,
            indices1: new Int32Array([0]),
            indices2: new Int32Array([1]),
            indices3: new Int32Array([2]),
        };
    },
});

assert.equal(raycaster.getLocModelMesh({ id: 405 }, 10, 1), undefined, "do not cache a pending model as absent");
const mesh = raycaster.getLocModelMesh({ id: 405 }, 10, 1);
assert.equal(mesh?.faceCount, 1, "retry the object mesh after its model downloads");
assert.equal(raycaster.getLocModelMesh({ id: 405 }, 10, 1), mesh);
assert.equal(attempts, 2, "reuse successfully loaded geometry");

let typeAttempts = 0;
raycaster.osrsClient.locTypeLoader = {
    load: () => {
        if (++typeAttempts === 1) throw new Error("pending");
        return { id: 405 };
    },
};
assert.equal(raycaster.getResolvedLocType(405), undefined, "do not cache a pending definition as absent");
assert.equal(raycaster.getResolvedLocType(405)?.id, 405);
console.log("Scene raycaster streaming regression passed");

// Perdu's spawn overlaps the chair at 3090, 3494. An absent NPC model must
// leave the chair selectable, while a visible NPC still receives normal hits.
let npcType: any = { name: "null" };
raycaster.osrsClient.npcTypeLoader = { load: () => npcType };
raycaster.osrsClient.npcEcs = {
    queryByMap: () => [1], isActive: () => true, isLinked: () => true,
    getMapId: () => 12342, getWorldX: () => 3090 * 128,
    getWorldY: () => 3494 * 128, getSize: () => 1,
    getNpcTypeId: () => 7458, getLevel: () => 0, getServerId: () => 60001,
};
raycaster.sampleHeightAt = () => 0;
const pickNpc = () => {
    const hits: any[] = [];
    raycaster.collectNpcHitsForMap(
        { id: 12342, mapX: 48, mapY: 54 },
        { origin: [3090, -1, 3490], direction: [0, 0, 1] },
        10, hits, 0,
    );
    return hits;
};
assert.equal(pickNpc().length, 0, "model-less NPC does not intercept the chair");
npcType = { modelIds: [123] };
assert.equal(pickNpc()[0]?.interactId, 7458, "visible NPC remains selectable");
npcType = { transforms: [-1], transform: () => undefined };
assert.equal(pickNpc().length, 0, "hidden NPC transform does not intercept scenery");
npcType = { transforms: [1], transform: () => ({ modelIds: [123] }) };
assert.equal(pickNpc().length, 1, "visible transformed NPC remains selectable");
console.log("Scene raycaster invisible NPC regression passed");

// Sol Heredit (#372): size 5 is already the scaled footprint, and the box must stop at the
// scaled model's height (843 units), not size * scale again (13 tiles tall, 10 wide).
npcType = { id: 12821, modelIds: [1], widthScale: 300, heightScale: 300 };
raycaster.osrsClient.npcEcs.getSize = () => 5;
raycaster.npcHeightProvider = (id: number) => (id === 12821 ? 843 : 200);
const pickSol = (x: number, y: number) => {
    const hits: any[] = [];
    raycaster.collectNpcHitsForMap(
        { id: 12342, mapX: 48, mapY: 54 },
        { origin: [3090 + x, y, 3480], direction: [0, 0, 1] },
        30, hits, 0,
    );
    return hits.length;
};
assert.equal(pickSol(0, -6), 1, "Sol is hit within his model");
assert.equal(pickSol(0, -8), 0, "Sol is not hit above his model");
assert.equal(pickSol(3, -1), 0, "Sol is not hit beyond his footprint");

// With his posed model (RSModel.draw): two faces with a gap between them at x = 3090.
const face = (x: number) => [[x, 0, 3494], [x + 1, 0, 3494], [x, -6, 3494]] as const;
raycaster.npcTrianglesProvider = () => [...face(3088), ...face(3091)];
assert.equal(pickSol(-1.5, -1), 1, "a face of a large NPC is clickable");
assert.equal(pickSol(0, -1), 0, "a large NPC needs a face under the mouse, not just its box");
raycaster.osrsClient.npcEcs.getSize = () => 1;
assert.equal(pickSol(0, -1), 1, "a size-1 NPC is clicked anywhere in its model's box");
assert.equal(pickSol(-2.1, -1), 0, "outside the box plus 8 units");
console.log("Scene raycaster large NPC bounds regression passed");

// A house is a single 104-tile scene with an origin that need not align to 64 tiles.
const { MapManager } = require("../game/MapManager");
const { WebGLMapSquare } = require("../render/WebGLMapSquare");
const { getMapSquareId } = require("../rs/map/MapFileIndex");
const { sampleBridgeHeightForWorldTile } = require("../game/scene/BridgeHeightSampler");
const { getTileRenderFlagAt } = require("../game/scene/TileRenderFlags");
const { resolveInteractionPlaneForWorldTile } = require("../game/scene/PlaneResolver");
const { getPreferredMapForWorldTile, getMapLocalTile } = require("../render/render/interact/menu");
const { sampleTileVertexHeightWorldUnits, updateCameraTerrainPitchPressure } = require("../render/render/camera");
const maps = new MapManager(4, () => {});
const house = Object.assign(Object.create(WebGLMapSquare.prototype), {
    id: getMapSquareId(100, 100), mapX: 100, mapY: 100,
    renderPosX: 6408 / 64, renderPosY: 6424 / 64, borderSize: 0, heightMapSize: 104,
    heightMapData: new Int16Array(4 * 104 * 104).fill(160),
    getTileRenderFlag: (plane: number, x: number, y: number) => plane === 1 && x === 90 && y === 91 ? 2 : 0,
    isBridgeSurface: () => false,
});
maps.mapSquares.set(house.id, house);
const houseRaycaster = new SceneRaycaster(maps, {});
const host: any = { mapManager: maps, getControlledPlayerWorldViewId: () => -1, cameraTerrainPitchPressure: 32768 };
host.getPreferredMapForWorldTile = (x: number, y: number) => getPreferredMapForWorldTile(host, x, y);
host.getMapLocalTile = (map: any, x: number, y: number) => getMapLocalTile(host, map, x, y);
host.sampleTileVertexHeightWorldUnits = (x: number, y: number, plane: number) => sampleTileVertexHeightWorldUnits(host, x, y, plane);
for (const x of [0, 16, 55, 63, 64, 79, 90, 103]) {
    for (const y of [0, 16, 39, 63, 64, 79, 90, 103]) {
        const wx = 6408 + x, wy = 6424 + y;
        assert.equal(maps.getMapForWorldTile(wx, wy), house);
        assert.equal(host.getPreferredMapForWorldTile(wx, wy), house, "room interactions use the whole scene");
        assert.equal(houseRaycaster.getPreferredMapForWorldTile(wx, wy), house);
        assert.deepEqual(sampleBridgeHeightForWorldTile(maps, wx + 0.5, wy + 0.5, 1),
            { plane: 1, height: -10, valid: true }, "camera follow cannot drop to height zero at a map boundary");
        assert.equal(houseRaycaster.sampleHeightAt(wx + 0.5, wy + 0.5, 1), -10);
        assert.equal(host.sampleTileVertexHeightWorldUnits(wx, wy, 1), -1280);
        updateCameraTerrainPitchPressure(host, wx * 128 + 64, wy * 128 + 64, 1, 10);
        assert.equal(host.cameraTerrainPitchPressure, 32768, "flat house floors must not force camera pitch");
    }
}
// Distinct outer-room heights catch clamping or wrapping local coordinates at 63.
house.heightMapData[104 * 104 + 80 * 104 + 85] = 320;
assert.equal(sampleBridgeHeightForWorldTile(maps, 6493, 6504, 1).height, -20);
assert.equal(getTileRenderFlagAt(maps, 1, 6498, 6515), 2);
assert.equal(resolveInteractionPlaneForWorldTile(maps, 0, 6498, 6515), 1);
house.getLocIdsAtLocal = (plane: number, x: number, y: number) => plane === 1 && x === 90 && y === 85 ? [4515] : [];
house.getLocTypeRotsAtLocal = () => [10];
house.interactionPlane = -1;
houseRaycaster.osrsClient.groundItems = { getStacksAt: () => [] };
houseRaycaster.getResolvedLocType = () => ({ id: 4515, actions: ["Build"], sizeX: 1, sizeY: 1 });
houseRaycaster.getLocModelMesh = () => mesh;
const hotspotHits: any[] = [];
houseRaycaster.collectTileHits(house,
    { origin: [6498.75, -10.25, 6511], direction: [0, 0, -1] },
    6498, 6509, 10, hotspotHits, new Set(), new Map(), 1);
assert.equal(hotspotHits[0]?.interactId, 4515, "outer room build hotspots must be pickable at their rendered height");
assert.equal(hotspotHits[0]?.tileX, 6498);
assert.equal(hotspotHits[0]?.tileY, 6509);
for (const [x, y] of [[6407, 6424], [6512, 6424], [6408, 6423], [6408, 6528]]) {
    assert.equal(maps.getMapForWorldTile(x, y), undefined);
    assert.equal(sampleBridgeHeightForWorldTile(maps, x, y, 1).valid, false);
}
maps.worldEntityMapIds.add(house.id);
assert.equal(maps.getMapForWorldTile(6490, 6500), undefined, "overlays cannot become overworld terrain");
maps.mapSquares.clear();
const normal = { mapX: 100, mapY: 100 };
maps.worldEntityMapIds.clear();
maps.mapSquares.set(getMapSquareId(100, 100), normal);
assert.equal(maps.getMapForWorldTile(6463, 6463), normal);
assert.equal(maps.getMapForWorldTile(6464, 6463), undefined);
console.log("House camera heights and interaction scene bounds regression passed");

// A player on a boat deck stands in deck coordinates (9600+); their pick box must sit where
// the deck is drawn, or nobody can right-click them.
{
    const DECK_MAP_ID = 822400;
    const players = [
        { x: 3068, y: 2987, worldView: -1 },
        { x: 9603, y: 9604, worldView: 3000 },
    ];
    const deckPicker = new SceneRaycaster(
        {
            visibleMapCount: 1,
            visibleMaps: [{ id: DECK_MAP_ID }],
            getMapForWorldTile: () => undefined,
        },
        {
            playerEcs: {
                size: () => players.length,
                getIsHidden: () => false,
                getLevel: () => 0,
                getX: (i: number) => players[i].x * 128 + 64,
                getY: (i: number) => players[i].y * 128 + 64,
                getWorldViewId: (i: number) => players[i].worldView,
                getDefaultHeightTiles: () => 1.8,
            },
            worldViewManager: {
                getWorldView: (id: number) => (id === 3000 ? { overlayMapId: DECK_MAP_ID } : undefined),
            },
        },
    );
    deckPicker.sampleHeightAt = () => 0;
    deckPicker.deckToWorldProvider = (entity: number, fineX: number, fineY: number) =>
        entity === 3000
            ? { x: fineX - (9603 - 3069) * 128, y: fineY - (9604 - 2987) * 128 }
            : undefined;
    const hits: any[] = [];
    deckPicker.collectPlayerHits(
        { origin: [3069.5, -10, 2987.5], direction: [0, 1, 0] },
        100, hits, 0,
    );
    assert.equal(hits.length, 1, "the deck player is hit where their deck is drawn");
    assert.equal(hits[0].playerEcsIndex, 1);
    assert.deepEqual([hits[0].tileX, hits[0].tileY], [3069, 2987]);
    console.log("Scene raycaster deck player regression passed");
}
