import { strict as assert } from "node:assert";

import { SceneBuffer, type SceneModel } from "../render/buffer/SceneBuffer";
import { addLocEntities } from "../render/loader/SdMapDataLoader";
import { getSceneLocs } from "../render/loc/SceneLocs";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { LocModelLoader } from "../rs/config/loctype/LocModelLoader";
import { VarManager } from "../rs/config/vartype/VarManager";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// A loc change reloads a map square's locs as entities (LocLoadType.NO_MODELS). They must sit
// where the full build put them: the locs under Lumbridge's bridge were drawn at deck height,
// covering the walkway, after any loc change in the map square.
const info = loadCacheList(loadCacheInfos()).latest;
const cache = loadCache(info);
const factory = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, cache.files));
const locTypeLoader = factory.getLocTypeLoader();
const locModelLoader = new LocModelLoader(locTypeLoader, factory.getModelLoader(), factory.getTextureLoader(),
    factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
const builder = new SceneBuilder(info, factory.getMapFileLoader(), factory.getUnderlayTypeLoader(),
    factory.getOverlayTypeLoader(), locTypeLoader, locModelLoader, cache.xteas);

const border = 6;
const baseX = 3200 - border;
const baseY = 3200 - border;
const build = (type: LocLoadType) => builder.buildScene(baseX, baseY, 76, 76, true, type);
const onBridge = (m: SceneModel) => {
    const x = (m.sceneX >> 7) + baseX + border;
    const y = (m.sceneZ >> 7) + baseY + border;
    return x >= 3238 && x <= 3248 && y >= 3223 && y <= 3228;
};
const key = (m: SceneModel) => `${m.interactId},${m.sceneX},${m.sceneZ},${m.level}`;
const heights = (m: SceneModel) => `${m.sceneHeight}:${Array.from(m.model.verticesY).join()}`;

const full = new Map(getSceneLocs(locTypeLoader, build(LocLoadType.MODELS), border, 3).locs
    .filter(onBridge).map((m) => [key(m), heights(m)]));

const scene = build(LocLoadType.NO_MODELS);
const partial: SceneModel[] = [];
addLocEntities(builder.centerLocHeightWithSize, locModelLoader, new VarManager(factory.getVarBitTypeLoader()),
    scene, partial, [], new SceneBuffer(factory.getTextureLoader(), new Map(), 1000),
    getSceneLocs(locTypeLoader, scene, border, 3).locEntities);

const bridge = partial.filter(onBridge);
assert.ok(bridge.length > 10, "the bridge's locs reload as entities");
for (const m of bridge) {
    assert.equal(heights(m), full.get(key(m)), `loc ${key(m)} keeps its full-build height`);
}
console.log(`Partial loc reload: ${bridge.length} Lumbridge bridge locs keep their heights`);
