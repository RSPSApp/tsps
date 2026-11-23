import { Model } from "../../rs/model/Model";
import { Hasher } from "../../common/utils/Hasher";
import { DataBuffer } from "../../game/buffer/DataBuffer";

export function getModelHash(modelHashBuf: ModelHashBuffer, model: Model): number {
    const textureIds =
        (model.faceTextures && new Int32Array(model.faceTextures)) || new Int32Array(0);

    const datas = [
        model.faceColors1,
        model.faceColors2,
        model.faceColors3,
        model.verticesX,
        model.verticesY,
        model.verticesZ,
        textureIds,
    ];
    let dataLength = 0;
    for (const data of datas) {
        dataLength += data.length;
    }

    modelHashBuf.ensureSize(dataLength);

    let modelDataOffset = 0;
    for (const data of datas) {
        modelHashBuf.ints.set(data, modelDataOffset);
        modelDataOffset += data.length;
    }

    const hashData = modelHashBuf.bytes.subarray(0, modelDataOffset * 4);
    return Hasher.hash32(hashData);
}

/**
 * Hash of everything SceneBuffer.addModel and getModelFaces read from a model. getModelHash only
 * has to tell models apart inside one build; this one names a model across builds, so a packed
 * result can be reused for it, and also covers the face topology, alphas, priorities and UVs.
 */
export function getModelSignature(modelHashBuf: ModelHashBuffer, model: Model): number {
    const ints = [
        model.faceColors1,
        model.faceColors2,
        model.faceColors3,
        model.verticesX,
        model.verticesY,
        model.verticesZ,
        model.contourVerticesY,
        model.indices1,
        model.indices2,
        model.indices3,
        model.faceAlphas,
        model.faceRenderPriorities,
        model.faceRenderLayers,
        model.faceTextures,
    ];
    let length = model.uvs?.length ?? 0;
    for (const data of ints) length += data?.length ?? 0;
    modelHashBuf.ensureSize(length + ints.length);

    let offset = 0;
    for (const data of ints) {
        // Each array's length leads it, so equal bytes split differently don't collide.
        modelHashBuf.ints[offset++] = data ? data.length : -1;
        if (data) {
            modelHashBuf.ints.set(data, offset);
            offset += data.length;
        }
    }
    if (model.uvs) {
        new Float32Array(modelHashBuf.bytes.buffer, offset * 4, model.uvs.length).set(model.uvs);
        offset += model.uvs.length;
    }
    return Hasher.hash32(modelHashBuf.bytes.subarray(0, offset * 4));
}

export class ModelHashBuffer extends DataBuffer {
    ints: Int32Array;

    constructor(count: number) {
        super(4, count);
        this.ints = new Int32Array(this.bytes.buffer);
    }

    override ensureSize(count: number): boolean {
        const resized = super.ensureSize(count);
        if (resized) {
            this.ints = new Int32Array(this.bytes.buffer);
        }
        return resized;
    }
}
