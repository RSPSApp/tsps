import assert from "node:assert/strict";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { EquipmentSlot } from "../rs/config/player/Equipment";
import { Gender, PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../rs/config/player/PlayerModelLoader";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// Issue 1884: a skillcape showed the legs through its hem and the lining through its emblem,
// because legs shared the cape's depth layer and the cape's own face priorities were flattened.
const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const factory = getCacheLoaderFactory(cacheInfo, CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files));
const idkTypeLoader = factory.getIdkTypeLoader();
const objTypeLoader = factory.getObjTypeLoader();
const modelLoader = factory.getModelLoader();
const loader = new PlayerModelLoader(idkTypeLoader, objTypeLoader, modelLoader, factory.getTextureLoader());

const STRENGTH_CAPE_T = 9751;
const appearance = PlayerAppearance.defaultMale(idkTypeLoader);
const equip = new Array(14).fill(-1);
equip[EquipmentSlot.CAPE] = STRENGTH_CAPE_T;
const model = loader.buildStaticModelFromEquipment(appearance, equip);
assert.ok(model, "the player model should build");

// Faces are merged kit by kit (parts 0..6), then the equipment: find each part's range.
const ranges = new Map<string, [number, number]>();
let offset = 0;
for (let part = 0; part <= 6; part++) {
    const kitId = appearance.kits[part] ?? -1;
    if (kitId === -1) continue;
    for (const id of idkTypeLoader.load(kitId).modelIds ?? []) {
        const count = modelLoader.getModel(id)!.faceCount;
        ranges.set(`part${part}:${id}`, [offset, offset + count]);
        offset += count;
    }
}
const capeModel = modelLoader.getModel(objTypeLoader.load(STRENGTH_CAPE_T).maleModel)!;
const capeStart = offset;
assert.equal(model.faceCount, capeStart + capeModel.faceCount);

const layersOf = (start: number, end: number) => new Set(model.faceRenderLayers!.subarray(start, end));
for (const [key, [start, end]] of ranges) {
    if (key.startsWith("part5") || key.startsWith("part6")) {
        assert.deepEqual([...layersOf(start, end)], [0], `${key}: legs and feet must sit under a cape`);
    }
}

// The cape keeps its own order: priority 6-7 (outer faces, emblem) over 5 (back), and the lining
// (0) shares the legs' layer so the legs stay in front of it from the front.
const expected = new Map([[0, 0], [5, 6], [6, 7], [7, 7]]);
const priorities = capeModel.faceRenderPriorities;
assert.ok(priorities, "the skillcape model has per-face priorities");
const seen = new Set<number>();
for (let f = 0; f < capeModel.faceCount; f++) {
    const priority = priorities[f];
    assert.ok(expected.has(priority), `unexpected cape priority ${priority}`);
    assert.equal(model.faceRenderLayers![capeStart + f], expected.get(priority), `cape face ${f} (priority ${priority})`);
    seen.add(priority);
}
assert.deepEqual([...seen].sort(), [0, 5, 6, 7]);

// Items with a single priority keep the old flat layer.
const whip = new Array(14).fill(-1);
whip[EquipmentSlot.WEAPON] = 4151;
const armed = loader.buildStaticModelFromEquipment(appearance, whip)!;
const whipFaces = modelLoader.getModel(objTypeLoader.load(4151).maleModel)!.faceCount;
assert.deepEqual([...new Set(armed.faceRenderLayers!.subarray(armed.faceCount - whipFaces))], [7]);

const female = PlayerAppearance.defaultFemale(idkTypeLoader);
assert.equal(female.gender, Gender.FEMALE);
assert.ok(loader.buildStaticModelFromEquipment(female, equip), "the female model should build");

console.log("Player cape layer tests passed");
