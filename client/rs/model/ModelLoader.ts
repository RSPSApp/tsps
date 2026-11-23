import { Archive } from "../cache/Archive";
import { CustomModelRegistry } from "../../custom/items/CustomModelRegistry";
import { CustomAnimationRegistry } from "../../custom/animations/CustomAnimationRegistry";
import { CacheIndex } from "../cache/CacheIndex";
import { isGroupMissingError } from "../cache/js5/GroupMissingError";
import { ByteBuffer } from "../io/ByteBuffer";
import { ModelData } from "./ModelData";

export interface ModelLoader {
    getModel(id: number): ModelData | undefined;
    /** Optional content generation for loaders whose models can be replaced at runtime. */
    revision?: number;
    /**
     * Total not-yet-downloaded misses observed (sparse cache). Callers that
     * merge and cache multi-part models compare this across their part loads:
     * if it changed, a part is still streaming in — don't cache the partial
     * result, return undefined and retry later.
     */
    missCount?: number;
}

export class IndexModelLoader implements ModelLoader {
    modelIndex: CacheIndex;

    missCount = 0;

    constructor(modelIndex: CacheIndex) {
        this.modelIndex = modelIndex;
    }

    getModel(id: number): ModelData | undefined {
        try {
            const custom = CustomModelRegistry.get(id) ?? CustomAnimationRegistry.model(id);
            if (custom) return ModelData.decode(custom);
            const file = this.modelIndex.getFile(id, 0);
            return file && ModelData.decode(file.data);
        } catch (e) {
            // Missing groups are already queued for on-demand fetch; the
            // caller renders nothing this frame and retries later.
            if (!isGroupMissingError(e)) {
                console.error("Failed loading model file", id, e);
            } else {
                this.missCount++;
            }
            return undefined;
        }
    }
}

export class LegacyModelMetadata {
    vertexCount: number = 0;
    triangleCount: number = 0;
    texturedTriangleCount: number = 0;
    vertexFlagsOffset: number = 0;
    vertexXOffset: number = 0;
    vertexYOffset: number = 0;
    vertexZOffset: number = 0;
    faceVerticesOffset: number = 0;
    faceOrientationsOffset: number = 0;
    faceColorsOffset: number = 0;
    faceInfosOffset: number = 0;
    facePrioritiesOffset: number = 0;
    faceAlphasOffset: number = 0;
    faceLabelsOffset: number = 0;
    vertexLabelsOffset: number = 0;
    faceTextureAxisOffset: number = 0;
}

export class LegacyModelLoader implements ModelLoader {
    head: ByteBuffer;
    face1: ByteBuffer;
    face2: ByteBuffer;
    face3: ByteBuffer;
    face4: ByteBuffer;
    face5: ByteBuffer;
    point1: ByteBuffer;
    point2: ByteBuffer;
    point3: ByteBuffer;
    point4: ByteBuffer;
    point5: ByteBuffer;
    vertex1: ByteBuffer;
    vertex2: ByteBuffer;
    axis: ByteBuffer;

    count: number;

    metadatas: LegacyModelMetadata[];

    static load(modelArchive: Archive): LegacyModelLoader {
        return new LegacyModelLoader(modelArchive);
    }

    private constructor(modelArchive: Archive) {
        this.head = modelArchive.getFileNamed("ob_head.dat")!.getDataAsBuffer();
        this.face1 = modelArchive.getFileNamed("ob_face1.dat")!.getDataAsBuffer();
        this.face2 = modelArchive.getFileNamed("ob_face2.dat")!.getDataAsBuffer();
        this.face3 = modelArchive.getFileNamed("ob_face3.dat")!.getDataAsBuffer();
        this.face4 = modelArchive.getFileNamed("ob_face4.dat")!.getDataAsBuffer();
        this.face5 = modelArchive.getFileNamed("ob_face5.dat")!.getDataAsBuffer();
        this.point1 = modelArchive.getFileNamed("ob_point1.dat")!.getDataAsBuffer();
        this.point2 = modelArchive.getFileNamed("ob_point2.dat")!.getDataAsBuffer();
        this.point3 = modelArchive.getFileNamed("ob_point3.dat")!.getDataAsBuffer();
        this.point4 = modelArchive.getFileNamed("ob_point4.dat")!.getDataAsBuffer();
        this.point5 = modelArchive.getFileNamed("ob_point5.dat")!.getDataAsBuffer();
        this.vertex1 = modelArchive.getFileNamed("ob_vertex1.dat")!.getDataAsBuffer();
        this.vertex2 = modelArchive.getFileNamed("ob_vertex2.dat")!.getDataAsBuffer();
        this.axis = modelArchive.getFileNamed("ob_axis.dat")!.getDataAsBuffer();

        const count = (this.count = this.head.readUnsignedShort());

        this.metadatas = new Array(count + 100);

        let vertexTextureDataOffset = 0;
        let labelDataOffset = 0;
        let triangleColorDataOffset = 0;
        let triangleInfoDataOffset = 0;
        let trianglePriorityDataOffset = 0;
        let triangleAlphaDataOffset = 0;
        let triangleSkinDataOffset = 0;

        for (let i = 0; i < count; i++) {
            const index = this.head.readUnsignedShort();
            const meta = (this.metadatas[index] = new LegacyModelMetadata());
            meta.vertexCount = this.head.readUnsignedShort();
            meta.triangleCount = this.head.readUnsignedShort();
            meta.texturedTriangleCount = this.head.readUnsignedByte();
            meta.vertexFlagsOffset = this.point1.offset;
            meta.vertexXOffset = this.point2.offset;
            meta.vertexYOffset = this.point3.offset;
            meta.vertexZOffset = this.point4.offset;
            meta.faceVerticesOffset = this.vertex1.offset;
            meta.faceOrientationsOffset = this.vertex2.offset;
            const hasInfo = this.head.readUnsignedByte();
            const hasPriorities = this.head.readUnsignedByte();
            const hasAlpha = this.head.readUnsignedByte();
            const hasSkins = this.head.readUnsignedByte();
            const hasLabels = this.head.readUnsignedByte();
            for (let v = 0; v < meta.vertexCount; v++) {
                const flags = this.point1.readUnsignedByte();
                if ((flags & 0x1) !== 0) {
                    this.point2.readSmart2();
                }
                if ((flags & 0x2) !== 0) {
                    this.point3.readSmart2();
                }
                if ((flags & 0x4) !== 0) {
                    this.point4.readSmart2();
                }
            }

            for (let t = 0; t < meta.triangleCount; t++) {
                const type = this.vertex2.readUnsignedByte();
                if (type === 1) {
                    this.vertex1.readSmart2();
                    this.vertex1.readSmart2();
                }
                this.vertex1.readSmart2();
            }

            meta.faceColorsOffset = triangleColorDataOffset;
            triangleColorDataOffset += meta.triangleCount * 2;
            if (hasInfo === 1) {
                meta.faceInfosOffset = triangleInfoDataOffset;
                triangleInfoDataOffset += meta.triangleCount;
            } else {
                meta.faceInfosOffset = -1;
            }
            if (hasPriorities === 255) {
                meta.facePrioritiesOffset = trianglePriorityDataOffset;
                trianglePriorityDataOffset += meta.triangleCount;
            } else {
                meta.facePrioritiesOffset = -hasPriorities - 1;
            }
            if (hasAlpha === 1) {
                meta.faceAlphasOffset = triangleAlphaDataOffset;
                triangleAlphaDataOffset += meta.triangleCount;
            } else {
                meta.faceAlphasOffset = -1;
            }
            if (hasSkins === 1) {
                meta.faceLabelsOffset = triangleSkinDataOffset;
                triangleSkinDataOffset += meta.triangleCount;
            } else {
                meta.faceLabelsOffset = -1;
            }
            if (hasLabels === 1) {
                meta.vertexLabelsOffset = labelDataOffset;
                labelDataOffset += meta.vertexCount;
            } else {
                meta.vertexLabelsOffset = -1;
            }
            meta.faceTextureAxisOffset = vertexTextureDataOffset;
            vertexTextureDataOffset += meta.texturedTriangleCount;
        }
    }

    getModel(id: number): ModelData | undefined {
        const meta = this.metadatas[id];
        if (!meta) {
            return undefined;
        }
        return ModelData.decodeLegacy(this, meta);
    }
}
