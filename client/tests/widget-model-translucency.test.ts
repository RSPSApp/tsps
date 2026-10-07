import assert from "node:assert/strict";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";
import { Model2DRenderer } from "../ui/model/Model2DRenderer";

// OSRS draws widget models straight into the frame, so a translucent face shows what is behind
// the widget. The fairy ring dials (interface 398) rely on it: the selected letters show through
// the windows of the wooden bar in front of them (component 18, model 16236, face alpha 192).
const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const factory = getCacheLoaderFactory(
    cacheInfo,
    CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files),
);
const renderer: any = new Model2DRenderer(
    factory.getObjTypeLoader(),
    factory.getModelLoader(),
    factory.getTextureLoader(),
    factory.getSeqTypeLoader(),
    factory.getSeqFrameLoader(),
    undefined as any,
);

function coverage(modelId: number, xan2d: number): { opaque: number; translucent: number } {
    const model = factory
        .getModelLoader()
        .getModel(modelId)!
        .light(factory.getTextureLoader(), 64, 768, -50, -10, -50);
    const size = 400;
    const pixels: Uint8ClampedArray = renderer.renderModelSoftwareToPixels(
        model,
        { id: modelId, xan2d, yan2d: 0, zan2d: 0, zoom2d: 1000, offsetX2d: 0, offsetY2d: 0 },
        size,
        size,
        false,
        undefined,
        true,
    );
    let opaque = 0;
    let translucent = 0;
    for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] === 255) opaque++;
        else if (pixels[i] > 0) translucent++;
    }
    return { opaque, translucent };
}

const bar = coverage(16236, 1962);
assert.ok(bar.opaque > 0, "the bar's wood is opaque");
assert.ok(bar.translucent > 1000, "its three windows stay translucent");

const dial = coverage(16240, 0);
assert.equal(dial.translucent, 0, "a model without translucent faces is unchanged");

console.log("widget-model-translucency: ok");
