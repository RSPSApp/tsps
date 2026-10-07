import assert from "node:assert/strict";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// PicoGL expects a browser global when SceneRaycaster imports WebGLMapSquare.
(globalThis as any).self = globalThis;
const { SceneRaycaster } = require("../game/scene/SceneRaycaster");

// A fairy ring's centre is a fully transparent disc; OSRS still clicks it (#372 follow-up).
const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const factory: any = getCacheLoaderFactory(
    cacheInfo,
    CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files),
);
const raycaster = new SceneRaycaster({}, {
    locTypeLoader: factory.getLocTypeLoader(),
    modelLoader: factory.getModelLoader(),
    textureLoader: factory.getTextureLoader(),
    seqTypeLoader: factory.getSeqTypeLoader(),
    seqFrameLoader: factory.getSeqFrameLoader(),
    skeletalSeqLoader: factory.getSkeletalSeqLoader?.(),
});
const fairyRing = factory.getLocTypeLoader().load(29495);
// Looking straight down onto the middle of the ring's tile (entity at 64, 64 fine units).
const t = raycaster.intersectLocModel(
    { origin: [0.5, -10, 0.5], direction: [0, 1, 0] },
    100,
    fairyRing,
    LocModelType.NORMAL,
    0,
    64,
    64,
    0,
);
assert.ok(t !== undefined, "the centre of a fairy ring is clickable");
console.log("Fairy ring pick regression passed");
