import assert from "node:assert/strict";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";
import { Model2DRenderer } from "../ui/model/Model2DRenderer";

// Exercise native admin item previews with the real cache and model renderer.
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

/** A canvas stand-in for node: the renderer only sizes it and puts the pixels in. */
function canvas(): any {
    const surface: any = {
        width: 0,
        height: 0,
        getContext: () => ({
            createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
            putImageData(image: { data: Uint8ClampedArray }) { surface.pixels = image.data.slice(); },
        }),
    };
    return surface;
}


// Admin's native item preview is independent of the inventory icon's zoom.
const admin = require('../../server/plugins/tools/adminpanel/Layout.AdminPanel');
const definition = admin.buildInterface();
const itemPreview = definition.widgets.find((w: any) => w.uid === admin.uid(admin.COMPONENT.PANEL_ICON));
const description = definition.widgets.find((w: any) => w.uid === admin.uid(admin.COMPONENT.PANEL_DESCRIPTION));
assert.equal(itemPreview.fitModel, true);
assert.equal(description.rawY, itemPreview.rawY);
assert.ok(description.rawX >= itemPreview.rawX + itemPreview.rawWidth, 'item description is beside its preview');
(globalThis as any).document ??= { createElement: () => canvas() };
for (const id of [1215, 11802, 995]) {
    const type = factory.getObjTypeLoader().load(id)!;
    const params = { xan2d: type.xan2d, yan2d: type.yan2d, zan2d: type.zan2d, zoom2d: 152,
        fitToWidget: { width: itemPreview.rawWidth, height: itemPreview.rawHeight, padding: 8 } };
    const result = renderer.renderItemToCanvasExtents(id, 1, params, itemPreview.rawWidth, itemPreview.rawHeight);
    assert.ok(result && result.canvas.width <= itemPreview.rawWidth && result.canvas.height <= itemPreview.rawHeight);
    const painted = result.canvas.pixels.filter((value: number, i: number) => i % 4 === 3 && value > 0).length;
    assert.ok(painted > 150, `item ${id} has a clearly visible preview, not an inventory-scale speck`);
}
