import assert from "node:assert/strict";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { Gender, PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../rs/config/player/PlayerModelLoader";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// Body type B's jaw kits (body part 8) are all facial hair. A type B look without a jaw kit,
// as the server sends by default, is drawn without one; a chosen jaw kit still shows.
const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const factory = getCacheLoaderFactory(cacheInfo, CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files));
const idkTypeLoader = factory.getIdkTypeLoader();
const modelLoader = factory.getModelLoader();
const loader = new PlayerModelLoader(idkTypeLoader, factory.getObjTypeLoader(), modelLoader, factory.getTextureLoader());

const TYPE_B_JAW_KIT = 292; // first selectable body part 8 kit
assert.equal(idkTypeLoader.load(TYPE_B_JAW_KIT).bodyPartyId, 8, "kit 292 is a type B jaw kit");

const female = PlayerAppearance.defaultFemale(idkTypeLoader);
assert.equal(female.kits[1], -1, "the default type B look has no jaw kit");
assert.ok(female.kits.every((kit, part) => part === 1 || kit >= 0), "the other type B parts keep a kit");
assert.ok(PlayerAppearance.defaultMale(idkTypeLoader).kits[1] >= 0, "the default type A look keeps its jaw kit");

const faces = (jaw: number) => {
    const kits = female.kits.slice();
    kits[1] = jaw;
    const appearance = new PlayerAppearance(Gender.FEMALE, [0, 0, 0, 0, 0], kits, new Array(14).fill(-1), { prayer: -1 });
    const model = loader.buildStaticModelFromEquipment(appearance, new Array(14).fill(-1));
    assert.ok(model, `type B model with jaw ${jaw} builds`);
    return model!.faceCount;
};
const jawFaces = (idkTypeLoader.load(TYPE_B_JAW_KIT).modelIds ?? [])
    .reduce((sum, id) => sum + (modelLoader.getModel(id)?.faceCount ?? 0), 0);
assert.ok(jawFaces > 0, "the jaw kit has faces");
assert.equal(faces(TYPE_B_JAW_KIT) - faces(-1), jawFaces, "an empty type B jaw draws no facial hair; a chosen one draws");

console.log("type B default jaw ok");
