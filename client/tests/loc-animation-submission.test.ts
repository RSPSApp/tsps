import assert from "node:assert/strict";
import { test } from "node:test";
import { LocAnimated } from "../render/loc/LocAnimated";
import { LocAnimationUpdater, type LocAnimationGeometry } from "../render/loc/LocAnimationUpdater";
import { newDrawRange } from "../render/DrawRange";
import { createCacheVm } from "../scripts/cache/cs2-sweep";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { LocModelLoader } from "../rs/config/loctype/LocModelLoader";

(globalThis as any).self = globalThis;
const { WebGLMapSquare } = require("../render/WebGLMapSquare");
const { addLocEntities } = require("../render/loader/SdMapDataLoader");
const { SceneRaycaster } = require("../game/scene/SceneRaycaster");

function sequence(skeletal: boolean) {
    return { id: 1, frameIds: [10, 11, 12], frameLengths: [6, 6, 6], frameStep: 2,
        frameSounds: new Map([[0, [1]], [1, [1]], [2, [1]]]),
        isSkeletalSeq: () => skeletal, getSkeletalDuration: () => 3,
        getFrameLength: () => 6 } as any;
}

function loc(skeletal = false, smooth = true): LocAnimated {
    const frames = Array.from({ length: smooth && !skeletal ? 12 : 3 }, (_, i) => newDrawRange(i * 24, i * 6));
    return new LocAnimated(0, 0, 0, 0, -1, -1, -1, -1,
        { frames, framesAlpha: frames.map(r => newDrawRange(r[0] + 1000, r[1] + 3)),
            frameStarts: smooth && !skeletal ? [0, 4, 8] : undefined },
        sequence(skeletal), 0, false, 44776, 10, 20, 0, 1);
}

function geometry(): LocAnimationGeometry {
    const batch = () => {
        const range = newDrawRange(0, 0);
        range.chunk = [8, 16]; range.bounds = [8, -4, 16, 16, 4, 24];
        return { drawRanges: [range], drawCall: { offsets: [0], numElements: [0] } };
    };
    return { drawCall: batch(), drawCallAlpha: batch(), drawCallLod: batch(), drawCallLodAlpha: batch() };
}

test("native Bloom plants keep their grown base model after growth ends, with and without smoothing", () => {
    const { info, cache } = createCacheVm();
    const factory = getCacheLoaderFactory(info, cache);
    const loader = new LocModelLoader(factory.getLocTypeLoader(), factory.getModelLoader(), factory.getTextureLoader(),
        factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
    for (const id of [3509, 3511, 3513]) for (const smooth of [false, true]) {
        const type = loader.locTypeLoader.load(id);
        const seq = loader.seqTypeLoader.load(type.seqId);
        const baked: any[] = [];
        const scene = { levels: 1, isInside: () => false, tileHeights: [Array.from({length: 4}, () => new Int32Array(4))],
            tiles: [Array.from({length: 4}, () => Array(4))] };
        const buffer = { addModelAnimFrame(model: any) {
            baked.push(model);
            return newDrawRange(baked.length * 3, 3);
        }};
        const [group] = [...addLocEntities(false, loader, {} as any, scene as any, [], [], buffer as any,
            [{entity: {id, type: 10, rotation: 0, tileX: 1, tileY: 1, level: 0, seqId: type.seqId}, level: 0}] as any, smooth)];
        assert.ok(group.anim.baseFrame !== undefined, `${id} has an unanimated fallback`);
        const animated = new LocAnimated(0, 0, 0, 0, -1, -1, -1, -1,
            group.anim, seq, 0, false, id, 1, 1, 0, 0);
        const lastCycle = seq.frameLengths.reduce((a: number, b: number) => a + b, 0);
        animated.update(loader.seqFrameLoader, lastCycle - 1);
        assert.ok(animated.seqType, "the last held growth frame is still active");
        assert.ok(animated.drawFrame() < group.anim.baseFrame!, "smoothing cannot select the fallback early");
        animated.update(loader.seqFrameLoader, lastCycle + 1);
        assert.equal(animated.seqType, undefined);
        assert.equal(animated.drawFrame(), group.anim.baseFrame, "finished growth draws its grown model, not frame zero");
        const base = loader.getModelAnimated(type, 10, 0, -1, 0)!;
        const grown = baked[group.anim.baseFrame! * 2];
        assert.deepEqual(grown.verticesY, base.verticesY);
        const picker = new SceneRaycaster({}, {});
        picker.getInteractLocModelLoader = () => loader;
        assert.deepEqual(picker.getLocModelMesh(type, 10, 0, animated).verticesY, base.verticesY,
            "the grown plant's click mesh follows its submitted base pose");
        const batches = geometry();
        new LocAnimationUpdater().update([animated], batches, loader.seqFrameLoader, lastCycle + 2);
        assert.deepEqual(batches.drawCall!.drawRanges[0].slice(), group.anim.frames[group.anim.baseFrame!].slice(),
            "the grown pose reaches the actual submitted draw ranges");
    }
});

test("WebGL shares opaque/alpha/full/far poses across 240 FPS, HD and sunken passes", () => {
    const animated = loc();
    const batches = geometry();
    const square = Object.assign(Object.create(WebGLMapSquare.prototype), {
        locsAnimated: [animated], loc: batches, locAnimationUpdater: new LocAnimationUpdater(),
    });
    let updates = 0, selections = 0;
    const originalUpdate = animated.update.bind(animated), originalDrawFrame = animated.drawFrame.bind(animated);
    animated.update = (...args) => { updates++; return originalUpdate(...args); };
    animated.drawFrame = () => { selections++; return originalDrawFrame(); };
    for (let frame = 0; frame < 240; frame++) {
        const cycle = Math.floor(frame * 50 / 240);
        // Tick, opaque, alpha, HD opaque/alpha and SunkenLocs all visit this map.
        square.updateAnimatedLocs({}, cycle, () => {});
        for (let pass = 0; pass < 5; pass++) square.updateAnimatedLocs({}, cycle);
    }
    assert.equal(updates, 50);
    assert.equal(selections, 50);
    const changed = geometry();
    square.loc = changed;
    square.updateAnimatedLocs({}, 49);
    assert.equal(updates, 51, "a partial rebuild repairs ranges during the same client cycle");
    assert.equal(selections, 51);
    assert.deepEqual(changed.drawCall!.drawRanges[0].slice(), batches.drawCall!.drawRanges[0].slice());
});

test("submitted poses and sounds match unthrottled legacy/skeletal/smoothed animation timing", () => {
    for (const skeletal of [false, true]) for (const smooth of [false, true]) {
        const expected = loc(skeletal, smooth), actual = loc(skeletal, smooth);
        const updater = new LocAnimationUpdater(), batches = geometry();
        const locs = [actual];
        const expectedSounds: number[] = [], actualSounds: number[] = [];
        const sound = (_: unknown, frame: number) => actualSounds.push(frame);
        const expectedSound = (_: unknown, frame: number) => expectedSounds.push(frame);
        for (let frame = 0; frame < 240; frame++) {
            const cycle = Math.floor(frame * 50 / 240);
            expected.update({} as any, cycle, expectedSound);
            const key = expected.drawFrame();
            updater.update(locs, batches, {} as any, cycle, sound);
            updater.update(locs, batches, {} as any, cycle);
            for (const alpha of [false, true]) for (const lod of [false, true]) {
                const batch = alpha ? (lod ? batches.drawCallLodAlpha : batches.drawCallAlpha)
                    : (lod ? batches.drawCallLod : batches.drawCall);
                const range = (alpha ? expected.anim.framesAlpha! : expected.anim.frames)[key];
                assert.deepEqual(batch!.drawRanges[0].slice(), range.slice(), `pose at ${cycle}, skeletal=${skeletal}, smooth=${smooth}`);
                assert.deepEqual(batch!.drawRanges[0].chunk, [8, 16]);
                assert.deepEqual(batch!.drawRanges[0].bounds, [8, -4, 16, 16, 4, 24]);
                assert.equal(batch!.drawCall!.offsets[0], range[0]);
                assert.equal((batch!.drawCall as any).numElements[0], range[1]);
            }
        }
        assert.deepEqual(actualSounds, expectedSounds);
    }
});
