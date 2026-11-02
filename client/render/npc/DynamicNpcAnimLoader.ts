import { interpolationKey, type ActorInterpolation } from "../../rs/model/seq/FrameInterpolation";
/**
 * DynamicNpcAnimLoader - Builds dynamic NPC sequence metadata and current-frame geometry on demand.
 *
 * OSRS applies NPC sequences at render time. We mirror that by resolving the
 * current posed model when needed rather than baking whole sequences into a
 * persistent GPU buffer.
 */
import { NpcModelLoader } from "../../rs/config/npctype/NpcModelLoader";
import { NpcType } from "../../rs/config/npctype/NpcType";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { SeqType } from "../../rs/config/seqtype/SeqType";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { VarManager } from "../../rs/config/vartype/VarManager";
import { Model } from "../../rs/model/Model";
import { ModelLoader } from "../../rs/model/ModelLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import { SceneBuffer } from "../buffer/SceneBuffer";
import { buildActorNormals } from "../buffer/ActorNormals";
import { packedActorBounds, type ActorBounds } from "../ActorVisibility";
import { CustomModelRegistry } from "../../custom/items/CustomModelRegistry";

export interface DynamicNpcSequenceMeta {
    key: string;
    npcTypeId: number;
    seqId: number;
    frameLengths: number[];
    frameCount: number;
    skeletal: boolean;
}

export interface DynamicNpcFrameGeometry {
    key: string;
    npcTypeId: number;
    seqId: number;
    frameId: number;
    overlaySeqId?: number;
    overlayFrameId?: number;
    opaqueVertices: Uint8Array;
    opaqueIndices: Int32Array;
    alphaVertices: Uint8Array;
    alphaIndices: Int32Array;
    approxBytes: number;
    bounds?: ActorBounds;
}

export type NpcFrameRequest = Parameters<DynamicNpcAnimLoader["getFrameGeometry"]>;

export function npcAppearanceKey(type: NpcType): string {
    return JSON.stringify([type.modelIds, type.recolorFrom, type.recolorTo,
        type.retextureFrom, type.retextureTo, type.ambient, type.contrast,
        type.widthScale, type.heightScale]);
}

const CACHE_CONFIG = {
    /** Cap dynamic current-frame geometry cache to a bounded CPU budget. */
    MAX_GEOMETRY_BYTES: 16 * 1024 * 1024,
} as const;

export class DynamicNpcAnimLoader {
    revision = 0;
    private npcModelLoader: NpcModelLoader | undefined;
    private textureIdIndexMap: Map<number, number> | undefined;
    private seqMetaCache = new Map<string, DynamicNpcSequenceMeta>();
    private geomCache = new Map<string, DynamicNpcFrameGeometry>();
    private geomCacheBytes = 0;
    private geometryTypes = new Map<string, number>();
    private nextGeometryTypeId = 0;
    private geometryTypeCache = new WeakMap<NpcType, number>();
    private readonly modelAppearances = new Map<number, string>();
    private contentContext?: string;
    private contextKey?: string;
    private readonly contextInputs = { textures: -1, customModels: -1, models: -1, revision: -1 };
    private opaqueSceneBuf: SceneBuffer | undefined;
    private alphaSceneBuf: SceneBuffer | undefined;

    constructor(
        private npcTypeLoader: NpcTypeLoader | undefined,
        private modelLoader: ModelLoader | undefined,
        private textureLoader: TextureLoader | undefined,
        private seqTypeLoader: SeqTypeLoader | undefined,
        private seqFrameLoader: SeqFrameLoader | undefined,
        private skeletalSeqLoader: SkeletalSeqLoader | undefined,
        private varManager: VarManager | undefined,
        existingModelLoader?: NpcModelLoader,
    ) {
        this.npcModelLoader = existingModelLoader;
        this.initLoader();
    }

    private initLoader(): void {
        if (this.npcModelLoader) return;
        if (
            this.npcTypeLoader &&
            this.modelLoader &&
            this.textureLoader &&
            this.seqTypeLoader &&
            this.seqFrameLoader &&
            this.varManager
        ) {
            this.npcModelLoader = new NpcModelLoader(
                this.npcTypeLoader,
                this.modelLoader,
                this.textureLoader,
                this.seqTypeLoader,
                this.seqFrameLoader,
                this.skeletalSeqLoader,
                this.varManager,
            );
        }
    }

    setTextureIdIndexMap(map: Map<number, number>): void {
        this.clear();
        this.textureIdIndexMap = map;
    }

    getTextureIdIndexMap(): Map<number, number> | undefined { return this.textureIdIndexMap; }

    getContextKey(): string {
        // Read for every actor every frame: the strings are rebuilt only when an input changes.
        const textures = this.textureIdIndexMap?.size ?? 0;
        const customModels = CustomModelRegistry.revision;
        const models = (this.modelLoader ?? this.npcModelLoader?.modelLoader)?.revision ?? 0;
        const inputs = this.contextInputs;
        if (
            this.contextKey !== undefined &&
            inputs.textures === textures &&
            inputs.customModels === customModels &&
            inputs.models === models &&
            inputs.revision === this.revision
        ) {
            return this.contextKey;
        }
        const content = `${textures}:${customModels}:${models}`;
        if (this.contentContext !== undefined && this.contentContext !== content) this.clear();
        this.contentContext = content;
        inputs.textures = textures;
        inputs.customModels = customModels;
        inputs.models = models;
        inputs.revision = this.revision;
        this.contextKey = `${this.revision}:${content}`;
        return this.contextKey;
    }

    getCachedGeometry(key: string): DynamicNpcFrameGeometry | undefined {
        const geometry = this.geomCache.get(key);
        if (geometry) this.promoteGeometryEntry(key, geometry);
        return geometry;
    }

    adoptGeometry(geometry: DynamicNpcFrameGeometry): void {
        this.geomCacheBytes -= this.geomCache.get(geometry.key)?.approxBytes ?? 0;
        this.geomCache.set(geometry.key, geometry);
        this.geomCacheBytes += geometry.approxBytes;
        this.evictGeometryEntriesIfNeeded();
    }

    /** Transfer ownership out of a worker cache without leaving detached buffers cached. */
    takeGeometry(key: string): DynamicNpcFrameGeometry | undefined {
        const geometry = this.geomCache.get(key);
        if (geometry) { this.geomCache.delete(key); this.geomCacheBytes -= geometry.approxBytes; }
        return geometry;
    }

    getAsyncPoseRequest(...request: NpcFrameRequest) {
        this.getContextKey();
        if (!this.isReady()) return undefined;
        const resolved = this.resolveFrameRequest(...request);
        const type = resolved?.resolvedNpcType ?? this.getResolvedNpcType(request[0]);
        if (!type) return undefined;
        const sequence = resolved ? this.seqTypeLoader?.load(request[1]) : undefined;
        return { key: resolved?.key ?? `${this.getGeometryTypeId(type)}:base`, appearance: npcAppearanceKey(type),
            frameCount: sequence ? this.getFrameCount(sequence) : 0,
            request: (resolved ? [type.id, request[1], resolved.normalizedFrame, request[3] ?? -1,
                resolved.normalizedOverlayFrame, resolved.interpolation] : [type.id, -1, 0]) as NpcFrameRequest };
    }

    isReady(): boolean {
        return !!(this.npcModelLoader && this.textureLoader && this.textureIdIndexMap);
    }

    getSequenceMeta(npcTypeId: number, seqId: number): DynamicNpcSequenceMeta | undefined {
        this.getContextKey();
        if (seqId < 0 || !this.isReady()) {
            return undefined;
        }

        const npcType = this.getResolvedNpcType(npcTypeId);
        if (!npcType) {
            return undefined;
        }

        const key = `${npcType.id}:${seqId}`;
        const cached = this.seqMetaCache.get(key);
        if (cached) {
            return cached;
        }

        const seqType = this.seqTypeLoader?.load(seqId);
        if (!seqType) {
            return undefined;
        }

        const frameCount = this.getFrameCount(seqType);
        if (frameCount <= 0) {
            return undefined;
        }

        // Validate that this NPC model can actually be resolved for the sequence
        // before the renderer commits to the dynamic path.
        const validationModel = this.npcModelLoader?.getModel(npcType, seqId, 0);
        if (!validationModel) {
            return undefined;
        }

        const meta: DynamicNpcSequenceMeta = {
            key,
            npcTypeId: npcType.id | 0,
            seqId: seqId | 0,
            frameLengths: this.getFrameLengths(seqType, frameCount),
            frameCount,
            skeletal: seqType.isSkeletalSeq(),
        };
        this.seqMetaCache.set(key, meta);
        return meta;
    }

    getFrameGeometry(
        npcTypeId: number,
        seqId: number,
        frameId: number,
        overlaySeqId: number = -1,
        overlayFrameId: number = -1,
        interpolation?: ActorInterpolation,
    ): DynamicNpcFrameGeometry | undefined {
        const request = this.resolveFrameRequest(npcTypeId, seqId, frameId, overlaySeqId, overlayFrameId, interpolation);
        if (!request) return undefined;
        const { resolvedNpcType, normalizedFrame, normalizedOverlayFrame, key } = request;
        interpolation = request.interpolation;
        const cached = this.geomCache.get(key);
        if (cached) {
            this.promoteGeometryEntry(key, cached);
            return cached.npcTypeId === resolvedNpcType.id
                ? cached : { ...cached, npcTypeId: resolvedNpcType.id };
        }

        if (
            !this.isSequenceFrameReady(seqId, normalizedFrame) ||
            (overlaySeqId >= 0 &&
                !this.isSequenceFrameReady(overlaySeqId, normalizedOverlayFrame))
        ) {
            return undefined;
        }

        const model = this.npcModelLoader?.getModel(
            resolvedNpcType,
            seqId,
            normalizedFrame,
            overlaySeqId | 0,
            normalizedOverlayFrame | 0,
            interpolation,
        );
        if (!model) {
            return undefined;
        }

        return this.cacheModelGeometry(
            key,
            resolvedNpcType.id | 0,
            seqId | 0,
            normalizedFrame | 0,
            model,
            overlaySeqId >= 0 ? overlaySeqId | 0 : undefined,
            overlaySeqId >= 0 ? normalizedOverlayFrame | 0 : undefined,
        );
    }

    /** The same normalized pose identity used by the CPU cache, without building its mesh. */
    getFrameGeometryKey(...request: Parameters<DynamicNpcAnimLoader["getFrameGeometry"]>): string | undefined {
        return this.resolveFrameRequest(...request)?.key;
    }

    /** Shared rest model/sequence implementation for label poses; the model remains immutable. */
    getModelLoader(): NpcModelLoader | undefined { return this.npcModelLoader; }

    peekBaseModel(npcTypeId: number): Model | undefined {
        this.getContextKey();
        const type = this.getResolvedNpcType(npcTypeId);
        if (type) this.getGeometryTypeId(type);
        return type ? this.npcModelLoader?.modelCache.get(type.id) : undefined;
    }

    getGpuPoseSource(...request: NpcFrameRequest) {
        const resolved = this.resolveFrameRequest(...request);
        if (!resolved || !this.isSequenceFrameReady(request[1], resolved.normalizedFrame) ||
            ((request[3] ?? -1) >= 0 && !this.isSequenceFrameReady(request[3]!, resolved.normalizedOverlayFrame))) return undefined;
        const npcType = resolved.resolvedNpcType;
        const models = this.npcModelLoader?.modelCache;
        if (!models?.has(npcType.id) && !this.npcModelLoader?.getModel(npcType, -1, -1)) return undefined;
        const baseModel = models?.get(npcType.id);
        if (!baseModel) return undefined;
        return { key: `${this.getContextKey()}:${resolved.key}`, baseKey: `${this.getContextKey()}:${this.getGeometryTypeId(npcType)}:base`, npcType, baseModel,
            interpolation: resolved.interpolation, frameId: resolved.normalizedFrame,
            overlayFrameId: resolved.normalizedOverlayFrame };
    }

    private resolveFrameRequest(
        npcTypeId: number,
        seqId: number,
        frameId: number,
        overlaySeqId = -1,
        overlayFrameId = -1,
        interpolation?: ActorInterpolation,
    ) {
        this.getContextKey();
        if (!this.isReady() || seqId < 0) {
            return undefined;
        }

        const sequence = this.seqTypeLoader?.load(seqId);
        const frameCount = sequence ? this.getFrameCount(sequence) : 0;
        if (frameCount <= 0) {
            return undefined;
        }

        const resolvedNpcType = this.getResolvedNpcType(npcTypeId);
        if (!resolvedNpcType) {
            return undefined;
        }

        const normalizedFrame =
            Math.max(0, frameId | 0) % frameCount;
        const normalizedOverlayFrame = Math.max(0, overlayFrameId | 0);
        const overlayKey =
            overlaySeqId >= 0 ? `:${overlaySeqId | 0}:${normalizedOverlayFrame | 0}` : "";
        if (interpolation) {
            const ready = (id: number, blend: ActorInterpolation["base"]) =>
                blend?.next !== undefined && !this.isSequenceFrameReady(id, blend.next)
                    ? { next: undefined, alpha: 0 } : blend;
            interpolation = { base: ready(seqId, interpolation.base), overlay: ready(overlaySeqId, interpolation.overlay) };
        }
        const key = `${this.getGeometryTypeId(resolvedNpcType)}:${seqId}:${normalizedFrame}${interpolationKey(interpolation)}${overlayKey}`;
        return { resolvedNpcType, normalizedFrame, normalizedOverlayFrame, interpolation, key };
    }

    private isSequenceFrameReady(seqId: number, frameId: number): boolean {
        const seqType = this.seqTypeLoader?.load(seqId | 0);
        if (!seqType) return false;
        if (seqType.isSkeletalSeq()) {
            return !!this.skeletalSeqLoader?.load(seqType.skeletalId);
        }
        const ids = seqType.frameIds;
        if (!ids?.length) return false;
        return !!this.seqFrameLoader?.load(ids[Math.max(0, frameId | 0) % ids.length] | 0);
    }

    getBaseGeometry(npcTypeId: number): DynamicNpcFrameGeometry | undefined {
        this.getContextKey();
        if (!this.isReady()) return undefined;

        const resolvedNpcType = this.getResolvedNpcType(npcTypeId);
        if (!resolvedNpcType) return undefined;

        const key = `${this.getGeometryTypeId(resolvedNpcType)}:base`;
        const cached = this.geomCache.get(key);
        if (cached) {
            this.promoteGeometryEntry(key, cached);
            return cached.npcTypeId === resolvedNpcType.id
                ? cached : { ...cached, npcTypeId: resolvedNpcType.id };
        }

        const model = this.npcModelLoader?.getModel(resolvedNpcType, -1, -1);
        if (!model) return undefined;

        return this.cacheModelGeometry(key, resolvedNpcType.id | 0, -1, 0, model);
    }

    private cacheModelGeometry(
        key: string,
        npcTypeId: number,
        seqId: number,
        frameId: number,
        model: Model,
        overlaySeqId?: number,
        overlayFrameId?: number,
    ): DynamicNpcFrameGeometry {
        const actorNormals = buildActorNormals(model, this.npcModelLoader?.modelCache.get(npcTypeId) ?? model);
        const opaque = this.buildGeometry(model, false, actorNormals);
        const alpha = this.buildGeometry(model, true, actorNormals);
        const entry: DynamicNpcFrameGeometry = {
            key,
            npcTypeId,
            seqId,
            frameId,
            overlaySeqId,
            overlayFrameId,
            opaqueVertices: opaque.vertices,
            opaqueIndices: opaque.indices,
            alphaVertices: alpha.vertices,
            alphaIndices: alpha.indices,
            bounds: packedActorBounds(opaque.vertices, alpha.vertices),
            approxBytes:
                opaque.vertices.byteLength +
                opaque.indices.byteLength +
                alpha.vertices.byteLength +
                alpha.indices.byteLength,
        };

        this.geomCache.set(key, entry);
        this.geomCacheBytes += entry.approxBytes;
        this.evictGeometryEntriesIfNeeded();
        return entry;
    }

    clear(): void {
        this.revision++;
        this.npcModelLoader?.modelCache.clear();
        this.modelAppearances.clear();
        this.seqMetaCache.clear();
        this.geomCache.clear();
        this.geomCacheBytes = 0;
        this.geometryTypes.clear();
        this.geometryTypeCache = new WeakMap();
        this.opaqueSceneBuf = undefined;
        this.alphaSceneBuf = undefined;
    }

    getStats(): {
        sequenceMetaEntries: number;
        geometryEntries: number;
        geometryBytes: number;
        topEntries: Array<{ key: string; approxBytes: number }>;
    } {
        return {
            sequenceMetaEntries: this.seqMetaCache.size,
            geometryEntries: this.geomCache.size,
            geometryBytes: this.geomCacheBytes,
            topEntries: Array.from(this.geomCache.values())
                .sort((a, b) => b.approxBytes - a.approxBytes || a.key.localeCompare(b.key))
                .slice(0, 8)
                .map((entry) => ({ key: entry.key, approxBytes: entry.approxBytes })),
        };
    }

    logStats(reason: string = "manual"): void {
        const stats = this.getStats();
        console.log(
            `[DynamicNpcAnimLoader] ${reason}: ` +
                `sequenceMetaEntries=${stats.sequenceMetaEntries}, ` +
                `geometryEntries=${stats.geometryEntries}, ` +
                `geometryBytes=${stats.geometryBytes}`,
        );
        for (const entry of stats.topEntries) {
            console.log(
                `[DynamicNpcAnimLoader] top geometry ${entry.key}: approxBytes=${entry.approxBytes}`,
            );
        }
    }

    /** Identical appearances share poses and GPU keys, while NPC identity stays per instance. */
    getGeometryTypeId(type: NpcType): number {
        // These are all NPC properties used by NpcModelLoader to build the body model.
        const key = npcAppearanceKey(type);
        const previous = this.modelAppearances.get(type.id);
        if (previous !== undefined && previous !== key) this.clear();
        this.modelAppearances.set(type.id, key);
        const cached = this.geometryTypeCache.get(type);
        if (cached !== undefined) return cached;
        let id = this.geometryTypes.get(key);
        if (id === undefined) {
            id = ++this.nextGeometryTypeId;
            this.geometryTypes.set(key, id);
        }
        this.geometryTypeCache.set(type, id);
        return id;
    }

    getResolvedNpcType(npcTypeId: number): NpcType | undefined {
        let type = this.npcTypeLoader?.load(npcTypeId);
        for (let remaining = 32; type?.transforms && remaining > 0; remaining--) {
            type = type.transform(this.varManager!, this.npcTypeLoader!) ?? undefined;
        }
        return type?.transforms ? undefined : type;
    }

    private getFrameCount(seqType: SeqType): number {
        if (seqType.isSkeletalSeq()) {
            return Math.max(0, seqType.getSkeletalDuration() | 0);
        }
        return Math.max(0, seqType.frameIds?.length ?? 0);
    }

    private getFrameLengths(seqType: SeqType, frameCount: number): number[] {
        if (seqType.isSkeletalSeq()) {
            return new Array(frameCount).fill(1);
        }

        const lengths = new Array<number>(frameCount);
        for (let i = 0; i < frameCount; i++) {
            lengths[i] = seqType.getFrameLength(this.seqFrameLoader!, i) | 0;
        }
        return lengths;
    }

    private buildGeometry(
        model: Model,
        transparent: boolean,
        actorNormals: Uint16Array,
    ): { vertices: Uint8Array; indices: Int32Array } {
        if (!this.textureLoader || !this.textureIdIndexMap) {
            return {
                vertices: new Uint8Array(0),
                indices: new Int32Array(0),
            };
        }

        let sceneBuf = transparent ? this.alphaSceneBuf : this.opaqueSceneBuf;
        if (!sceneBuf) {
            sceneBuf = new SceneBuffer(
                this.textureLoader,
                this.textureIdIndexMap,
                Math.max(16, (model.verticesCount | 0) + 16),
                true,
            );
            if (transparent) {
                this.alphaSceneBuf = sceneBuf;
            } else {
                this.opaqueSceneBuf = sceneBuf;
            }
        }

        this.resetSceneBuf(sceneBuf);
        sceneBuf.addModelAnimFrame(model, transparent, actorNormals);

        return {
            vertices: new Uint8Array(sceneBuf.vertexBuf.byteArray()),
            indices: new Int32Array(sceneBuf.indices),
        };
    }

    private resetSceneBuf(sceneBuf: SceneBuffer): void {
        sceneBuf.vertexBuf.offset = 0;
        sceneBuf.vertexBuf.vertexIndices.clear();
        sceneBuf.indices.length = 0;
        sceneBuf.usedTextureIds.clear();
    }

    private promoteGeometryEntry(key: string, entry: DynamicNpcFrameGeometry): void {
        this.geomCache.delete(key);
        this.geomCache.set(key, entry);
    }

    private evictGeometryEntriesIfNeeded(): void {
        while (this.geomCacheBytes > CACHE_CONFIG.MAX_GEOMETRY_BYTES && this.geomCache.size > 1) {
            const oldestKey = this.geomCache.keys().next().value as string | undefined;
            if (!oldestKey) {
                break;
            }
            const oldest = this.geomCache.get(oldestKey);
            this.geomCache.delete(oldestKey);
            if (!oldest) {
                continue;
            }
            this.geomCacheBytes = Math.max(0, this.geomCacheBytes - oldest.approxBytes);
        }
    }
}
