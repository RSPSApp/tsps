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
const CABBAGE_CAPE = 13679;
const ICTHLARIN_SHROUD = 27265;
const appearance = PlayerAppearance.defaultMale(idkTypeLoader);
const expectedCapeLayers = new Map([[0, 0], [5, 4], [6, 6], [7, 7]]);
const assertCapeLayers = (itemId: number, label: string) => {
    const equip = new Array(14).fill(-1);
    equip[EquipmentSlot.CAPE] = itemId;
    const playerModel = loader.buildStaticModelFromEquipment(appearance, equip);
    assert.ok(playerModel, `${label}: the player model should build`);

    // Faces are merged kit by kit (parts 0..6), then the equipment: find the cape's face range.
    const ranges: Array<{ part: number; start: number; end: number; id: number }> = [];
    let offset = 0;
    for (let part = 0; part <= 6; part++) {
        const kitId = appearance.kits[part] ?? -1;
        if (kitId === -1) continue;
        for (const id of idkTypeLoader.load(kitId).modelIds ?? []) {
            const count = modelLoader.getModel(id)!.faceCount;
            ranges.push({ part, start: offset, end: offset + count, id });
            offset += count;
        }
    }

    const capeModelData = modelLoader.getModel(objTypeLoader.load(itemId).maleModel)!;
    const capeStart = offset;
    assert.equal(playerModel.faceCount, capeStart + capeModelData.faceCount, `${label}: cape faces append after the body`);

    const layersOf = (start: number, end: number) =>
        new Set(playerModel.faceRenderLayers!.subarray(start, end));
    for (const { part, start, end, id } of ranges) {
        if (part === 5 || part === 6) {
            assert.deepEqual([...layersOf(start, end)], [0], `${label}: legs and feet (${id}) stay under the cape`);
        }
    }

    // Keep the cape's cache priority order and widen the cloth-to-panel gap to two bias bands.
    const priorities = capeModelData.faceRenderPriorities;
    assert.ok(priorities, `${label}: cape model should have per-face priorities`);
    const seen = new Set<number>();
    const priorityCounts = new Map<number, number>();
    for (let f = 0; f < capeModelData.faceCount; f++) {
        const priority = priorities[f];
        assert.ok(expectedCapeLayers.has(priority), `${label}: unexpected cape priority ${priority}`);
        assert.equal(
            playerModel.faceRenderLayers![capeStart + f],
            expectedCapeLayers.get(priority),
            `${label}: cape face ${f} (priority ${priority})`,
        );
        seen.add(priority);
        priorityCounts.set(priority, (priorityCounts.get(priority) ?? 0) + 1);
    }
    assert.deepEqual([...seen].sort(), [0, 5, 6, 7], `${label}: expected all four cape priority groups`);
    if (itemId === CABBAGE_CAPE) {
        assert.equal(priorityCounts.get(7), 2, "Cabbage cape priority 7 is the pair of collar-detail faces");
        assert.ok((priorityCounts.get(6) ?? 0) > 2, "Cabbage cape priority 6 carries the broad panel/emblem group");
    }
    if (itemId === ICTHLARIN_SHROUD) {
        assert.equal(objTypeLoader.load(itemId).maleModel, 45250, "Icthlarin's shroud uses the reviewed cache model");
        assert.ok((priorityCounts.get(7) ?? 0) >= 50, "Icthlarin's shroud priority 7 carries its broad central emblem");
        const priority7Ys: number[] = [];
        for (let face = 0; face < capeModelData.faceCount; face++) {
            if (priorities[face] !== 7) continue;
            priority7Ys.push(
                capeModelData.verticesY[capeModelData.indices1[face]],
                capeModelData.verticesY[capeModelData.indices2[face]],
                capeModelData.verticesY[capeModelData.indices3[face]],
            );
        }
        assert.ok(Math.min(...priority7Ys) <= -150 && Math.max(...priority7Ys) >= -100,
            "Icthlarin's priority-7 faces span its central back emblem");
        const layerForPriority = (priority: number) =>
            playerModel.faceRenderLayers![capeStart + priorities.findIndex((value) => value === priority)];
        assert.ok(layerForPriority(7) > layerForPriority(6),
            "priority-7 shroud emblem remains above the priority-6 panel");
    }
};

// Keep the previously fixed Strength cape layering covered while reproducing Cabbage cape's
// angle-dependent emblem issue against its actual cache model.
assertCapeLayers(STRENGTH_CAPE_T, "Strength cape");
assertCapeLayers(CABBAGE_CAPE, "Cabbage cape");
assertCapeLayers(ICTHLARIN_SHROUD, "Icthlarin's shroud");

// Items with a single priority keep the old flat layer.
const whip = new Array(14).fill(-1);
whip[EquipmentSlot.WEAPON] = 4151;
const armed = loader.buildStaticModelFromEquipment(appearance, whip)!;
const whipFaces = modelLoader.getModel(objTypeLoader.load(4151).maleModel)!.faceCount;
assert.deepEqual([...new Set(armed.faceRenderLayers!.subarray(armed.faceCount - whipFaces))], [7]);

const female = PlayerAppearance.defaultFemale(idkTypeLoader);
assert.equal(female.gender, Gender.FEMALE);
const strengthCapeEquip = new Array(14).fill(-1);
strengthCapeEquip[EquipmentSlot.CAPE] = STRENGTH_CAPE_T;
assert.ok(loader.buildStaticModelFromEquipment(female, strengthCapeEquip), "the female Strength cape model should build");

console.log("Player cape layer tests passed");
