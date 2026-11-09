import { strict as assert } from "node:assert";
import path from "node:path";
import fs from "node:fs";

import { loadCacheSystem } from "../scripts/cache/cs2-sweep";
import { Dat2CacheLoaderFactory } from "../rs/cache/loader/Dat2CacheLoaderFactory";
import { Scene } from "../rs/scene/Scene";
import { SceneBuilder, LocLoadType } from "../rs/scene/SceneBuilder";
import { getSceneLocs } from "../render/loc/SceneLocs";

/**
 * #2004: Falador's park carries loc 767 — a 128x16 vertical edge strip — as a floor decoration on
 * plane 2 at 3005,3376, the mole hill's tile. Plane 2 has no floor there, so the strip is map
 * debris: it floated about two storeys above the mole hill and showed as a dark plank at low camera
 * angles. A floor decoration belongs to a floor, so one on an upper plane with no floor under it is
 * not drawn.
 */
const cacheDir = path.resolve(
    __dirname,
    "../../server/caches",
    fs.readFileSync(path.resolve(__dirname, "../../server/target.txt"), "utf8").trim(),
);
const { cache, info } = loadCacheSystem(cacheDir);
const loaders = new Dat2CacheLoaderFactory(info, "dat2", cache);
const maps = loaders.getMapFileLoader();
const cacheKeys = JSON.parse(fs.readFileSync(path.join(cacheDir, "keys.json"), "utf8"));

const MAP_X = 46;
const MAP_Y = 52;
const STRIP = 767;
const MOLE_HILL = 12202;

const keys = new Map<number, number[]>([
    [maps.mapFileIndex.getLocArchiveId(MAP_X, MAP_Y), cacheKeys[(MAP_X << 8) | MAP_Y] ?? [0, 0, 0, 0]],
]);
const data = maps.getLocData(MAP_X, MAP_Y, keys);
assert.ok(data, "the cache landscape decodes");

const builder = new SceneBuilder(
    info,
    maps,
    loaders.getUnderlayTypeLoader(),
    loaders.getOverlayTypeLoader(),
    loaders.getLocTypeLoader(),
    {} as any,
    new Map(),
);
const scene = new Scene(4, 64, 64);
builder.decodeLocs(scene, data!, 0, 0, LocLoadType.NO_MODELS);

const emitted = () => {
    const locs = getSceneLocs(loaders.getLocTypeLoader(), scene, 0, 3, 64, 0);
    return [...locs.locs, ...locs.locEntities];
};
const count = (list: { interactId: number }[], id: number) => list.filter((loc) => loc.interactId === id).length;

// Every 767 in this square sits on plane 2 with no floor under it, so none of them is drawn.
assert.equal(count(emitted(), STRIP), 0, "the plane-2 strip over the mole hill is not drawn");
assert.ok(count(emitted(), MOLE_HILL) > 0, "the mole hill on the floor below still is");

// The rule is about the missing floor, not the plane: give the tile a floor and the strip returns.
const tileX = 3005 - MAP_X * 64;
const tileY = 3376 - MAP_Y * 64;
scene.tileUnderlays[2][tileX][tileY] = 1;
assert.equal(count(emitted(), STRIP), 1, "a floor decoration on a real upper floor is still drawn");

console.log("Falador floor decoration checks passed");
