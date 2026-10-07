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
    m.animate(f, undefined, false);
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

// A quarter of the way: values are truncated toward zero, as in RuneLite.
assert.deepEqual(
    blended(a, b, 0.25),
    animated(frame([0, 0, 0, 0], [1, 12, 0, 0], [2, 0, 253, 0], [3, 144, 128, 128])),
);

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

// Graphics: a graphic's frame blends while the plugin is on, for keyframe animations, except
// on the last frame.
let skeletal = false;
let graphicsOn = true;
const gfxCache = new GfxCache({
    osrsClient: {
        spotAnimTypeLoader: { load: () => ({ sequenceId: 5 }) },
        seqTypeLoader: { load: () => ({ frameIds: [1, 2, 3], isSkeletalSeq: () => skeletal }) },
        animationSmoothingPlugin: { smoothsGraphics: () => graphicsOn },
    },
} as any);
assert.equal(gfxCache.smoothingCycle(100, 0, 3), 3);
assert.equal(gfxCache.smoothingCycle(100, 2, 3), 0, "the last frame");
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

console.log("animation smoothing tests passed");
