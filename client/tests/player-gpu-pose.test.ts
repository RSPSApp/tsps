import assert from "node:assert/strict";

import { LabelPose, LabelRig, POSE_FLOATS_PER_LABEL } from "../render/player/LabelPose";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { COSINE, SINE } from "../rs/MathConstants";
import { Model } from "../rs/model/Model";
import { SeqTransformType } from "../rs/model/seq/SeqTransformType";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// GPU-animated players: one pose matrix per label, applied in the vertex shader, must put every
// vertex where the CPU path's Model.animate does. Exactly, against the same steps in floating
// point; within the CPU's own integer rounding (it truncates after every step) otherwise.
const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const factory = getCacheLoaderFactory(cacheInfo, CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files));
const textureLoader = factory.getTextureLoader();
const seqTypes = factory.getSeqTypeLoader();
const frames = factory.getSeqFrameLoader();

function wornModel(objId: number): Model {
    const obj = factory.getObjTypeLoader().load(objId);
    const data = factory.getModelLoader().getModel(obj.maleModel);
    assert.ok(data, `model for item ${objId}`);
    return data.light(textureLoader, 64, 850, -30, -50, -30);
}

/** Model.transform0's steps in floating point: the CPU path without its rounding. */
class FloatModel extends Model {
    x!: Float64Array;
    y!: Float64Array;
    z!: Float64Array;

    static of(base: Model): FloatModel {
        const m = new FloatModel();
        m.vertexLabels = base.vertexLabels;
        m.faceLabels = base.faceLabels;
        m.x = Float64Array.from(base.verticesX);
        m.y = Float64Array.from(base.verticesY);
        m.z = Float64Array.from(base.verticesZ);
        return m;
    }

    override postAnimate(): void {}

    override transform0(type: SeqTransformType, labels: number[], tx: number, ty: number, tz: number): void {
        const groups = this.vertexLabels;
        if (type === SeqTransformType.ORIGIN) {
            let n = 0, sx = 0, sy = 0, sz = 0;
            for (const l of labels) {
                if (l >= groups.length) continue;
                for (const v of groups[l]) {
                    sx += this.x[v]; sy += this.y[v]; sz += this.z[v]; n++;
                }
            }
            // The origin is a whole number in the game too.
            Model.animateOriginX = tx + (n ? Math.trunc(sx / n) : 0);
            Model.animateOriginY = ty + (n ? Math.trunc(sy / n) : 0);
            Model.animateOriginZ = tz + (n ? Math.trunc(sz / n) : 0);
            return;
        }
        for (const l of labels) {
            if (l >= groups.length) continue;
            for (const v of groups[l]) {
                if (type === SeqTransformType.TRANSLATE) {
                    this.x[v] += tx; this.y[v] += ty; this.z[v] += tz;
                    continue;
                }
                let x = this.x[v] - Model.animateOriginX;
                let y = this.y[v] - Model.animateOriginY;
                let z = this.z[v] - Model.animateOriginZ;
                if (type === SeqTransformType.ROTATE) {
                    const az = (tz & 255) * 8, ax = (tx & 255) * 8, ay = (ty & 255) * 8;
                    if (az) { const s = SINE[az] / 65536, c = COSINE[az] / 65536; const t = s * y + c * x; y = c * y - s * x; x = t; }
                    if (ax) { const s = SINE[ax] / 65536, c = COSINE[ax] / 65536; const t = c * y - s * z; z = s * y + c * z; y = t; }
                    if (ay) { const s = SINE[ay] / 65536, c = COSINE[ay] / 65536; const t = s * z + c * x; z = c * z - s * x; x = t; }
                } else if (type === SeqTransformType.SCALE) {
                    x = (tx * x) / 128; y = (ty * y) / 128; z = (tz * z) / 128;
                } else continue;
                this.x[v] = x + Model.animateOriginX;
                this.y[v] = y + Model.animateOriginY;
                this.z[v] = z + Model.animateOriginZ;
            }
        }
    }
}

let worstRounding = 0;

/** Largest distance between the float-posed vertices and the GPU pose applied to the rest pose. */
function maxError(base: Model, pose: (m: Model) => void): number {
    const rig = LabelRig.of(base);
    assert.ok(rig, "worn models carry vertex labels");
    const reference = FloatModel.of(base);
    pose(reference);
    const cpu = Model.copyAnimated(base, false, true);
    pose(cpu);
    const gpu = new LabelPose(rig);
    pose(gpu);
    assert.equal(gpu.needsCpu, false);
    const m = gpu.finish(0, 0);
    const label = rig.vertexLabelOf();
    let worst = 0;
    for (let v = 0; v < base.verticesCount; v++) {
        const l = label[v];
        const x = base.verticesX[v], y = base.verticesY[v], z = base.verticesZ[v];
        let px = x, py = y, pz = z;
        if (l >= 0) {
            const o = l * POSE_FLOATS_PER_LABEL;
            px = m[o] * x + m[o + 1] * y + m[o + 2] * z + m[o + 3];
            py = m[o + 4] * x + m[o + 5] * y + m[o + 6] * z + m[o + 7];
            pz = m[o + 8] * x + m[o + 9] * y + m[o + 10] * z + m[o + 11];
        }
        worst = Math.max(worst, Math.abs(px - reference.x[v]), Math.abs(py - reference.y[v]),
            Math.abs(pz - reference.z[v]));
        worstRounding = Math.max(worstRounding, Math.abs(px - cpu.verticesX[v]),
            Math.abs(py - cpu.verticesY[v]), Math.abs(pz - cpu.verticesZ[v]));
    }
    return worst;
}

const models = [wornModel(6570), wornModel(1127), wornModel(4151)]; // fire cape, rune platebody, whip
// Player idle, walk, run, punch, whip attack, a two-handed attack, a block.
const sequences = [808, 819, 824, 422, 1658, 7516, 424];
const TOLERANCE = 0.01;
let checked = 0;
let worstSeen = 0;
for (const base of models) {
    for (const seqId of sequences) {
        const seq = seqTypes.load(seqId);
        if (!seq?.frameIds?.length || seq.isSkeletalSeq?.()) continue;
        for (let i = 0; i < seq.frameIds.length; i++) {
            const frame = frames.load(seq.frameIds[i]);
            if (!frame) continue;
            const next = frames.load(seq.frameIds[(i + 1) % seq.frameIds.length]);
            const op14 = !!seq.op14;
            const error = Math.max(
                maxError(base, (m) => m.animate(frame, undefined, op14)),
                // Animation smoothing blends toward the next frame.
                next ? maxError(base, (m) => m.animateInterpolated(frame, next, 0.4, op14)) : 0,
            );
            assert.ok(error <= TOLERANCE, `seq ${seqId} frame ${i}: off by ${error}`);
            worstSeen = Math.max(worstSeen, error);
            checked++;
        }
    }
}
assert.ok(checked > 50, `checked ${checked} poses`);

// An action layered over movement: interleave masks pick each group from one or the other.
let interleaved = 0;
for (let id = 0; id < 3000 && interleaved < 3; id++) {
    const action = seqTypes.load(id);
    if (!action?.masks?.length || action.isSkeletalSeq?.() || !action.frameIds?.length) continue;
    const actionFrame = frames.load(action.frameIds[0]);
    const walkFrame = frames.load(seqTypes.load(819).frameIds[3]);
    if (!actionFrame || !walkFrame || actionFrame.base !== walkFrame.base) continue;
    const error = maxError(models[1], (m) =>
        m.animateInterleavedFrames(actionFrame, !!action.op14, walkFrame, false, action.masks));
    assert.ok(error <= TOLERANCE, `interleaved seq ${id}: off by ${error}`);
    interleaved++;
}
assert.ok(interleaved > 0, "found an interleaved player sequence");
// The integer CPU path drifts from exact by under a tenth of a tile at worst (weapon tips).
assert.ok(worstRounding < 16, `CPU rounding drift ${worstRounding}`);

console.log(
    `GPU player poses match the CPU path: ${checked} frames, ${interleaved} interleaved, ` +
        `exact to ${worstSeen.toFixed(4)}; the CPU's integer rounding drifts up to ${worstRounding.toFixed(1)}`,
);
