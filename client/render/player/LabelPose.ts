import { COSINE, SINE } from "../../rs/MathConstants";
import { Model } from "../../rs/model/Model";
import { SeqTransformType } from "../../rs/model/seq/SeqTransformType";

/** Floats per label in a pose: three rows of a 3x4 affine matrix. */
export const POSE_FLOATS_PER_LABEL = 12;

/** The rest-pose data of a model's vertex groups (labels) that a pose is built from. */
export class LabelRig {
    readonly labelCount: number;
    /** Rest-pose position sums per label (x, y, z). */
    readonly sums: Float64Array;
    readonly counts: Int32Array;
    /** Labels whose faces alpha/colour transforms change: those poses need the CPU path. */
    readonly faceLabelled: Uint8Array;

    private constructor(readonly model: Model) {
        const labels = model.vertexLabels;
        this.labelCount = labels.length;
        this.sums = new Float64Array(this.labelCount * 3);
        this.counts = new Int32Array(this.labelCount);
        for (let label = 0; label < this.labelCount; label++) {
            const vertices = labels[label];
            this.counts[label] = vertices.length;
            for (const v of vertices) {
                this.sums[label * 3] += model.verticesX[v];
                this.sums[label * 3 + 1] += model.verticesY[v];
                this.sums[label * 3 + 2] += model.verticesZ[v];
            }
        }
        const faceLabels = model.faceLabels;
        this.faceLabelled = new Uint8Array(faceLabels?.length ?? 0);
        for (let label = 0; label < this.faceLabelled.length; label++) {
            this.faceLabelled[label] = faceLabels[label]?.length > 0 ? 1 : 0;
        }
    }

    /** A rig for a model with vertex labels, or none (an unanimatable model). */
    static of(model: Model): LabelRig | undefined {
        return model.vertexLabels?.length > 0 && model.vertexLabels.length <= 255
            ? new LabelRig(model)
            : undefined;
    }

    /** Each vertex's label, or -1 for a vertex in none. */
    vertexLabelOf(): Int32Array {
        const out = new Int32Array(this.model.verticesCount).fill(-1);
        const labels = this.model.vertexLabels;
        for (let label = 0; label < labels.length; label++) {
            for (const v of labels[label]) out[v] = label;
        }
        return out;
    }
}

/**
 * Runs keyframe animations as the CPU path does (Model.animate, smoothing, interleaving), but
 * composes one affine matrix per label instead of moving vertices. Every vertex belongs to one
 * label and translate/rotate/scale move whole labels, so the matrices reproduce the posed model;
 * an origin is the mean of its labels' posed vertices, found from rest sums. Faces changed by
 * alpha or colour transforms can't be posed this way, and mark the pose for the CPU path.
 */
export class LabelPose extends Model {
    /** Row-major 3x4 matrix per label: [a00 a01 a02 tx, a10 a11 a12 ty, a20 a21 a22 tz]. */
    readonly matrices: Float32Array;
    needsCpu = false;
    private readonly m: Float64Array;

    constructor(private readonly rig: LabelRig) {
        super();
        this.vertexLabels = rig.model.vertexLabels;
        this.faceLabels = rig.model.faceLabels;
        this.m = new Float64Array(rig.labelCount * POSE_FLOATS_PER_LABEL);
        this.matrices = new Float32Array(rig.labelCount * POSE_FLOATS_PER_LABEL);
        for (let label = 0; label < rig.labelCount; label++) {
            const o = label * POSE_FLOATS_PER_LABEL;
            this.m[o] = this.m[o + 5] = this.m[o + 10] = 1;
        }
    }

    override postAnimate(): void {}

    /** Finishes the pose: the CPU path's fixed re-centring, then the float matrices. */
    finish(dx: number, dz: number): Float32Array {
        for (let label = 0; label < this.rig.labelCount; label++) {
            const o = label * POSE_FLOATS_PER_LABEL;
            this.m[o + 3] += dx;
            this.m[o + 11] += dz;
        }
        this.matrices.set(this.m);
        return this.matrices;
    }

    override transform0(
        type: SeqTransformType,
        labels: number[],
        tx: number,
        ty: number,
        tz: number,
    ): void {
        const count = this.rig.labelCount;
        const m = this.m;
        switch (type) {
            case SeqTransformType.ORIGIN: {
                Model.resetAnimateOrigin();
                let sx = 0;
                let sy = 0;
                let sz = 0;
                let n = 0;
                for (const label of labels) {
                    if (label >= count) continue;
                    const c = this.rig.counts[label];
                    if (c === 0) continue;
                    const o = label * POSE_FLOATS_PER_LABEL;
                    const s = this.rig.sums;
                    const rx = s[label * 3], ry = s[label * 3 + 1], rz = s[label * 3 + 2];
                    sx += m[o] * rx + m[o + 1] * ry + m[o + 2] * rz + c * m[o + 3];
                    sy += m[o + 4] * rx + m[o + 5] * ry + m[o + 6] * rz + c * m[o + 7];
                    sz += m[o + 8] * rx + m[o + 9] * ry + m[o + 10] * rz + c * m[o + 11];
                    n += c;
                }
                Model.animateOriginX = tx + (n > 0 ? Math.trunc(sx / n) : 0);
                Model.animateOriginY = ty + (n > 0 ? Math.trunc(sy / n) : 0);
                Model.animateOriginZ = tz + (n > 0 ? Math.trunc(sz / n) : 0);
                break;
            }
            case SeqTransformType.TRANSLATE:
                for (const label of labels) {
                    if (label >= count) continue;
                    const o = label * POSE_FLOATS_PER_LABEL;
                    m[o + 3] += tx;
                    m[o + 7] += ty;
                    m[o + 11] += tz;
                }
                break;
            case SeqTransformType.ROTATE: {
                // Roll (z), then pitch (x), then yaw (y), as Model.transform0 applies them.
                const az = (tz & 0xff) * 8, ax = (tx & 0xff) * 8, ay = (ty & 0xff) * 8;
                const sz = SINE[az] / 65536, cz = COSINE[az] / 65536;
                const sx = SINE[ax] / 65536, cx = COSINE[ax] / 65536;
                const sy = SINE[ay] / 65536, cy = COSINE[ay] / 65536;
                // R = Ry * Rx * Rz for column vectors.
                const r00 = cy * cz - sy * sx * sz, r01 = cy * sz + sy * sx * cz, r02 = sy * cx;
                const r10 = -cx * sz, r11 = cx * cz, r12 = -sx;
                const r20 = -sy * cz - cy * sx * sz, r21 = -sy * sz + cy * sx * cz, r22 = cy * cx;
                this.applyAboutOrigin(labels, r00, r01, r02, r10, r11, r12, r20, r21, r22);
                break;
            }
            case SeqTransformType.SCALE:
                this.applyAboutOrigin(labels, tx / 128, 0, 0, 0, ty / 128, 0, 0, 0, tz / 128);
                break;
            case SeqTransformType.ALPHA:
                if (this.rig.model.faceAlphas && this.touchesFaces(labels)) this.needsCpu = true;
                break;
            case SeqTransformType.LIGHT:
                if (this.touchesFaces(labels)) this.needsCpu = true;
                break;
        }
    }

    private touchesFaces(labels: number[]): boolean {
        for (const label of labels) {
            if (this.rig.faceLabelled[label] === 1) return true;
        }
        return false;
    }

    /** M = T(origin) * L * T(-origin) * M for each label, with L the given linear map. */
    private applyAboutOrigin(
        labels: number[],
        l00: number, l01: number, l02: number,
        l10: number, l11: number, l12: number,
        l20: number, l21: number, l22: number,
    ): void {
        const count = this.rig.labelCount;
        const m = this.m;
        const ox = Model.animateOriginX, oy = Model.animateOriginY, oz = Model.animateOriginZ;
        for (const label of labels) {
            if (label >= count) continue;
            const o = label * POSE_FLOATS_PER_LABEL;
            for (let col = 0; col < 4; col++) {
                // Translation column: rotate about the origin.
                const x = m[o + col] - (col === 3 ? ox : 0);
                const y = m[o + 4 + col] - (col === 3 ? oy : 0);
                const z = m[o + 8 + col] - (col === 3 ? oz : 0);
                m[o + col] = l00 * x + l01 * y + l02 * z + (col === 3 ? ox : 0);
                m[o + 4 + col] = l10 * x + l11 * y + l12 * z + (col === 3 ? oy : 0);
                m[o + 8 + col] = l20 * x + l21 * y + l22 * z + (col === 3 ? oz : 0);
            }
        }
    }
}
