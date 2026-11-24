import assert from "node:assert/strict";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";
import { Model2DRenderer } from "../ui/model/Model2DRenderer";
import { NpcModelLoader } from "../rs/config/npctype/NpcModelLoader";
import { BLACK_DEMON, GREEN_DRAGON, MAN, VORKATH } from "@runelite/api/gameval/NpcID";

// A widget model larger than the 1024-pixel render cap that fills its widget (the spyglass's
// frame in Sailing's sea charting, interface 936) is cut to the widget around its centre, where
// it is drawn. Cutting it to its first 1024 pixels from the left drew only the frame's left half.
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

const model = factory
    .getModelLoader()
    .getModel(16240)!
    .light(factory.getTextureLoader(), 64, 768, -50, -10, -50);
// Close up, so the model projects far wider than the cap.
const params = { xan2d: 0, yan2d: 0, zan2d: 0, zoom2d: 60, offsetX2d: 0, offsetY2d: 0 };

const widget = { width: 1500, height: 900 };
const cut = renderer.renderModelExtents(model, params, 16240, canvas(), widget);
assert.ok(cut.canvas.width > 1024, `the widget's width is kept (${cut.canvas.width})`);
assert.ok(cut.canvas.width <= widget.width + 12, "and no more than it");
// Drawn at the widget's centre minus offsetX: the cut is centred on it.
assert.ok(Math.abs(cut.offsetX - cut.canvas.width / 2) <= 4, `centred (offset ${cut.offsetX} of ${cut.canvas.width})`);

// A model within the cap is untouched by its widget.
const small = { ...params, zoom2d: 2000 };
const plain = renderer.renderModelExtents(model, small, 16240, canvas());
const inWidget = renderer.renderModelExtents(model, small, 16240, canvas(), widget);
assert.deepEqual([inWidget.canvas.width, inWidget.offsetX], [plain.canvas.width, plain.offsetX]);

// NPC bodies are based at their feet. Fitted previews must centre their projected
// bounds, otherwise the parent clip cuts off the head even when the scale fits.
const npcModels = new NpcModelLoader(factory.getNpcTypeLoader(), factory.getModelLoader(),
    factory.getTextureLoader(), factory.getSeqTypeLoader(), factory.getSeqFrameLoader(),
    undefined, {} as any);
const { DEFINITION, C, uid } = require('../../server/plugins/interface/monsterexamine/Layout.MonsterExamine');
const modelWidget = DEFINITION.widgets.find((widget: any) => widget.uid === uid(C.MODEL));
const previewWidth = modelWidget.rawWidth, previewHeight = modelWidget.rawHeight;
const bestiary = require('../../server/plugins/interface/bestiary/Layout.Bestiary');
const thumbnail = bestiary.DEFINITION.widgets.find((widget: any) => widget.uid === bestiary.uid(bestiary.C.MODEL));
assert.equal(thumbnail.npcFullBody, true);
assert.equal(thumbnail.type, 6, 'Bestiary thumbnails are native model widgets');
for (const id of [MAN, BLACK_DEMON, GREEN_DRAGON, VORKATH]) {
    const type = factory.getNpcTypeLoader().load(id)!;
    const seq = factory.getSeqTypeLoader().load(type.idleSeqId)!;
    const lastFrame = seq.isSkeletalSeq() ? seq.getSkeletalDuration() - 1 : seq.frameIds.length - 1;
    for (const frame of [0, Math.floor(lastFrame / 2), lastFrame]) {
        const body = npcModels.getModel(type, type.idleSeqId, frame)!;
        const miniature = renderer.renderModelInstanceToCanvasExtents(body, {
            xan2d: 160, yan2d: 256, zoom2d: 1500,
            fitToWidget: { width: thumbnail.rawWidth, height: thumbnail.rawHeight, padding: 8 },
        }, canvas());
        assert.ok(miniature.canvas.width <= thumbnail.rawWidth && miniature.canvas.height <= thumbnail.rawHeight);
        assert.ok((miniature.canvas as any).pixels.some((value: number, index: number) => index % 4 === 3 && value > 0),
            'the real posed cache body produces nonempty 3D thumbnail pixels');
        const preview = renderer.renderModelInstanceToCanvasExtents(body, {
            xan2d: 160, yan2d: 256, zoom2d: 1500,
            fitToWidget: { width: previewWidth, height: previewHeight, padding: 8 },
        }, canvas());
        assert.ok(preview.canvas.width <= previewWidth && preview.canvas.height <= previewHeight, 'a fitted NPC stays within its preview');
        assert.ok(previewHeight / 2 - preview.offsetY >= 0, 'the head stays below the preview top instead of being clipped');
        assert.ok(previewHeight / 2 - preview.offsetY + preview.canvas.height <= previewHeight, 'the feet stay inside the preview too');
        if (id === MAN && frame === 0) {
            const previous = renderer.renderModelInstanceToCanvasExtents(body, {
                xan2d: 160, yan2d: 256, zoom2d: 1500, fitToWidget: { width: 206, height: 112, padding: 8 },
            }, canvas());
            assert.ok(preview.canvas.height > previous.canvas.height * 1.2, 'a tall creature actually renders larger');
        }
        assert.ok(Math.abs(preview.offsetX - preview.canvas.width / 2) <= 1, 'fitted body is horizontally centred');
        assert.ok(Math.abs(preview.offsetY - preview.canvas.height / 2) <= 1, 'fitted body is vertically centred');
        let painted = 0;
        for (let y = 0; y < preview.canvas.height; y++) {
            for (let x = 0; x < preview.canvas.width; x++) {
                if (!preview.canvas.pixels[(y * preview.canvas.width + x) * 4 + 3]) continue;
                painted++;
                assert.ok(x > 0 && x < preview.canvas.width - 1 && y > 0 && y < preview.canvas.height - 1,
                    `NPC ${id} frame ${frame} raster has room around its complete silhouette`);
            }
        }
        assert.ok(painted > 100, `NPC ${id} frame ${frame} produces a visible full-body raster`);
    }
}

console.log("widget-model-oversize: native extents and fitted NPC framing passed");

// Scrolling a catalogue must not keep every native preview mesh in memory.
const bounded = new NpcModelLoader(factory.getNpcTypeLoader(), factory.getModelLoader(), factory.getTextureLoader(),
    factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), undefined, undefined as any, 2);
for (const id of [MAN, BLACK_DEMON, MAN, GREEN_DRAGON]) bounded.getModel(factory.getNpcTypeLoader().load(id)!, -1, -1);
assert.equal(bounded.modelCache.size, 2);
assert.equal(bounded.modelCache.has(BLACK_DEMON), false, 'the least recently used preview mesh unloads');
assert.equal(bounded.modelCache.has(MAN), true, 'recently used models survive eviction');
assert.equal(thumbnail.recycleModel, true, 'static and animated cards reuse a texture per pooled slot');


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
