import assert from "node:assert/strict";

import { PlayerPoseGeometry } from "../render/webgpu/actors/actorPlayers";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// A sequence's frames stream in after it starts: the rest pose drawn meanwhile must not be kept
// under that frame's key, or every later pass through the frame draws the player unanimated.
const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const factory = getCacheLoaderFactory(cacheInfo, CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files));
const frames = factory.getSeqFrameLoader();
let streamed = false;
const client: any = {
    textureLoader: factory.getTextureLoader(),
    seqTypeLoader: factory.getSeqTypeLoader(),
    seqFrameLoader: { load: (id: number) => (streamed ? frames.load(id) : undefined), clearCache() {} },
};
const geometry: any = new PlayerPoseGeometry(client, new Map(), new Set(), () => {});
const obj = factory.getObjTypeLoader().load(1127); // rune platebody
const baseModel = factory.getModelLoader().getModel(obj.maleModel)!.light(client.textureLoader, 64, 850, -30, -50, -30);
const base = { baseModel, baseCenterX: 0, baseCenterZ: 0 };
const anim = { seqId: 808, frameIdx: 0 }; // player idle

const isRest = (m: Float32Array) => m.every((v, i) => v === [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0][i % 12]);

const loading = geometry.poseFor("idle|0", base, anim);
assert.ok(loading && isRest(loading), "the rest pose while the frame is missing");
streamed = true;
const posed = geometry.poseFor("idle|0", base, anim);
assert.ok(posed && !isRest(posed), "the frame's pose once it has streamed in");

streamed = false;
const [, animated] = geometry.build(baseModel, 0, 0, anim);
assert.equal(animated, false, "the CPU mesh says it is unanimated, so it is not cached");

// A player's graphic (the arrow pullback, spot anim 19) is drawn and cached per frame: while the
// frame streams in, there is nothing to draw, not the unanimated model (an arrow at the feet).
const spotRenderer: any = {
    renderer: { osrsClient: { ...client, spotAnimTypeLoader: factory.getSpotAnimTypeLoader() } },
    buildSpotBaseModel: () => baseModel,
    applySpotTransform() {},
};
(globalThis as any).self ??= globalThis; // PicoGL reads it when PlayerRenderer loads
const { PlayerRenderer } = require("../render/player/PlayerRenderer");
const spotFrame = PlayerRenderer.prototype.buildSpotFrameModelForFrame;
streamed = false;
assert.equal(spotFrame.call(spotRenderer, 19, 0), undefined, "no graphic while its frame is missing");
streamed = true;
assert.ok(spotFrame.call(spotRenderer, 19, 0), "the graphic once its frame has streamed in");

console.log("player-pose-streaming ok");
