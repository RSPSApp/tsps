import assert from "node:assert/strict";
import { test } from "node:test";

import { getModelFacesFiltered } from "../render/buffer/SceneBuffer";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

const info = loadCacheList(loadCacheInfos()).latest;
const factory = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, loadCache(info).files));

test("translucent faces are drawn lowest priority first, so the Aberrant spectre's body shows inside its shell", () => {
    const textureLoader = factory.getTextureLoader();
    const type = factory.getNpcTypeLoader().load(2); // Aberrant spectre
    const model = factory.getModelLoader().getModel(type.modelIds[0])!.light(textureLoader, 64, 850, -30, -50, -30);
    // Model 5085 lists its shell and eyes (priority 1) before its body (priority 0), all translucent.
    assert.equal(model.faceRenderPriorities[12], 1);
    assert.equal(model.faceRenderPriorities[76], 0);

    const faces = getModelFacesFiltered(model, textureLoader, true);
    assert.equal(faces.length, model.faceCount);
    const firstShell = faces.findIndex((face) => face.priority === 1);
    assert.ok(faces.slice(0, firstShell).every((face) => face.priority === 0), "body faces come first");
    assert.ok(faces.slice(firstShell).every((face) => face.priority === 1), "shell and eyes come last");
    // Stable within a priority: the model's own order is kept.
    for (let i = 1; i < faces.length; i++) {
        if (faces[i].priority === faces[i - 1].priority) assert.ok(faces[i].index > faces[i - 1].index);
    }
});
