import assert from "node:assert/strict";

import { SceneBuffer } from "../render/buffer/SceneBuffer";
import { addLocEntities } from "../render/loader/SdMapDataLoader";
import { getSceneLocs } from "../render/loc/SceneLocs";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { LocModelLoader } from "../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import { VarManager } from "../rs/config/vartype/VarManager";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// PicoGL expects a browser global when SceneRaycaster imports WebGLMapSquare.
(globalThis as any).self = globalThis;
const { SceneRaycaster } = require("../game/scene/SceneRaycaster");

// The Interdimensional rift on Draynor Manor's top floor is a multiloc: the map holds 11355, and varbit
// 1766 at 1 shows it as 11354, whose swirl (seq 3174, as the house portal's) is shrunk to one point in its
// first frame. The scene animates it under 11354, the raycaster looked its animation up under 11355 and
// click-tested that first frame, so the drawn rift had no Enter.
const info = loadCacheList(loadCacheInfos()).latest;
const cache = loadCache(info);
const factory: any = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, cache.files));
const locTypeLoader = factory.getLocTypeLoader();
const raycaster = new SceneRaycaster({}, {
    locTypeLoader,
    modelLoader: factory.getModelLoader(),
    textureLoader: factory.getTextureLoader(),
    seqTypeLoader: factory.getSeqTypeLoader(),
    seqFrameLoader: factory.getSeqFrameLoader(),
    skeletalSeqLoader: factory.getSkeletalSeqLoader?.(),
});
const HIDDEN = 11355;
const RIFT = 11354;
const PORTAL_VARBIT = 1766;
const rift = locTypeLoader.load(RIFT);
assert.deepEqual(locTypeLoader.load(HIDDEN).transforms, [-1, RIFT, -1]);
const seqType = factory.getSeqTypeLoader().load(rift.seqId);

// The rift (2x1) at (3110, 3362, 2), with the portal open.
const vars = new VarManager(factory.getVarBitTypeLoader());
vars.setVarbit(PORTAL_VARBIT, 1);
const locModelLoader = new LocModelLoader(locTypeLoader, factory.getModelLoader(), factory.getTextureLoader(),
    factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
const builder = new SceneBuilder(info, factory.getMapFileLoader(), factory.getUnderlayTypeLoader(),
    factory.getOverlayTypeLoader(), locTypeLoader, locModelLoader, cache.xteas);
const border = 6;
const mapX = 48, mapY = 52;
const scene = builder.buildScene(mapX * 64 - border, mapY * 64 - border, 76, 76, true, LocLoadType.NO_MODELS);
const sceneLocs = getSceneLocs(locTypeLoader, scene, border, 3);
const groups = addLocEntities(builder.centerLocHeightWithSize, locModelLoader, vars, scene, [], [],
    new SceneBuffer(factory.getTextureLoader(), new Map(), 1000), sceneLocs.locEntities);
const animated = new SceneBuffer(factory.getTextureLoader(), new Map(), 1000).addLocAnimatedGroups(groups);
// Raycaster fine position of the 2x1 rift: its centre, from the square's render base.
const sceneX = ((3110 - mapX * 64) << 7) + 128;
const sceneZ = ((3362 - mapY * 64) << 7) + 64;
const drawn = animated.find((loc) => loc.x === sceneX && loc.y === sceneZ);
assert.ok(drawn, "the open rift animates");
assert.equal(drawn.locId, RIFT, "under the form it draws, not the map's id");

// The raycaster asks with the map's id and the drawn form's, and finds that animation.
const playing = { id: RIFT, x: drawn.x, y: drawn.y, level: drawn.level, seqType, frame: 5 };
const map = { locsAnimated: [playing] };
assert.equal(raycaster.animatedLocAt(map, HIDDEN, drawn.level, sceneX, sceneZ), undefined,
    "the map's id alone does not find it");
assert.equal(raycaster.animatedLocAt(map, HIDDEN, drawn.level, sceneX, sceneZ, RIFT), playing);
assert.equal(raycaster.animatedLocAt(map, HIDDEN, drawn.level, sceneX, sceneZ + 128, RIFT), undefined);

// Straight through the rift's middle, beside the point the first frame shrinks to.
const throughCentre = (animation?: { seqType: unknown; frame: number }) =>
    raycaster.intersectLocModel(
        { origin: [1, -1.25, -1], direction: [0, 0, 1] },
        100,
        rift,
        LocModelType.NORMAL,
        0,
        128,
        64,
        0,
        animation,
    );
assert.equal(throughCentre(), undefined, "without its animation, the first frame's swirl is a single point");
assert.ok(throughCentre({ seqType, frame: 5 }) !== undefined, "the rift is clickable while its swirl shows");
console.log("Multiloc animation pick regression passed");
