import { strict as assert } from "node:assert";

import { packTemplateChunk } from "../common/instance/InstanceTypes";
import { Scene } from "../rs/scene/Scene";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { LocModelLoader } from "../rs/config/loctype/LocModelLoader";
import { getSceneLocs } from "../render/loc/SceneLocs";
import { Model } from "../rs/model/Model";
import { getIdFromTag } from "../rs/scene/entity/EntityTag";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// A multi-tile loc sits on every tile it covers, but its normals merge once, from its start
// tile. Merged again from the others, its offsets were wrong and the repeating shingle rows of
// Ardeaglais's roof (Wyrmscraig) matched their neighbours by chance: a third of the roof's
// faces were hidden as occluded seams, leaving flat brown holes.
const info = loadCacheList(loadCacheInfos()).latest;
const cache = loadCache(info);
const factory = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, cache.files));
const locTypeLoader = factory.getLocTypeLoader();
const locModelLoader = new LocModelLoader(locTypeLoader, factory.getModelLoader(), factory.getTextureLoader(),
    factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
const builder = new SceneBuilder(info, factory.getMapFileLoader(), factory.getUnderlayTypeLoader(),
    factory.getOverlayTypeLoader(), locTypeLoader, locModelLoader, cache.xteas);

const scene = builder.buildScene(2496 - 6, 2176 - 6, 76, 76, true, LocLoadType.MODELS);
const roofs = new Set<Model>();
for (const column of scene.tiles[2]) {
    for (const tile of column) {
        for (const loc of tile?.locs ?? []) {
            const id = getIdFromTag(loc.tag);
            if (id >= 62279 && id <= 62342 && loc.entity instanceof Model) roofs.add(loc.entity);
        }
    }
}
assert.equal(roofs.size, 64, "the cathedral roof has 64 locs");

let faces = 0;
let hidden = 0;
for (const model of roofs) {
    faces += model.faceCount;
    for (let i = 0; i < model.faceCount; i++) if (model.faceColors3[i] === -2) hidden++;
}
assert.ok(hidden < faces * 0.01, `${hidden} of ${faces} roof faces hidden as merged seams`);
console.log(`Multi-tile loc normals: ${hidden} of ${faces} Ardeaglais roof faces hidden`);

// The walkways demote their columns and retain the original walls linked below.
// Merge while those walls still share their original plane, or each tile gets a dark edge.
function assertCastleWallSeams(scene: Scene, baseX: number, baseY: number): void {
    for (const [worldX, worldY, id, frontZ] of [[2419, 3087, 4409, -64], [2376, 3120, 1620, 64]]) {
        for (let x = worldX; x <= worldX + 1; x++) {
            const tile = scene.tiles[0][x - baseX][worldY - baseY];
            assert.ok(tile.isBridgeSurface, "the walkway still draws on its demoted plane");
            const wall = tile.linkedBelow?.wall;
            assert.ok(wall, "the original wall remains below the walkway");
            assert.equal(getIdFromTag(wall.tag), id);
            assert.ok(wall.entity0 instanceof Model);
            const model = wall.entity0;
            const left = new Map<number, number>(), right = new Map<number, number>();
            for (let i = 0; i < model.faceCount; i++) {
                if (model.faceColors3[i] < 0) continue;
                const indices = [model.indices1[i], model.indices2[i], model.indices3[i]];
                if (!indices.every(v => model.verticesZ[v] === frontZ)
                    || Math.max(...indices.map(v => model.verticesY[v])) - Math.min(...indices.map(v => model.verticesY[v])) < 200) continue;
                const colors = [model.faceColors1[i], model.faceColors2[i], model.faceColors3[i]];
                indices.forEach((v, j) => (model.verticesX[v] < 0 ? left : right).set(model.verticesY[v], colors[j]));
            }
            assert.equal(left.size, 2, "both front-face heights are present");
            assert.deepEqual(left, right, `wall ${id} at ${x},${worldY} must not darken one edge of each tile`);
        }
    }
}

const castleBaseX = 2360, castleBaseY = 3064;
const castleScene = builder.buildScene(castleBaseX, castleBaseY, 104, 104, true);
assertCastleWallSeams(castleScene, castleBaseX, castleBaseY);
// Before relinking, adjacent original-plane locs must use the same height even when
// only one tile carries the bridge flag. Sampling plane 2 here misses their normals.
const castleLoc = getSceneLocs(locTypeLoader, castleScene, 0, 3, 104, 0).locs.find(loc =>
    loc.interactId === 4908 && loc.level === 1 && loc.sceneX === 3008 && loc.sceneZ === 9024);
assert.ok(castleLoc, "the original-plane Castle Wars loc is present");
assert.equal(castleLoc.model.faceColors1[0], 54, "adjacent equal-height locs keep native shading");
const heightScene = new Scene(4, 2, 2);
heightScene.tileHeights[1].forEach(column => column.fill(-240));
heightScene.tileHeights[2].forEach(column => column.fill(-480));
heightScene.tileRenderFlags[1][0][0] = 2;
assert.equal(heightScene.getCenterHeight(1, 0, 0), -240, "initial lighting uses the original plane");
heightScene.applyBridgeLinks();
assert.equal(heightScene.getCenterHeight(1, 0, 0), -480, "later dynamic lighting uses the demoted plane");
const templates = Array.from({ length: 4 }, (_, plane) =>
    Array.from({ length: 13 }, (_, x) => Array.from({ length: 13 }, (_, y) =>
        packTemplateChunk(plane, castleBaseX / 8 + x, castleBaseY / 8 + y, 0))));
assertCastleWallSeams(builder.buildInstanceScene(templates, castleBaseX, castleBaseY, 104, 104, true), castleBaseX, castleBaseY);
console.log("Castle Wars walls: both bases retain continuous front-face shading in world and instance builds");
