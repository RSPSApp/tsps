import assert from "node:assert/strict";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { Gender, PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../rs/config/player/PlayerModelLoader";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// A body type B look without a jaw kit, as the server sends by default, is drawn clean-shaven
// (jaw kit 296, a plain chin), not with the first type B jaw kit (292, a moustache and beard).
// A chosen jaw kit still shows.
const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const factory = getCacheLoaderFactory(cacheInfo, CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files));
const idkTypeLoader = factory.getIdkTypeLoader();
const modelLoader = factory.getModelLoader();
const loader = new PlayerModelLoader(idkTypeLoader, factory.getObjTypeLoader(), modelLoader, factory.getTextureLoader());

const TYPE_B_BEARD_KIT = 292; // the first selectable type B jaw kit
const CLEAN_SHAVEN = PlayerAppearance.TYPE_B_CLEAN_SHAVEN_JAW_KIT;
assert.equal(CLEAN_SHAVEN, 296);
for (const kit of [TYPE_B_BEARD_KIT, CLEAN_SHAVEN]) {
    assert.equal(idkTypeLoader.load(kit).bodyPartyId, 8, `kit ${kit} is a type B jaw kit`);
}

const typeB = PlayerAppearance.defaultFemale(idkTypeLoader);
assert.equal(typeB.kits[1], CLEAN_SHAVEN, "the default type B look is clean-shaven");
assert.ok(typeB.kits.every((kit) => kit >= 0), "every default type B part has a kit");
assert.ok(PlayerAppearance.defaultMale(idkTypeLoader).kits[1] >= 0, "the default type A look keeps its jaw kit");

const jawFaces = (kit: number) =>
    (idkTypeLoader.load(kit).modelIds ?? []).reduce((sum, id) => sum + (modelLoader.getModel(id)?.faceCount ?? 0), 0);
const faces = (jaw: number) => {
    const kits = typeB.kits.slice();
    kits[1] = jaw;
    const appearance = new PlayerAppearance(Gender.FEMALE, [0, 0, 0, 0, 0], kits, new Array(14).fill(-1), { prayer: -1 });
    const model = loader.buildStaticModelFromEquipment(appearance, new Array(14).fill(-1));
    assert.ok(model, `type B model with jaw ${jaw} builds`);
    return model!.faceCount;
};
assert.notEqual(jawFaces(TYPE_B_BEARD_KIT), jawFaces(CLEAN_SHAVEN), "the two jaw kits differ");
assert.equal(faces(-1), faces(CLEAN_SHAVEN), "an empty type B jaw is drawn clean-shaven");
assert.equal(
    faces(TYPE_B_BEARD_KIT) - faces(CLEAN_SHAVEN),
    jawFaces(TYPE_B_BEARD_KIT) - jawFaces(CLEAN_SHAVEN),
    "a chosen type B jaw kit is drawn",
);

console.log("type B default jaw ok");
