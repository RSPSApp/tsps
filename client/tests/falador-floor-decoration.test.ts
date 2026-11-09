import { strict as assert } from "node:assert";

import { getSceneLocs } from "../render/loc/SceneLocs";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { LocModelLoader } from "../rs/config/loctype/LocModelLoader";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

/**
 * #2004: Falador's park carries loc 767 — a 128x16 vertical edge strip — as a floor decoration on
 * plane 2 at 3005,3376, the mole hill's tile. Plane 2 has no floor there, so the strip is map
 * debris: it floated a storey above the mole hill and showed as a dark plank at low camera angles.
 * A floor decoration belongs to a floor, so one on an upper plane with no floor under it is not
 * drawn.
 *
 * The scene is built with `buildScene`, not `decodeLocs`: only the full build fills the underlay
 * and overlay arrays the rule reads, so a `decodeLocs` scene would make every upper-plane tile look
 * floorless and the assertion would pass for the wrong reason.
 */
const info = loadCacheList(loadCacheInfos()).latest;
const cache = loadCache(info);
const factory = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, cache.files));
const locTypeLoader = factory.getLocTypeLoader();
const locModelLoader = new LocModelLoader(
    locTypeLoader,
    factory.getModelLoader(),
    factory.getTextureLoader(),
    factory.getSeqTypeLoader(),
    factory.getSeqFrameLoader(),
    factory.getSkeletalSeqLoader(),
);
const builder = new SceneBuilder(
    info,
    factory.getMapFileLoader(),
    factory.getUnderlayTypeLoader(),
    factory.getOverlayTypeLoader(),
    locTypeLoader,
    locModelLoader,
    cache.xteas,
);

const STRIP = 767;
const MOLE_HILL = 12202;
const TIGHTROPE = 269;

// The park: 2976..3040 x 3344..3408 covers 3005,3376.
const PARK_X = 2976;
const PARK_Y = 3344;
const park = builder.buildScene(PARK_X, PARK_Y, 64, 64, true, LocLoadType.MODELS);
const parkLocs = getSceneLocs(locTypeLoader, park, 0, 3).locs;
const count = (list: { interactId: number }[], id: number) => list.filter((loc) => loc.interactId === id).length;

const tileX = 3005 - PARK_X;
const tileY = 3376 - PARK_Y;
assert.equal(park.tileUnderlays[2][tileX][tileY], 0, "plane 2 has no underlay on the mole hill's tile");
assert.equal(park.tileOverlays[2][tileX][tileY], 0, "plane 2 has no overlay on the mole hill's tile");
assert.equal(count(parkLocs, STRIP), 0, "the plane-2 strip over the mole hill is not drawn");
assert.ok(count(parkLocs, MOLE_HILL) > 0, "the mole hill on the floor below still is");

// The rule is about the missing floor, not the plane: the Falador rooftop tightrope is the same
// loc type (22) on plane 3, and its tiles do have a floor, so all six segments still draw.
const ROOF_X = 3008;
const ROOF_Y = 3328;
const roof = builder.buildScene(ROOF_X, ROOF_Y, 64, 64, true, LocLoadType.MODELS);
const rope = getSceneLocs(locTypeLoader, roof, 0, 3).locs.filter(
    (loc) =>
        loc.interactId === TIGHTROPE &&
        loc.level === 3 &&
        (loc.sceneZ >> 7) === 3343 - ROOF_Y &&
        (loc.sceneX >> 7) >= 3041 - ROOF_X &&
        (loc.sceneX >> 7) <= 3046 - ROOF_X,
);
assert.equal(rope.length, 6, "a floor decoration on a real upper floor is still drawn");

console.log("Falador floor decoration checks passed");
