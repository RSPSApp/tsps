import assert from "node:assert/strict";
import { collectHdLights, isHdLightSourceFace } from "../game/plugins/hd/HdLights";
import { SceneBuffer, getModelFaces } from "../render/buffer/SceneBuffer";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";
import { FloatUtil } from "../common/utils/FloatUtil";

const info = loadCacheList(loadCacheInfos()).latest;
const factory = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, loadCache(info).files));
const textures = factory.getTextureLoader();
for (const id of [196, 205]) {
    const loc = factory.getLocTypeLoader().load(id);
    const data = factory.getModelLoader().getModel(loc.models[0][0])!;
    const model = data.light(textures, 64, 850, -30, -50, -30);
    let sources = 0, frames = 0;
    for (let f = 0; f < model.faceCount; f++) {
        const lit = isHdLightSourceFace(id, model, f);
        if (((model.faceColors[f] >> 7) & 7) === 0) {
            assert.equal(lit, false, "metal frames must still receive normal lighting");
            frames++;
        }
        assert.equal(isHdLightSourceFace(-1, model, f), false, "ordinary scenery cannot become emissive");
        if (lit) sources++;
    }
    assert.ok(sources > 0 && frames > 0, `cache object ${id} has separate source and frame faces`);
    for (const animated of [false, true]) {
        const buffer = new SceneBuffer(textures, new Map(), 128);
        if (animated) buffer.addModelAnimFrame(model, false, undefined, false, id);
        else buffer.addModel(model, getModelFaces(model), undefined, true, undefined, false, id);
        let marked = 0;
        for (let v = 0; v < buffer.vertexCount(); v++) {
            const word = buffer.vertexBuf.view.getUint32(v * 12, true);
            if (FloatUtil.unpackFloat11(word & 0x7ff) === -1) marked++;
        }
        assert.ok(marked > 0 && marked < buffer.vertexCount(), "source marker survives packed static/animated geometry");
        if (!animated) {
            const vanilla = new SceneBuffer(textures, new Map(), 128);
            vanilla.addModel(model, getModelFaces(model));
            assert.equal(vanilla.indices.length, buffer.indices.length);
            for (let i = 0; i < buffer.indices.length; i++) {
                const litWord = buffer.vertexBuf.view.getUint32(buffer.indices[i] * 12 + 4, true);
                const vanillaWord = vanilla.vertexBuf.view.getUint32(vanilla.indices[i] * 12 + 4, true);
                assert.equal(litWord, vanillaWord, "vanilla colours, alpha and geometry are preserved");
            }
        }
    }
}

const tile = 16 * 64 + 16, offsets = new Uint32Array(4097);
offsets.fill(1, tile + 1);
const host = {
    playerPosUni: [16.5, 16.5], getPlayerRawPlane: () => 0,
    sampleHeightAtExactPlane: () => -4,
    mapManager: { visibleMapCount: 1, visibleMaps: [{
        getRenderBaseWorldX: () => 0, getRenderBaseWorldY: () => 0,
        tileLocOffsetsByLevel: [offsets], tileLocIdsByLevel: [new Int32Array([205])],
        tileLocTypeRotByLevel: [new Uint8Array([69])],
    }] },
    osrsClient: { locTypeLoader: { load: () => ({ sizeX: 1, sizeY: 1 }) } },
};
const positions = new Float32Array(64), colors = new Float32Array(64);
assert.equal(collectHdLights(host, positions, colors, 0), 1);
assert.equal(colors[3], 7.5 / 12 * 0.75, "lamp spill is 25% dimmer");
assert.equal(positions[3], 450 / 128, "light radius is unchanged");
assert.equal(colors[0], 1, "light keeps its warm colour");
console.log("HD lamp and torch tests passed");
