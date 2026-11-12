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

test("native Brimhaven blades bake and expire once; their default maxLoops99 does not make a loc loop", () => {
    const { info, cache } = createCacheVm();
    const factory = getCacheLoaderFactory(info, cache);
    const loader = new LocModelLoader(factory.getLocTypeLoader(), factory.getModelLoader(), factory.getTextureLoader(),
        factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
    assert.equal(loader.locTypeLoader.load(3567).seqId, 1103, "the changing scenery owns the saw animation");
    assert.equal(loader.locTypeLoader.load(3580).seqId, -1, "the spinning blade needs a server cue");
    for (const [id, seqId] of [[3567, 1103], [3580, 1107]]) {
        const type = loader.locTypeLoader.load(id), seq = loader.seqTypeLoader.load(seqId);
        assert.equal(type.ambientSoundId, -1); assert.ok(!type.ambientSoundIds?.length);
        assert.ok(!seq.frameSounds?.size, "explicit saw audio does not duplicate cache-owned sounds");
        assert.equal(seq.frameStep, -1); assert.equal(seq.maxLoops, 99);
        const scene = { levels: 1, isInside: () => false, tileHeights: [Array.from({length: 6}, () => new Int32Array(6))],
            tiles: [Array.from({length: 6}, () => Array(6))] };
        let count = 0;
        const buffer = { addModelAnimFrame: () => newDrawRange(count++ * 3, 3) };
        const [group] = [...addLocEntities(false, loader, {} as any, scene as any, [], [], buffer as any,
            [{entity: {id, type: 10, rotation: 0, tileX: 1, tileY: 1, level: 0, seqId}, level: 0}] as any, false)];
        assert.ok(group?.anim.frames.length > 1, `${id} has native animated geometry`);
        const animated = new LocAnimated(0, 0, 0, 0, -1, -1, -1, -1, group.anim, seq, 0, false, id, 1, 1, 0, 0);
        const duration = seq.frameLengths.reduce((a: number, b: number) => a + b, 0);
        const batches = geometry(), updater = new LocAnimationUpdater();
        updater.update([animated], batches, loader.seqFrameLoader, duration - 1);
        assert.ok(animated.seqType, "the animation remains through its final held frame");
        updater.update([animated], batches, loader.seqFrameLoader, duration + 1);
        assert.equal(animated.seqType, undefined, "one play ends despite maxLoops99");
        assert.deepEqual(batches.drawCall!.drawRanges[0].slice(), group.anim.frames[animated.drawFrame()].slice(),
            "expiry reaches the submitted base geometry");
    }
});

test("prepared course ropes submit the unanimated cache model before and after the swing", () => {
    const { info, cache } = createCacheVm();
    const factory = getCacheLoaderFactory(info, cache);
    const loader = new LocModelLoader(factory.getLocTypeLoader(), factory.getModelLoader(), factory.getTextureLoader(),
        factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
    for (const [id, rotation] of [[23131, 0], [23132, 2]]) {
        const type = loader.locTypeLoader.load(id);
        const sequence = loader.seqTypeLoader.load(497);
        const scene = { levels: 1, isInside: () => false,
            tileHeights: [Array.from({ length: 10 }, () => new Int32Array(10))],
            tiles: [Array.from({ length: 10 }, () => Array(10))] };
        const baked: ReturnType<LocModelLoader["getModelAnimated"]>[] = [];
        const buffer = { addModelAnimFrame(model: typeof baked[number]) {
            baked.push(model);
            return newDrawRange(baked.length * 3, 3);
        }};
        const [group] = [...addLocEntities(false, loader, {}, scene, [], [], buffer,
            [{ entity: { id, type: 10, rotation, tileX: 1, tileY: 1, level: 0, seqId: -1 },
                level: 0, sceneX: 192, sceneZ: 512 }])];
        const origin = group.locs[0].preparedOrigin!;
        const rest = group.anim.baseFrame!;
        const loc = new LocAnimated(0, 0, 0, 0, -1, -1, -1, -1, group.anim, sequence, 0, false,
            id, 192, 512, 0, rotation, origin);
        const cacheRest = loader.getModelAnimated(type, 10, rotation, -1, 0)!;
        const bakedRest = baked[rest * 2]!;
        assert.deepEqual(bakedRest.verticesX, cacheRest.verticesX);
        assert.deepEqual(bakedRest.verticesY, cacheRest.verticesY);
        assert.deepEqual(bakedRest.verticesZ, cacheRest.verticesZ);
        const batches = geometry(), updater = new LocAnimationUpdater();
        updater.update([loc], batches, loader.seqFrameLoader, 100);
        assert.deepEqual(batches.drawCall!.drawRanges[0].slice(), group.anim.frames[rest].slice());
        assert.ok(LocAnimated.playPrepared([loc], { x: origin.tileX, y: origin.tileY }, id, 0, 10, rotation, 497, 101));
        updater.update([loc], batches, loader.seqFrameLoader, 101);
        assert.deepEqual(batches.drawCall!.drawRanges[0].slice(), group.anim.frames[0].slice());
        const duration = sequence.frameLengths.reduce((a, b) => a + b, 0);
        updater.update([loc], batches, loader.seqFrameLoader, 102 + duration);
        assert.deepEqual(batches.drawCall!.drawRanges[0].slice(), group.anim.frames[rest].slice());
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

// #4693: use real scene construction, active cache models/frames and the shared
// geometry submission seam. This is native geometry proof, not rendered orbs.
function spiritTreeScene(loader: LocModelLoader, info: any, overrides: (number | undefined)[] = [undefined],
    id = 1293, randomStart?: boolean) {
    const { Scene } = require("../rs/scene/Scene");
    const { SceneBuilder, LocLoadType } = require("../rs/scene/SceneBuilder");
    const scene = new Scene(1, 24, 12);
    const builder = new SceneBuilder(info, {}, {}, {}, loader.locTypeLoader, loader, new Map());
    const locs = overrides.map((override, i) => {
        const x = 1 + i * 5;
        builder.addLoc(scene, 0, x, 1, id, 10, 0, undefined, LocLoadType.NO_MODELS, override, randomStart);
        const loc = scene.tiles[0][x][1].locs[0];
        assert.ok(loc, "the actual SceneBuilder creates the map entity");
        return { entity: loc.entity, sceneLoc: loc, level: 0, sceneX: loc.x, sceneZ: loc.y,
            heightOffset: loc.height, priority: 0, contourGround: 0, interactType: 1, interactId: id, lowDetail: false };
    });
    return { scene, locs };
}

function submitTreeScene(loader: LocModelLoader, vars: any, setup: ReturnType<typeof spiritTreeScene>, smooth = false) {
    const { SceneBuffer } = require("../render/buffer/SceneBuffer");
    const buffer = new SceneBuffer(loader.textureLoader, new Map(), 4096);
    const models: any[] = [], doors: any[] = [];
    const groups: any[] = [...addLocEntities(false, loader, vars, setup.scene, models, doors,
        buffer, setup.locs, smooth)];
    const submitted = buffer.addLocAnimatedGroups(groups);
    return { groups, submitted, buffer, models, doors };
}

function nativeLocLoaders() {
    const { info, cache } = createCacheVm();
    const factory = getCacheLoaderFactory(info, cache);
    const loader = new LocModelLoader(factory.getLocTypeLoader(), factory.getModelLoader(), factory.getTextureLoader(),
        factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
    const { VarManager } = require("../rs/config/vartype/VarManager");
    const vars = new VarManager(factory.getVarBitTypeLoader());
    return { info, loader, vars };
}

test("Tree Gnome orbs: ordinary scene construction submits the completed variant's default sequence", () => {
    const { info, loader, vars } = nativeLocLoaders();
    assert.equal(info.game, "oldschool"); assert.equal(info.revision, 242);
    const parent = loader.locTypeLoader.load(1293);
    assert.equal(parent.transformVarbit, 598); assert.equal(parent.seqId, 332);
    const setup = spiritTreeScene(loader, info);
    assert.equal(setup.locs[0].entity.seqId, 332, "the map entity begins with the parent's idle");
    for (const value of [0, 1]) {
        vars.setVarbit(598, value);
        const idle = submitTreeScene(loader, vars, setup);
        assert.equal(idle.submitted[0].seqId, 332);
        assert.equal(idle.groups[0].locs[0].interactId, 26259);
    }
    vars.setVarbit(598, 2);
    assert.equal(parent.transform(vars, loader.locTypeLoader)?.id, 26261);
    assert.equal(loader.locTypeLoader.load(26261).seqId, 333);
    for (const smooth of [false, true]) {
        const after = submitTreeScene(loader, vars, setup, smooth);
        assert.equal(after.submitted.length, 1);
        assert.equal(after.submitted[0].seqId, 333,
            "TREE_GNOME_ORBS4693_TRANSFORMED_DEFAULT: completed mesh must bake and submit its own sequence");
        assert.equal(after.groups[0].locs[0].interactId, 26261);
        assert.equal(after.submitted[0].randomStart, loader.locTypeLoader.load(26261).seqRandomStart);
        assert.ok(after.buffer.vertexCount() > 0, "actual cached geometry was baked");
        assert.ok(after.groups[0].anim.frames.every((range: number[]) => range[1] > 0), "each actual sequence frame submits geometry");
        const freshLogin = submitTreeScene(loader, vars, spiritTreeScene(loader, info), smooth);
        assert.equal(freshLogin.submitted[0].seqId, 333, "fresh completed login/map reload has the same selected sequence");
        assert.deepEqual(freshLogin.groups[0].anim.frames, after.groups[0].anim.frames);
        assert.deepEqual(freshLogin.buffer.indices, after.buffer.indices);
    }
    const completed = loader.locTypeLoader.load(26261);
    const moving = [0, 4].map(frame => loader.getModelAnimated(completed, 10, 0, 333, frame)!);
    assert.ok(moving.every(Boolean));
    assert.notDeepEqual([moving[0].verticesX, moving[0].verticesY, moving[0].verticesZ],
        [moving[1].verticesX, moving[1].verticesY, moving[1].verticesZ], "active sequence moves actual model vertices (not visible-orb count proof)");
});

test("Tree Gnome orbs: equal-id packet override, explicit stop and override expiry stay distinct from defaults", () => {
    const { info, loader, vars } = nativeLocLoaders(); vars.setVarbit(598, 2);
    // One ordinary default, an explicit packet equal to the parent default, and
    // an explicit stop coexist on the same selected model in one geometry build.
    const setup = spiritTreeScene(loader, info, [undefined, 332, -1], 1293, false);
    const built = submitTreeScene(loader, vars, setup);
    assert.deepEqual(built.submitted.map((entry: any) => entry.seqId), [333, 332]);
    assert.equal(built.groups.length, 2, "different effective sequences cannot share baked geometry");
    assert.deepEqual(setup.locs.map(loc => loc.entity.seqOverride), [undefined, 332, -1]);
    assert.ok(built.submitted.every((entry: any) => entry.randomStart === false), "explicit random-start override is retained");
    assert.equal(built.models.length, 1, "-1 submits a static model instead of falling back to the variant animation");
    assert.equal(built.models[0].interactId, 26261);
    const restored = submitTreeScene(loader, vars, spiritTreeScene(loader, info));
    assert.equal(restored.submitted[0].seqId, 333, "rebuild after packet override expiry restores the selected default");
    const unrelated = submitTreeScene(loader, vars, spiritTreeScene(loader, info, [undefined], 26260));
    assert.equal(unrelated.submitted[0].seqId, 332, "an untransformed tree keeps its own idle");
});

test("multiloc defaults: static, random-sequence and random-start variants preserve explicit stops", () => {
    const { info, loader, vars } = nativeLocLoaders();
    const nativeTypes = loader.locTypeLoader;
    const source = nativeTypes.load(26261);
    const copy = (fields: any) => Object.assign(Object.create(Object.getPrototypeOf(source)), source, fields);
    // Explicit synthetic config shapes over the actual cache model/sequence loaders.
    // These do not assert that the active cache has these artificial loc ids.
    const parent = copy({ id: 900001, seqId: 332, seqRandomStart: true,
        transforms: [900002, 900002], transformVarbit: -1, transformVarp: 42 });
    const variant = copy({ id: 900002, seqId: -1, seqRandomStart: false, transforms: undefined, randomSeqIds: undefined });
    const fixtureTypes: any = { load: (id: number) => id === parent.id ? parent : id === variant.id ? variant : nativeTypes.load(id) };
    const fixture = new LocModelLoader(fixtureTypes, loader.modelLoader, loader.textureLoader,
        loader.seqTypeLoader, loader.seqFrameLoader, loader.skeletalSeqLoader);
    vars.setVarp(42, 0);
    const staticVariant = submitTreeScene(fixture, vars, spiritTreeScene(fixture, info, [undefined], parent.id));
    assert.equal(staticVariant.groups.length, 0); assert.equal(staticVariant.models.length, 1,
        "an unanimated selected variant does not inherit the parent's sequence");
    variant.randomSeqIds = [333, 332];
    const random = submitTreeScene(fixture, vars, spiritTreeScene(fixture, info, [undefined], parent.id));
    assert.equal(random.submitted[0].seqId, 333, "selected random-sequence list follows existing first-entry policy");
    assert.equal(random.submitted[0].randomStart, false, "selected variant owns default random-start policy");
    const stopped = submitTreeScene(fixture, vars, spiritTreeScene(fixture, info, [-1], parent.id));
    assert.equal(stopped.groups.length, 0); assert.equal(stopped.models.length, 1);
    parent.transforms = undefined; parent.seqId = -1; parent.randomSeqIds = [332];
    const stoppedRandom = spiritTreeScene(fixture, info, [-1], parent.id);
    assert.equal(stoppedRandom.locs[0].entity.seqId, -1, "explicit stop suppresses parent random fallback too");
    const submittedStop = submitTreeScene(fixture, vars, stoppedRandom);
    assert.equal(submittedStop.groups.length, 0); assert.equal(submittedStop.models.length, 1);
});

test("prepared ropes: SceneBuilder keeps an explicit stop static while the default remains prepared", () => {
    const { info, loader, vars } = nativeLocLoaders();
    for (const id of [23131, 23132]) {
        const setup = spiritTreeScene(loader, info, [undefined, -1], id);
        const built = submitTreeScene(loader, vars, setup);
        assert.equal(built.groups.length, 1);
        assert.equal(built.groups[0].locs.length, 1, "only the default rope is prepared for a later packet");
        assert.equal(built.submitted[0].seqId, 497);
        assert.ok(built.submitted[0].preparedOrigin, "default keeps the original rest/swing/expiry path");
        assert.ok(built.groups[0].anim.baseFrame !== undefined, "default has actual baked rest geometry");
        assert.equal(built.models.length, 1, "explicit -1 contributes only a static cache model");
        assert.equal(built.models[0].interactId, id);
        assert.equal(built.models[0].entity.seqOverride, -1);
        assert.equal(built.models[0].preparedOrigin, undefined);
        assert.ok(!built.groups.some((group: any) => group.locs.some((loc: any) => loc.sceneLoc === setup.locs[1].sceneLoc)),
            "the stopped rope has neither an animated group nor a prepared origin");
    }
});
