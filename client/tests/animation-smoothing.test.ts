import { nextSequenceFrame, sequenceInterpolation, interpolationKey } from "../rs/model/seq/FrameInterpolation";
import { VertexBuffer } from "../render/buffer/VertexBuffer";
import { ACTOR_VERTEX_STRIDE } from "../render/buffer/ActorNormals";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { PluginInjector } from "../runelite/client/plugins/PluginInjector";
import { AnimationSmoothingConfig } from "../game/plugins/animationsmoothing/AnimationSmoothingConfig";
import { strict as assert } from "node:assert";

import { AnimationSmoothingPlugin } from "../game/plugins/animationsmoothing/AnimationSmoothingPlugin";
import { GfxCache, graphicFrameCycle } from "../render/gfx/GfxCache";
import { Model } from "../rs/model/Model";
import { SeqBase } from "../rs/model/seq/SeqBase";
import { SeqFrame } from "../rs/model/seq/SeqFrame";
import { SeqTransformType } from "../rs/model/seq/SeqTransformType";

// A skeleton with an origin, a translation, a rotation and a scale, over three vertices.
const base = new SeqBase(
    1,
    4,
    [
        SeqTransformType.ORIGIN,
        SeqTransformType.TRANSLATE,
        SeqTransformType.ROTATE,
        SeqTransformType.SCALE,
    ],
    [false, false, false, false],
    new Uint16Array([0xffff, 0xffff, 0xffff, 0xffff]),
    [[1], [0], [1], [0]],
);

/** A frame from [group, x, y, z] transforms (groups in increasing order). */
function frame(...transforms: Array<[number, number, number, number]>): SeqFrame {
    return new SeqFrame(
        4,
        base,
        transforms.length,
        transforms.map((t) => t[0]),
        transforms.map((t) => t[1]),
        transforms.map((t) => t[2]),
        transforms.map((t) => t[3]),
        transforms.map(() => -1),
        false,
    );
}

function model(): Model {
    const m = new Model();
    m.verticesCount = 3;
    m.verticesX = Int32Array.from([100, 50, -50]);
    m.verticesY = Int32Array.from([0, 200, 200]);
    m.verticesZ = Int32Array.from([10, 30, -30]);
    m.vertexLabels = [Int32Array.from([0]), Int32Array.from([1, 2])];
    return m;
}

const vertices = (m: Model) => [...m.verticesX, ...m.verticesY, ...m.verticesZ];
function animated(f: SeqFrame): number[] {
    const m = model();
    m.animateInterpolated(f, undefined, 0, false);
    return vertices(m);
}
function blended(a: SeqFrame, b: SeqFrame, alpha: number): number[] {
    const m = model();
    m.animateInterpolated(a, b, alpha, false);
    return vertices(m);
}

// Frame A: translate 10, rotate 250 (just below a full turn). Frame B: translate 20, rotate 6,
// and a scale that only B has.
const a = frame([0, 0, 0, 0], [1, 10, 0, 0], [2, 0, 250, 0]);
const b = frame([0, 0, 0, 0], [1, 20, 0, 0], [2, 0, 6, 0], [3, 192, 128, 128]);

// Halfway: translate 15; the rotation goes the short way across 0 (250 -> 256 = 0), not back
// through 128; the scale only B has starts from neutral 128, so 160.
assert.deepEqual(
    blended(a, b, 0.5),
    animated(frame([0, 0, 0, 0], [1, 15, 0, 0], [2, 0, 0, 0], [3, 160, 128, 128])),
);

assert.notDeepEqual(
    blended(a, b, 0.5),
    animated(frame([0, 0, 0, 0], [1, 15, 0, 0], [2, 0, 128, 0], [3, 160, 128, 128])),
    "not the long way round",
);

// Blend 0 is frame A; blend 1 is frame B.
assert.deepEqual(blended(a, b, 0), animated(a));
assert.deepEqual(blended(a, b, 1), animated(b));

// Without a next frame (the last frame), the frame is applied as it is.
const last = model();
last.animateInterpolated(a, undefined, 0.5, false);
assert.deepEqual(vertices(last), animated(a));

// Fractional transforms survive the blend, including translations below one model unit.
assert.deepEqual(
    blended(a, b, 0.25),
    animated(frame([0, 0, 0, 0], [1, 12.5, 0, 0], [2, 0, 253, 0], [3, 144, 128, 128])),
);

// A half turn has no short way round: it snaps (frame A held), or a part flipped every frame (the
// demonbane cast's staff, seq 8977) spins the same way each time.
const flipA = frame([0, 0, 0, 0], [2, 63, 0, 0]);
const flipB = frame([0, 0, 0, 0], [2, 63, 128, 128]);
assert.deepEqual(blended(flipA, flipB, 0.5), animated(flipA));
assert.deepEqual(blended(flipB, flipA, 0.5), animated(flipB));

// Origin resets. The decoder attaches a reset of an untransformed origin group to the first
// transform after it. Here frame C attaches origin 0's reset to its rotation, frame D to its
// translation (which also moves the rotation's vertices). Blended, the origin must be reset once,
// before the translation, as in the frame holding the halfway values; a second reset after the
// translation would move the rotation's pivot.
const pivotBase = new SeqBase(
    2,
    3,
    [SeqTransformType.ORIGIN, SeqTransformType.TRANSLATE, SeqTransformType.ROTATE],
    [false, false, false],
    new Uint16Array([0xffff, 0xffff, 0xffff]),
    [[1], [1], [1]],
);
function pivotFrame(...transforms: Array<[number, number, number, number, number]>): SeqFrame {
    return new SeqFrame(
        4,
        pivotBase,
        transforms.length,
        transforms.map((t) => t[0]),
        transforms.map((t) => t[1]),
        transforms.map((t) => t[2]),
        transforms.map((t) => t[3]),
        transforms.map((t) => t[4]),
        false,
    );
}
const c = pivotFrame([2, 0, 64, 0, 0]);
const d = pivotFrame([1, 100, 0, 0, 0], [2, 0, 64, 0, -1]);
const halfway = pivotFrame([1, 50, 0, 0, 0], [2, 0, 64, 0, -1]);
const pivot = model();
pivot.animateInterpolated(c, d, 0.5, false);
assert.deepEqual(vertices(pivot), animated(halfway));

// The plugin: off by default; RuneLite's exclusions.
const plugin = new AnimationSmoothingPlugin();
assert.equal(plugin.isEnabled(), false);
assert.equal(plugin.smoothsPlayer(808), false, "nothing while disabled");
plugin.setEnabledState(true);
assert.equal(plugin.smoothsPlayer(808), true);
assert.equal(plugin.smoothsPlayer(244), false, "excluded player pose");
assert.equal(plugin.smoothsNpc(3106, 6566, true), false, "hellhound defence");
assert.equal(plugin.smoothsNpc(8610, 808, false), false, "the wyrm's idle");
assert.equal(plugin.smoothsNpc(8610, 1234, true), true, "but not its actions");
assert.equal(plugin.smoothsNpc(3106, 808, false), true);

// Graphics: blend keyframes while enabled; keep one precise held pose for the last frame.
let skeletal = false;
let graphicsOn = true;
const gfxCache = new GfxCache({
    osrsClient: {
        spotAnimTypeLoader: { load: () => ({ sequenceId: 5 }) },
        seqTypeLoader: { load: () => ({ frameIds: [1, 2, 3], isSkeletalSeq: () => skeletal }) },
        clientPlugins: { smoothsGraphics: () => graphicsOn },
    },
} as any);
assert.equal(gfxCache.smoothingCycle(100, 0, 3), 3);
assert.equal(gfxCache.smoothingCycle(100, 2, 3), 1, "the last frame holds with fractional precision");
assert.equal(gfxCache.smoothingCycle(100, 2, 4), 1, "the last frame reuses its cached pose");
assert.equal(gfxCache.smoothingCycle(100, 0, 0), 0, "no cycle yet");
skeletal = true;
assert.equal(gfxCache.smoothingCycle(100, 0, 3), 0, "skeletal animations");
skeletal = false;
graphicsOn = false;
assert.equal(gfxCache.smoothingCycle(100, 0, 3), 0, "plugin off");

// A graphic's cycle into its frame, from its age (20 ms per cycle), counted 1..length as the
// game does: frames of 4, 5 and 3 cycles.
const cycleAt = (ageMs: number, frameIdx: number): number =>
    graphicFrameCycle([4, 9, 12], ageMs, frameIdx);
assert.equal(cycleAt(0, 0), 1, "first cycle of frame 0");
assert.equal(cycleAt(60, 0), 4, "last cycle of frame 0");
assert.equal(cycleAt(80, 1), 1, "first cycle of frame 1");
assert.equal(cycleAt(170, 1), 5, "last cycle of frame 1");
assert.equal(cycleAt(240, 0), 1, "looped back to frame 0");

// A one-unit movement must retain intermediate positions, through the CPU upload too.
const tinyA = frame([1, 0, 0, 0]);
const tinyB = frame([1, 1, 0, 0]);
assert.equal(blended(tinyA, tinyB, 0.25)[0], 100.25);
const buffer = new VertexBuffer(4, ACTOR_VERTEX_STRIDE);
for (const [x, y, z] of [[1.125, -7.375, 0.999], [-0.3, 0.4, -30.8]]) {
    const i = buffer.addVertex(x, y, z, 0, 255, 0, 0, -1);
    const offset = i * ACTOR_VERTEX_STRIDE;
    const fraction = buffer.view.getUint32(offset + 16, true);
    const decoded = [
        (buffer.view.getUint32(offset, true) >>> 17) - 16384 + (fraction & 1023) / 1024,
        16384 - (buffer.view.getUint32(offset + 4, true) & 32767) - ((fraction >>> 10) & 1023) / 1024,
        (buffer.view.getUint32(offset + 8, true) >>> 17) - 16384 + ((fraction >>> 20) & 1023) / 1024,
    ];
    decoded.forEach((v, axis) => assert.ok(Math.abs(v - [x,y,z][axis]) < 1 / 1024));
}
assert.notEqual(buffer.addVertex(0.25, 0, 0, 0, 255, 0, 0, -1),
    buffer.addVertex(0.75, 0, 0, 0, 255, 0, 0, -1), "vertex reuse preserves fractions");

// Reuse only byte-identical vertices, including normals, colours and fractional positions.
for (const stride of [12, 16, ACTOR_VERTEX_STRIDE]) {
    const raw = new VertexBuffer(8, stride);
    const deduplicated = new VertexBuffer(8, stride);
    const expected = new Map<string, number>();
    for (let i = 0; i < 1024; i++) {
        const n = i % 257;
        const args: [number, number, number, number, number, number, number, number] = [
            (n % 17) - 8 + (n % 4) / 4, (n % 13) - 6, (n % 11) - 5,
            (n * 255) & 0xffff, n & 255, (n % 7) / 7, (n % 5) / 5, n % 3 - 1,
        ];
        const actor = (n * 0x10204081) >>> 0;
        const rawIndex = raw.addVertex(...args, false, n % 12, false, actor);
        const bytes = raw.bytes.subarray(rawIndex * stride, (rawIndex + 1) * stride);
        const identity = Array.from(bytes).join(",");
        if (!expected.has(identity)) expected.set(identity, expected.size);
        const index = deduplicated.addVertex(...args, true, n % 12, false, actor);
        assert.equal(index, expected.get(identity), `packed vertex identity at stride ${stride}`);
        assert.deepEqual(deduplicated.bytes.subarray(index * stride, (index + 1) * stride), bytes);
    }
    assert.equal(deduplicated.offset, expected.size);
}

// The action and movement layers have independent clocks and respect the interleave mask.
const layered = model();
layered.animateInterleavedFramesInterpolated(tinyA, tinyB, 0.5, false,
    frame([0,0,0,0], [2,0,0,0]), frame([0,0,0,0], [2,0,1,0]), 0.25, false, [2,9999999]);
assert.deepEqual(vertices(layered), animated(frame([0,0,0,0], [1,0.5,0,0], [2,0,0.25,0])));

// Movement resets to zero; actions stop; objects follow their own valid repeat range.
const sequence: any = { frameIds: [1,2,3], frameStep: -1, looping: false, maxLoops: 2,
    isSkeletalSeq: () => false, getFrameLength: () => 10 };
assert.equal(nextSequenceFrame(sequence, 2, "movement"), 0);
assert.equal(nextSequenceFrame(sequence, 2, "action"), undefined);
assert.equal(nextSequenceFrame(sequence, 2, "object"), undefined);
sequence.frameStep = 2;
assert.equal(nextSequenceFrame(sequence, 2, "movement"), 1);
assert.equal(nextSequenceFrame(sequence, 2, "object"), 1);
assert.equal(nextSequenceFrame(sequence, 2, "action", 0), 1);
assert.equal(nextSequenceFrame(sequence, 2, "action", 1), undefined, "last permitted action loop");
sequence.looping = true;
assert.equal(nextSequenceFrame(sequence, 2, "movement", 1), 0, "movement loop limit resets");
const terminal = sequenceInterpolation(sequence, 2, 3, {} as any, "action", 1);
assert.equal(terminal?.next, undefined);
assert.equal(terminal?.alpha, 0);
assert.notEqual(interpolationKey({base: terminal}), interpolationKey(undefined), "held smoothed pose has its own cache entry");
assert.notEqual(interpolationKey({base: {next:1,alpha:0.2}, overlay: {next:2,alpha:0.3}}),
    interpolationKey({base: {next:1,alpha:0.2}, overlay: {next:2,alpha:0.4}}), "overlay clock is part of the cache key");

// Independently persisted categories and scenery density work without recreating the plugin.
const configManager = new ConfigManager(undefined);
const configured = new PluginInjector(configManager).runWith(() => new AnimationSmoothingPlugin());
configured.setEnabledState(true);
for (const property of ["players", "npcs", "graphics", "objects"]) {
    configManager.setConfigValue(AnimationSmoothingConfig, property, false);
}
assert.equal(configured.smoothsPlayer(808), false);
assert.equal(configured.smoothsNpc(3106, 808, false), false);
assert.equal(configured.smoothsGraphics(), false);
assert.equal(configured.smoothsObjects(), false);
configManager.setConfigValue(AnimationSmoothingConfig, "players", true);
assert.equal(configured.smoothsPlayer(808), true);
assert.equal(configured.smoothsPlayer(244), false, "category toggles preserve exclusions");
configManager.setConfigValue(AnimationSmoothingConfig, "sceneryQuality", 0);
assert.equal(configured.objectSettings().smoothLocAnimationSteps, 0);
configManager.setConfigValue(AnimationSmoothingConfig, "sceneryQuality", 123);
assert.equal(configured.objectSettings().smoothLocAnimationSteps, 4);

console.log("animation smoothing tests passed");
