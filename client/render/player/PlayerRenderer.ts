import { vec2 } from "gl-matrix";
import PicoGL, { DrawCall, Texture, VertexBuffer } from "picogl";

import { EquipmentSlot } from "../../rs/config/player/Equipment";
import { PlayerAppearance } from "../../rs/config/player/PlayerAppearance";
import { Model } from "../../rs/model/Model";
import { ModelData } from "../../rs/model/ModelData";
import { clamp } from "../../common/utils/MathUtil";
import { ActorAnimationClip } from "../../game/actor/ActorAnimation";
import type { PlayerAnimKey } from "../../game/ecs/PlayerEcs";
import { resolveHeightSamplePlaneForLocal } from "../../game/scene/PlaneResolver";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../DrawRange";
import { ACTOR_VERTEX_STRIDE, buildActorNormals } from "../buffer/ActorNormals";
import { LabelPose, LabelRig, POSE_FLOATS_PER_LABEL } from "./LabelPose";
import { WebGLMapSquare } from "../WebGLMapSquare";
import type { WebGLOsrsRenderer } from "../WebGLOsrsRenderer";

/**
 * PlayerRenderer encapsulates player-specific render passes and instance data handling.
 * It mirrors the NPC rendering pathway but consumes the player geometry and state
 * assembled by WebGLOsrsClientRenderer (dynamic or pre-baked).
 */
const PLAYER_INTERACT_BASE = 0x8000;
const UNANIMATED_PLAYER_COUNT = 200;

export function shouldUseUnanimatedIdlePlayer(
    activePlayerCount: number,
    lowPriority: boolean,
    moving: boolean,
    actionActive: boolean,
    movementSeqId: number,
    idleSeqId: number,
): boolean {
    return (
        activePlayerCount > UNANIMATED_PLAYER_COUNT &&
        lowPriority &&
        !moving &&
        !actionActive &&
        movementSeqId === idleSeqId
    );
}

export function drawPlayerSlots(
    draw: DrawCall,
    slotBuffer: VertexBuffer,
    slotScratch: Int32Array,
    slots: number[],
    elementCount: number,
): void {
    if (slots.length === 1) {
        draw.uniform("u_usePlayerSlotAttribute", false).uniform("u_drawIdOverride", slots[0] | 0);
        (draw as any).drawRanges([0, elementCount | 0, 1]);
        draw.draw();
        draw.uniform("u_drawIdOverride", -1);
        return;
    }
    for (let index = 0; index < slots.length; index++) slotScratch[index] = slots[index] | 0;
    slotBuffer.data(slotScratch.subarray(0, slots.length));
    draw.uniform("u_usePlayerSlotAttribute", true).uniform("u_drawIdOverride", -1);
    (draw as any).drawRanges([0, elementCount | 0, slots.length]);
    draw.draw();
    draw.uniform("u_usePlayerSlotAttribute", false);
}

type PlayerGpuPass = {
    vao: any;
    vb: VertexBuffer;
    ib: VertexBuffer;
    /** Per-vertex labels of GPU-animated (rest-pose) geometry. */
    lb?: VertexBuffer;
    drawCall: DrawCall;
    count: number;
};

type PlayerGpuGeometry = {
    geometryKey: string;
    bytes: number;
    opaque?: PlayerGpuPass;
    alpha?: PlayerGpuPass;
};

export class PlayerRenderer {
    constructor(private renderer: WebGLOsrsRenderer) {}

    // Reusable buffers to avoid per-frame allocations
    private slotsBuffer: number[] = [];
    private playerSlotScratch: Int32Array = new Int32Array(2048);
    private frameRenderSelectionId: number = -1;
    private frameRenderPlayersByMap: Map<number, number[]> = new Map();
    // Per-frame alpha counts captured during opaque pass; used to gate alpha pass work.
    private framePlayerAlphaCounts: Map<number, number> = new Map();
    // PERF: Cached Map for alpha pass batch groups to avoid per-frame allocation
    private alphaBatchGroups: Map<
        string,
        {
            appearance: PlayerAppearance;
            seqId: number;
            frameIdx: number;
            /** Cycles into the frame when animation smoothing blends it; 0 otherwise. */
            frameCycle: number;
            overlaySeqId?: number;
            overlayFrameIdx?: number;
            instances: Array<{ slot: number; pid: number; mode: "idle" | "walk" | "run" }>;
        }
    > = new Map();

    // Batching optimization: track batch groups per frame
    private batchGroups: Map<
        string,
        {
            appearance: PlayerAppearance;
            seqId: number;
            frameIdx: number;
            /** Cycles into the frame when animation smoothing blends it; 0 otherwise. */
            frameCycle: number;
            overlaySeqId?: number;
            overlayFrameIdx?: number;
            instances: Array<{ slot: number; pid: number; mode: "idle" | "walk" | "run" }>;
        }
    > = new Map();

    // PERF (mobile): cache face metadata per base model.
    // Note: alpha values can change at runtime via alpha transforms, so we cache the stable metadata
    // (index/priority/textureId) and rebuild the opaque/alpha buckets per frame without allocations.
    private baseModelFaceMetaCache: WeakMap<any, { faces: any[] }> = new WeakMap();
    // PERF (mobile): reuse a SceneBuffer + typed index arrays for the local player.
    private localSceneBuf?: any;
    private localIndexScratch: Int32Array = new Int32Array(0);
    private localIndexScratchAlpha: Int32Array = new Int32Array(0);
    private localFacesOpaque: any[] = [];
    private localFacesAlpha: any[] = [];
    private readonly emptyIndexScratch: Int32Array = new Int32Array(0);
    private readonly emptyVertexScratch: Uint8Array = new Uint8Array(0);
    private lastUploadedOpaqueGeomKey?: string;
    private lastUploadedAlphaGeomKey?: string;

    // Geometry build entry: delegates to renderer's current implementation.
    async initGeometry(): Promise<void> {
        const r: any = this.renderer as any;
        if (typeof r.initPlayerGeometry !== "function") return;
        this.clearPlayerGpuGeometryCache();
        // Build player geometry once using the current animation mode.
        await r.initPlayerGeometry();
        this.lastUploadedOpaqueGeomKey = undefined;
        this.lastUploadedAlphaGeomKey = undefined;
        // Capture active variant meta for quick access; no prebake variants.
        try {
            const active = this.captureCurrentVariant();
            this.drawCall = active.drawCall;
            this.drawCallAlpha = active.drawCallAlpha;
            this.drawRanges = active.frames;
            this.drawRangesAlpha = active.framesAlpha;
            this.frameCount = active.frameCount | 0;
            this.frameLengths = active.frameLengths?.slice();
            this.frameHeightsTiles = active.frameHeightsTiles?.slice();
            this.defaultHeightTiles =
                active.frameHeightsTiles?.[0] ??
                (this.renderer as any).playerDefaultHeightTiles ??
                200 / 128;
            // Get indices count from ECS for controlled player
            const osrsClient = (this.renderer as any).osrsClient;
            if (osrsClient && osrsClient.playerEcs) {
                const ecsIdx = osrsClient.playerEcs.getIndexForServerId(
                    osrsClient.controlledPlayerServerId,
                );
                if (ecsIdx !== undefined) {
                    this.dynamicIndicesCount =
                        osrsClient.playerEcs.getModelIndicesCount(ecsIdx) | 0;
                    this.dynamicIndicesCountAlpha =
                        osrsClient.playerEcs.getModelIndicesCountAlpha(ecsIdx) | 0;
                }
            }
            this.interleavedBuffer = (this.renderer as any).playerInterleavedBuffer;
            this.indexBuffer = (this.renderer as any).playerIndexBuffer;
        } catch {}
    }

    // Remote appearance prebake removed; dynamic-only path.

    // Resolve sequence id for current mode (idle/walk/run); used by dynamic path.
    resolveSeqIdForMode(): number {
        const r: any = this.renderer as any;
        return typeof r._resolvePlayerSeqIdForMode === "function"
            ? r._resolvePlayerSeqIdForMode()
            : -1;
    }

    /**
     * Build animation clip metadata for a sequence ID.
     * Contains frame count, frame lengths, and skeletal animation info.
     */
    buildAnimClipMeta(seqId: number): ActorAnimationClip | undefined {
        if (seqId < 0) return undefined;
        try {
            const client = (this.renderer as any).osrsClient;
            const seqType = client.seqTypeLoader.load(seqId);
            if (!seqType) return undefined;

            const isSkeletal = !!seqType.isSkeletalSeq?.();
            let frameCount = 1;
            let frameLengths: number[] | undefined = undefined;

            if (isSkeletal) {
                frameCount = this.getEffectiveSkeletalDuration(seqType, seqId | 0);
            } else {
                frameCount = Math.max(seqType.frameIds?.length ?? 1, 1);
                frameLengths = new Array(frameCount);
                for (let i = 0; i < frameCount; i++) {
                    frameLengths[i] = seqType.getFrameLength(client.seqFrameLoader, i) | 0;
                }
            }

            return {
                frames: [],
                framesAlpha: undefined,
                isSkeletal,
                frameCount,
                frameLengths,
                frameStep: seqType.frameStep | 0,
                looping: !!seqType.looping,
                maxLoops: seqType.maxLoops | 0,
            };
        } catch {
            return undefined;
        }
    }

    /**
     * Get effective duration for skeletal animations.
     * Caches results for performance.
     */
    private getEffectiveSkeletalDuration(seqType: any, seqId: number): number {
        try {
            const cached = this.skeletalDurationCache.get(seqId | 0);
            if (cached && cached > 0) return cached | 0;

            // cached-seq duration is (end-start).
            let duration = Number(seqType?.getSkeletalDuration?.() ?? 0) | 0;

            if (!(duration > 0)) duration = 1;
            this.skeletalDurationCache.set(seqId | 0, duration | 0);
            return duration | 0;
        } catch {
            return 1;
        }
    }

    // ===== Internal geometry/meta owned by PlayerRenderer =====
    private drawCall?: DrawCall;
    private drawCallAlpha?: DrawCall;
    private drawRanges?: DrawRange[];
    private drawRangesAlpha?: DrawRange[];
    private frameCount: number = 0;
    private frameLengths?: number[];
    private frameHeightsTiles?: number[];
    private defaultHeightTiles: number = 200 / 128;
    private dynamicIndicesCount: number = 0;
    private dynamicIndicesCountAlpha: number = 0;
    private interleavedBuffer?: any;
    private indexBuffer?: any;
    private lastLoggedSeqId: number = -1;
    private lastLoggedFrameIndex: number = -1;
    private playerSoundState: Map<string, { seqId: number; frameIdx: number }> = new Map();
    private skeletalDurationCache: Map<number, number> = new Map();

    // Always-on GFX (toolkit request)
    private readonly ALWAYS_SPOT_ID: number = 833;
    private readonly spotRenderCacheLimit: number = 24;
    private spotRenderCache: Map<
        string,
        {
            vao: any;
            vb: any;
            ib: any;
            drawCall: DrawCall;
            indexCount: number;
            midY: number;
            bottomY: number;
        }
    > = new Map();
    private spotRenderGroups: Map<string, { frameIdx: number; yOff: number; slots: number[] }> =
        new Map();

    private variantCache: Map<
        string,
        {
            drawCall: DrawCall;
            drawCallAlpha?: DrawCall;
            frames: DrawRange[];
            framesAlpha?: DrawRange[];
            frameCount: number;
            frameLengths?: number[];
            frameHeightsTiles?: number[];
            isSkeletal: boolean;
        }
    > = new Map();

    // ===== Per-appearance base model cache (shared) =====
    private appearanceBaseCache: Map<
        string,
        { baseModel: any; baseCenterX: number; baseCenterZ: number; defaultHeightTiles: number }
    > = new Map();
    private lastRenderableAppearance = new Map<number, PlayerAppearance>();

    // Clean up cache entries for a deallocated player appearance
    cleanupAppearanceCache(appearanceHash?: string): void {
        if (appearanceHash) {
            this.appearanceBaseCache.delete(appearanceHash);
            // Also clear any geometry cache entries that contain this appearance
            for (const [key] of this.geomCache) {
                if (key.startsWith(appearanceHash + "|")) {
                    this.geomCache.delete(key);
                }
            }
            for (const [key, geometry] of this.playerGpuGeometryCache) {
                if (key.startsWith(appearanceHash + "|")) {
                    this.deletePlayerGpuGeometry(geometry);
                    this.playerGpuGeometryCache.delete(key);
                }
            }
            return;
        }
        this.appearanceBaseCache.clear();
        this.lastRenderableAppearance.clear();
        this.geomCache.clear();
        this.clearPlayerGpuGeometryCache();
    }

    // Bounded geometry cache: (appearance|seqId|frameIdx) -> buffers
    private static readonly GEOM_CACHE_MAX_ENTRIES = 384;
    private geomCache: Map<
        string,
        { verts: Uint8Array; inds: Int32Array; vertsA: Uint8Array; indsA: Int32Array }
    > = new Map();
    private playerGpuGeometryCache: Map<string, PlayerGpuGeometry> = new Map();
    private playerGpuGeometryBytes = 0;
    /** ~1,600 frames at the ~40 KB a player frame measures; a crowd of ~25 fits. */
    private static readonly GPU_GEOMETRY_BUDGET_BYTES = 64 * 1024 * 1024;

    private ensureBaseForAppearance(
        app: PlayerAppearance,
    ):
        | { baseModel: any; baseCenterX: number; baseCenterZ: number; defaultHeightTiles: number }
        | undefined {
        try {
            const mv = this.renderer.osrsClient;
            const key = this.getAppearanceCacheKey(app);
            const existing = this.appearanceBaseCache.get(key);
            if (existing) return existing;

            // Delegate construction to PlayerEcs so renderer doesn't build models
            const rec = mv.playerEcs.ensureBaseForAppearance(app, {
                idkTypeLoader: mv.idkTypeLoader,
                objTypeLoader: mv.objTypeLoader,
                modelLoader: mv.modelLoader,
                textureLoader: mv.textureLoader,
                npcTypeLoader: mv.npcTypeLoader,
                seqTypeLoader: mv.seqTypeLoader,
                seqFrameLoader: mv.seqFrameLoader,
                skeletalSeqLoader: mv.loaderFactory.getSkeletalSeqLoader?.(),
                varManager: mv.varManager,
                basTypeLoader: mv.basTypeLoader,
            });
            if (!rec) return undefined;

            // Ensure textures used by this appearance are uploaded to the texture array
            try {
                const used = new Set<number>();
                if (rec.baseModel?.faceTextures) {
                    const texLoader = mv.textureLoader;
                    for (let i = 0; i < rec.baseModel.faceCount; i++) {
                        const tid = rec.baseModel.faceTextures[i];
                        if (tid !== -1 && texLoader.isSd?.(tid)) used.add(tid);
                    }
                }
                if (used.size > 0) {
                    const toUpload = new Map<number, Int32Array>();
                    for (const tid of used) {
                        if (!(this.renderer as any).loadedTextureIds?.has?.(tid)) {
                            try {
                                const px = mv.textureLoader.getPixelsArgb(tid, 128, true, 1.0);
                                toUpload.set(tid, px);
                            } catch {}
                        }
                    }
                    if (toUpload.size > 0) (this.renderer as any).updateTextureArray?.(toUpload);
                }
            } catch {}

            this.appearanceBaseCache.set(key, rec);
            return rec;
        } catch {
            return undefined;
        }
    }

    private getAppearanceCacheKey(app: PlayerAppearance): string {
        const equipKey =
            app.getEquipKey?.() ??
            (Array.isArray(app.equip) ? app.equip.slice(0, 14).join(",") : "");
        return app.getCacheKey?.() ?? `${app.getHash?.().toString() ?? "0"}|${equipKey}`;
    }

    private resolveRenderableAppearance(
        serverId: number,
        appearance: PlayerAppearance,
    ): PlayerAppearance | undefined {
        if (this.ensureBaseForAppearance(appearance)) {
            this.lastRenderableAppearance.set(serverId, appearance);
            return appearance;
        }
        return this.lastRenderableAppearance.get(serverId);
    }

    private getFirstPersonAppearance(pid: number, appearance: PlayerAppearance): PlayerAppearance {
        if (!this.isFirstPersonArmsPlayer(pid, appearance)) {
            return appearance;
        }
        return new PlayerAppearance(
            appearance.gender,
            appearance.colors,
            appearance.kits,
            appearance.equip,
            appearance.headIcons,
            appearance.npcTransformationId,
            true,
        );
    }

    private isFirstPersonArmsPlayer(pid: number, appearance?: PlayerAppearance): boolean {
        const app = appearance ?? this.renderer.osrsClient.playerEcs.getAppearance(pid);
        return (
            this.renderer.osrsClient.firstPersonArmsVisible === true &&
            this.isControlledPid(pid) &&
            (app?.npcTransformationId ?? -1) < 0
        );
    }

    /**
     * GPU geometry for one animation frame (appearance|seq|frame...), uploaded once and kept.
     * Crowds cycle through thousands of frames; keeping one slot per appearance+animation
     * re-uploaded nearly every frame step, and the 384-entry CPU cache thrashed behind it.
     */
    private getPlayerGpuGeometry(geometryKey: string): PlayerGpuGeometry | undefined {
        const hit = this.playerGpuGeometryCache.get(geometryKey);
        if (hit) {
            this.playerGpuGeometryCache.delete(geometryKey);
            this.playerGpuGeometryCache.set(geometryKey, hit);
            return hit;
        }

        const cached = this.geomCache.get(geometryKey);
        if (!cached) return undefined;

        const r: any = this.renderer as any;
        const geometry: PlayerGpuGeometry = {
            geometryKey,
            bytes:
                cached.verts.byteLength +
                cached.inds.byteLength +
                cached.vertsA.byteLength +
                cached.indsA.byteLength,
            opaque: this.createPlayerGpuPass(
                cached.verts,
                cached.inds,
                r.playerProgramOpaque ?? r.playerProgram,
            ),
            alpha: this.createPlayerGpuPass(cached.vertsA, cached.indsA, r.playerProgram),
        };
        this.addPlayerGpuGeometry(geometry);
        return geometry;
    }

    private addPlayerGpuGeometry(geometry: PlayerGpuGeometry): void {
        this.playerGpuGeometryCache.set(geometry.geometryKey, geometry);
        this.playerGpuGeometryBytes += geometry.bytes;

        // ponytail: one VAO + buffer pair per frame; pack frames into shared arenas if the
        // object count ever shows up in profiles.
        while (
            this.playerGpuGeometryBytes > PlayerRenderer.GPU_GEOMETRY_BUDGET_BYTES &&
            this.playerGpuGeometryCache.size > 1
        ) {
            const [oldestKey, oldest] = this.playerGpuGeometryCache.entries().next().value!;
            this.playerGpuGeometryCache.delete(oldestKey);
            this.deletePlayerGpuGeometry(oldest);
        }
    }

    private createPlayerGpuPass(
        vertices: Uint8Array,
        indices: Int32Array,
        program: any,
        labels?: Uint8Array,
    ): PlayerGpuPass | undefined {
        if (!program || indices.length <= 0) return undefined;

        const r: any = this.renderer as any;
        const vb = r.app.createInterleavedBuffer(ACTOR_VERTEX_STRIDE, vertices, PicoGL.STATIC_DRAW);
        const ib = r.app.createIndexBuffer(
            PicoGL.UNSIGNED_INT as number,
            indices,
            PicoGL.STATIC_DRAW,
        );
        const vao = r.app
            .createVertexArray()
            .vertexAttributeBuffer(0, vb, {
                type: PicoGL.UNSIGNED_INT,
                size: 4,
                stride: ACTOR_VERTEX_STRIDE,
                integer: true as any,
            })
            .instanceAttributeBuffer(1, r.playerSlotBuffer, {
                type: PicoGL.INT,
                size: 1,
                integer: true as any,
            })
            .indexBuffer(ib);
        const lb = labels
            ? r.app.createVertexBuffer(PicoGL.UNSIGNED_BYTE, 1, labels, PicoGL.STATIC_DRAW)
            : undefined;
        // Read as a float (a_label): PicoGL would otherwise pass byte buffers as integers.
        if (lb) vao.vertexAttributeBuffer(2, lb, { type: PicoGL.UNSIGNED_BYTE, size: 1, integer: false as any });
        const drawCall = r.app
            .createDrawCall(program, vao)
            .uniformBlock("SceneUniforms", r.sceneUniformBuffer)
            .uniform("u_timeLoaded", -1.0)
            .uniform("u_usePlayerSlotAttribute", false)
            .texture("u_textures", r.textureArray)
            .texture("u_textureMaterials", r.textureMaterials)
            .texture("u_poseTexture", r.playerPoseTexture);
        return { vao, vb, ib, lb, drawCall, count: indices.length | 0 };
    }

    private deletePlayerGpuPass(pass: PlayerGpuPass): void {
        try {
            pass.vao.delete();
            pass.vb.delete();
            pass.ib.delete();
            pass.lb?.delete();
        } catch {}
    }

    private deletePlayerGpuGeometry(geometry: PlayerGpuGeometry): void {
        this.playerGpuGeometryBytes -= geometry.bytes;
        if (geometry.opaque) this.deletePlayerGpuPass(geometry.opaque);
        if (geometry.alpha) this.deletePlayerGpuPass(geometry.alpha);
    }

    private clearPlayerGpuGeometryCache(): void {
        for (const geometry of this.playerGpuGeometryCache.values()) {
            this.deletePlayerGpuGeometry(geometry);
        }
        this.playerGpuGeometryCache.clear();
        this.playerGpuGeometryBytes = 0;
    }

    // GPU animation: players posed by one matrix per label in the vertex shader, from a rest-pose
    // mesh per appearance, instead of a CPU-built mesh per animation frame. Poses that need the
    // CPU (skeletal animations, alpha/colour transforms) fall back to the per-frame cache above.
    private static readonly POSE_ROWS = 256;
    private static readonly POSE_CACHE_MAX_ENTRIES = 4096;
    private poseUpload = new Float32Array(0);
    private readonly poseRows = new Map<string, { geometry: PlayerGpuGeometry; row: number }>();
    private readonly poseRowMatrices: Float32Array[] = [];
    private readonly poseCache = new Map<string, Float32Array | null>();
    private readonly rigs = new WeakMap<object, LabelRig | null>();
    private readonly restMeshIds = new WeakMap<object, number>();
    private nextRestMeshId = 0;

    private rigFor(baseModel: any): LabelRig | undefined {
        let rig = this.rigs.get(baseModel);
        if (rig === undefined) {
            rig = LabelRig.of(baseModel) ?? null;
            this.rigs.set(baseModel, rig);
        }
        return rig ?? undefined;
    }

    /** The group's pose matrices, or undefined when it must be posed on the CPU. */
    private poseFor(batchKey: string, baseRec: any, group: any): Float32Array | undefined {
        const cached = this.poseCache.get(batchKey);
        if (cached !== undefined) {
            this.poseCache.delete(batchKey);
            this.poseCache.set(batchKey, cached);
            return cached ?? undefined;
        }
        let matrices: Float32Array | null = null;
        try {
            const rig = this.rigFor(baseRec.baseModel);
            // The CPU path re-centres the posed model on the base centre; GPU poses assume none.
            if (rig && (baseRec.baseCenterX | 0) === 0 && (baseRec.baseCenterZ | 0) === 0) {
                const mv: any = this.renderer.osrsClient;
                const seqType = group.seqId >= 0 ? mv.seqTypeLoader.load(group.seqId | 0) : undefined;
                const overlayType =
                    typeof group.overlaySeqId === "number" && typeof group.overlayFrameIdx === "number"
                        ? mv.seqTypeLoader.load(group.overlaySeqId | 0)
                        : undefined;
                if (!seqType?.isSkeletalSeq?.() && !overlayType?.isSkeletalSeq?.()) {
                    const pose = new LabelPose(rig);
                    this.applySequenceTransformationsToModel(
                        pose,
                        seqType,
                        group.seqId | 0,
                        group.frameIdx | 0,
                        overlayType,
                        (group.overlaySeqId ?? -1) | 0,
                        (group.overlayFrameIdx ?? -1) | 0,
                        mv,
                        group.frameCycle | 0,
                    );
                    if (!pose.needsCpu) matrices = pose.finish(0, 0);
                }
            }
        } catch {
            matrices = null;
        }
        this.poseCache.set(batchKey, matrices);
        while (this.poseCache.size > PlayerRenderer.POSE_CACHE_MAX_ENTRIES) {
            this.poseCache.delete(this.poseCache.keys().next().value as string);
        }
        return matrices ?? undefined;
    }

    /** The appearance's rest-pose mesh with per-vertex labels, built once. */
    private restMeshFor(baseModel: any, rig: LabelRig): PlayerGpuGeometry | undefined {
        let id = this.restMeshIds.get(baseModel);
        if (id === undefined) {
            id = this.nextRestMeshId++;
            this.restMeshIds.set(baseModel, id);
        }
        const key = `rest:${id}`;
        const hit = this.playerGpuGeometryCache.get(key);
        if (hit) {
            this.playerGpuGeometryCache.delete(key);
            this.playerGpuGeometryCache.set(key, hit);
            return hit;
        }

        const r: any = this.renderer;
        const textureLoader = r.osrsClient.textureLoader;
        const textureIdIndexMap = r.textureIdIndexMap ?? new Map<number, number>();
        const SceneBufferMod = require("../buffer/SceneBuffer");
        const isTrans = SceneBufferMod.isModelFaceTransparent;
        const faces = SceneBufferMod.getModelFaces(baseModel);
        const vertexLabel = rig.vertexLabelOf();
        const normals = buildActorNormals(baseModel);
        const build = (passFaces: any[]) => {
            // Unshared vertices: each face corner is its own vertex, so it carries its label.
            const sceneBuf = new SceneBufferMod.SceneBuffer(
                textureLoader,
                textureIdIndexMap,
                passFaces.length * 3 + 16,
                true,
            );
            if (passFaces.length > 0) sceneBuf.addModel(baseModel, passFaces, undefined, false, normals);
            const labels = new Uint8Array(passFaces.length * 3);
            for (let i = 0; i < passFaces.length; i++) {
                const face = passFaces[i].index;
                labels[i * 3] = vertexLabel[baseModel.indices1[face]] + 1;
                labels[i * 3 + 1] = vertexLabel[baseModel.indices2[face]] + 1;
                labels[i * 3 + 2] = vertexLabel[baseModel.indices3[face]] + 1;
            }
            return {
                verts: sceneBuf.vertexBuf.byteArray() as Uint8Array,
                inds: Int32Array.from(sceneBuf.indices as number[]),
                labels,
            };
        };
        const opaque = build(faces.filter((f: any) => !isTrans(textureLoader, f)));
        const alpha = build(faces.filter((f: any) => isTrans(textureLoader, f)));
        const geometry: PlayerGpuGeometry = {
            geometryKey: key,
            bytes:
                opaque.verts.byteLength + opaque.inds.byteLength + opaque.labels.byteLength +
                alpha.verts.byteLength + alpha.inds.byteLength + alpha.labels.byteLength,
            opaque: this.createPlayerGpuPass(
                opaque.verts,
                opaque.inds,
                r.playerProgramOpaque ?? r.playerProgram,
                opaque.labels,
            ),
            alpha: this.createPlayerGpuPass(alpha.verts, alpha.inds, r.playerProgram, alpha.labels),
        };
        this.addPlayerGpuGeometry(geometry);
        return geometry;
    }

    /**
     * Poses this pass's GPU-animatable groups and uploads them, one texture row each.
     * Returns the rest mesh and row per batch key; groups left out draw from the frame cache.
     */
    private preparePoses(groups: Map<string, any>): Map<string, { geometry: PlayerGpuGeometry; row: number }> {
        const out = this.poseRows;
        out.clear();
        const rows = this.poseRowMatrices;
        rows.length = 0;
        let maxLabels = 0;
        for (const [batchKey, group] of groups) {
            if (out.size >= PlayerRenderer.POSE_ROWS) break;
            const baseRec = this.ensureBaseForAppearance(group.appearance);
            if (!baseRec) continue;
            const matrices = this.poseFor(batchKey, baseRec, group);
            if (!matrices) continue;
            const geometry = this.restMeshFor(baseRec.baseModel, this.rigFor(baseRec.baseModel)!);
            if (!geometry) continue;
            out.set(batchKey, { geometry, row: rows.length });
            rows.push(matrices);
            maxLabels = Math.max(maxLabels, matrices.length / POSE_FLOATS_PER_LABEL);
        }
        if (rows.length === 0) return out;

        const r: any = this.renderer;
        if (!r.playerPoseTexture) {
            out.clear();
            return out;
        }
        const width = maxLabels * 3;
        const rowFloats = width * 4;
        if (this.poseUpload.length < rowFloats * rows.length) {
            this.poseUpload = new Float32Array(rowFloats * PlayerRenderer.POSE_ROWS);
        }
        for (let i = 0; i < rows.length; i++) this.poseUpload.set(rows[i], i * rowFloats);
        const gl: WebGL2RenderingContext = r.app.gl;
        const texture: any = r.playerPoseTexture;
        texture.bind(Math.max(0, texture.currentUnit | 0));
        gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            width,
            rows.length,
            gl.RGBA,
            gl.FLOAT,
            this.poseUpload.subarray(0, rowFloats * rows.length),
        );
        return out;
    }

    // ==== Spot GFX helpers (id 833) ====
    private buildSpotBaseModel(spotId: number): Model | undefined {
        try {
            const mv: any = this.renderer.osrsClient as any;
            const spot = mv.spotAnimTypeLoader?.load?.(spotId | 0);
            if (!spot) return undefined;
            const md0 = mv.modelLoader?.getModel?.(spot.modelId);
            if (!md0) return undefined;
            const md = ModelData.copyFrom(md0, false, false, false, false);
            if (spot.recolorFrom) {
                for (let i = 0; i < spot.recolorFrom.length; i++)
                    md.recolor(spot.recolorFrom[i], spot.recolorTo[i]);
            }
            if (spot.retextureFrom) {
                for (let i = 0; i < spot.retextureFrom.length; i++)
                    md.retexture(spot.retextureFrom[i], spot.retextureTo[i]);
            }
            const model: Model = md.light(
                mv.textureLoader,
                ((spot.ambient | 0) + 64) | 0,
                ((spot.contrast | 0) + 850) | 0,
                -30,
                -50,
                -30,
            ) as Model;
            return model;
        } catch {
            return undefined;
        }
    }

    private applySpotTransform(model: Model, spot: any): void {
        if (!spot) return;
        try {
            if ((spot.widthScale | 0) !== 128 || (spot.heightScale | 0) !== 128) {
                model.scale(spot.widthScale | 0, spot.heightScale | 0, spot.widthScale | 0);
            }
        } catch {}
        try {
            const ori = (((spot.orientation | 0) % 360) + 360) % 360;
            if (ori === 90) model.rotate90();
            else if (ori === 180) model.rotate180();
            else if (ori === 270) model.rotate270();
        } catch {}
    }

    private buildSpotFrameModel(spotId: number, pid: number): { model?: Model; frameIdx: number } {
        const frameIdx = this.computeSpotFrameIndex(spotId | 0, pid | 0);
        return {
            model: this.buildSpotFrameModelForFrame(spotId | 0, frameIdx | 0),
            frameIdx: frameIdx | 0,
        };
    }

    private computeSpotFrameIndex(spotId: number, pid: number): number {
        try {
            const mv: any = this.renderer.osrsClient as any;
            const spot = mv.spotAnimTypeLoader?.load?.(spotId | 0);
            const seqId: number = typeof spot?.sequenceId === "number" ? spot.sequenceId | 0 : -1;
            if (seqId < 0) return 0;

            const seq = mv.seqTypeLoader?.load?.(seqId | 0);
            if (seq?.isSkeletalSeq?.()) {
                const duration = Math.max(1, seq.getSkeletalDuration?.() | 0);
                return this.computeFrameIndex(seqId | 0, pid | 0) % duration;
            }

            const ids = seq?.frameIds;
            if (ids && ids.length > 0) {
                return Math.max(0, this.computeFrameIndex(seqId | 0, pid | 0) % ids.length) | 0;
            }

            return 0;
        } catch {
            return 0;
        }
    }

    private buildSpotFrameModelForFrame(spotId: number, frameIdx: number): Model | undefined {
        try {
            const mv: any = this.renderer.osrsClient as any;
            const spot = mv.spotAnimTypeLoader?.load?.(spotId | 0);
            if (!spot) return undefined;
            const base = this.buildSpotBaseModel(spotId);
            if (!base) return undefined;
            const seqId: number = typeof spot.sequenceId === "number" ? spot.sequenceId | 0 : -1;
            let out: Model;
            if (seqId >= 0) {
                const seq = mv.seqTypeLoader?.load?.(seqId | 0);
                if (seq?.isSkeletalSeq?.()) {
                    const duration = Math.max(1, seq.getSkeletalDuration?.() | 0);
                    const resolvedFrameIdx = (((frameIdx | 0) % duration) + duration) % duration;
                    const skeletal = mv.skeletalSeqLoader?.load?.(seq.skeletalId | 0);
                    out = Model.copyAnimated(base, !skeletal?.hasAlphaTransform, true);
                    if (skeletal) out.animateSkeletal(skeletal, resolvedFrameIdx | 0);
                } else if (seq?.frameIds && seq.frameIds.length > 0) {
                    const ids = seq.frameIds;
                    const idx = Math.max(
                        0,
                        (((frameIdx | 0) % ids.length) + ids.length) % ids.length,
                    );
                    const frameKey = ids[idx] | 0;
                    const seqFrame = mv.seqFrameLoader?.load?.(frameKey);
                    if (seqFrame) {
                        out = Model.copyAnimated(
                            base,
                            !seqFrame.hasAlphaTransform,
                            !seqFrame.hasColorTransform,
                        );
                        out.animate(seqFrame, undefined, !!seq.op14);
                    } else {
                        out = Model.copyAnimated(base, true, true);
                    }
                } else {
                    out = Model.copyAnimated(base, true, true);
                }
            } else {
                out = Model.copyAnimated(base, true, true);
            }
            this.applySpotTransform(out, spot);
            return out;
        } catch {
            return undefined;
        }
    }

    private getReusableSpotRenderGroups(): Map<
        string,
        { frameIdx: number; yOff: number; slots: number[] }
    > {
        for (const group of this.spotRenderGroups.values()) {
            group.slots.length = 0;
        }
        this.spotRenderGroups.clear();
        return this.spotRenderGroups;
    }

    private evictSpotRenderCacheIfNeeded(): void {
        if (this.spotRenderCache.size < this.spotRenderCacheLimit) return;
        const lruKey = this.spotRenderCache.keys().next().value;
        if (lruKey === undefined) return;
        const entry = this.spotRenderCache.get(lruKey);
        if (entry) {
            try {
                entry.vao?.delete?.();
                entry.vb?.delete?.();
                entry.ib?.delete?.();
                (entry.drawCall as any)?.delete?.();
            } catch {}
        }
        this.spotRenderCache.delete(lruKey);
    }

    private getOrCreateSpotRenderRecord(
        spotId: number,
        frameIdx: number,
        transparent: boolean,
    ):
        | {
              vao: any;
              vb: any;
              ib: any;
              drawCall: DrawCall;
              indexCount: number;
              midY: number;
              bottomY: number;
          }
        | undefined {
        const key = `${spotId | 0}|${frameIdx | 0}|${transparent ? 1 : 0}`;
        const existing = this.spotRenderCache.get(key);
        if (existing) {
            this.spotRenderCache.delete(key);
            this.spotRenderCache.set(key, existing);
            return existing;
        }

        const model = this.buildSpotFrameModelForFrame(spotId | 0, frameIdx | 0);
        if (!model) return undefined;
        this.ensureSpotTexturesLoaded(model);

        let midY = 0;
        let bottomY = 0;
        try {
            (model as any).calculateBoundsCylinder?.();
            bottomY = ((model as any).bottomY | 0) as number;
        } catch {}
        try {
            (model as any).calculateBounds?.();
            const minY = ((model as any).minY | 0) as number;
            const maxY = ((model as any).maxY | 0) as number;
            midY = (minY + maxY) >> 1;
        } catch {}

        const { vertices, indices } = this.buildSpotGeomArrays(model, transparent);
        if (!(indices.length > 0)) return undefined;

        const rAny: any = this.renderer as any;
        const app = rAny.app;
        const program = transparent ? rAny.npcProgram : (rAny.npcProgramOpaque ?? rAny.npcProgram);
        const vb = app.createInterleavedBuffer(12, vertices);
        const ib = app.createIndexBuffer(PicoGL.UNSIGNED_INT as number, indices);
        const vao = app
            .createVertexArray()
            .vertexAttributeBuffer(0, vb, {
                type: PicoGL.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as any,
            })
            .indexBuffer(ib);
        const drawCall = app.createDrawCall(program, vao);

        this.evictSpotRenderCacheIfNeeded();

        const record = {
            vao,
            vb,
            ib,
            drawCall,
            indexCount: indices.length | 0,
            midY: midY | 0,
            bottomY: bottomY | 0,
        };
        this.spotRenderCache.set(key, record);
        return record;
    }

    private ensureSpotTexturesLoaded(model: Model): void {
        try {
            const mv: any = this.renderer.osrsClient as any;
            const used = new Set<number>();
            if (model?.faceTextures) {
                const texLoader = mv.textureLoader;
                for (let i = 0; i < model.faceCount; i++) {
                    const tid = model.faceTextures[i];
                    if (tid !== -1 && texLoader.isSd?.(tid)) used.add(tid);
                }
            }
            if (used.size > 0) {
                const toUpload = new Map<number, Int32Array>();
                for (const tid of used) {
                    if (!(this.renderer as any).loadedTextureIds?.has?.(tid)) {
                        try {
                            const px = mv.textureLoader.getPixelsArgb(tid, 128, true, 1.0);
                            toUpload.set(tid, px);
                        } catch {}
                    }
                }
                if (toUpload.size > 0) (this.renderer as any).updateTextureArray?.(toUpload);
            }
        } catch {}
    }

    private buildSpotGeomArrays(
        model: Model,
        transparent: boolean,
    ): { vertices: Uint8Array; indices: Int32Array } {
        const textureLoader = this.renderer.osrsClient.textureLoader;
        const textureIdIndexMap =
            (this.renderer as any).textureIdIndexMap ?? new Map<number, number>();
        const SceneBufferMod = require("../buffer/SceneBuffer");
        const SceneBufferCls = SceneBufferMod.SceneBuffer;
        const getFaces = SceneBufferMod.getModelFaces;
        const isTrans = SceneBufferMod.isModelFaceTransparent;

        const sceneBuf = new SceneBufferCls(
            textureLoader,
            textureIdIndexMap,
            model.verticesCount + 16,
        );
        const facesAll = getFaces(model);
        const faces = facesAll.filter((f: any) =>
            transparent ? isTrans(textureLoader, f) : !isTrans(textureLoader, f),
        );
        if (faces.length > 0) sceneBuf.addModel(model, faces);
        return {
            vertices: sceneBuf.vertexBuf.byteArray(),
            indices: new Int32Array(sceneBuf.indices),
        };
    }

    // kept for reference; not used after switching to ephemeral buffers
    private uploadSpotGeometry(model: Model): { countOpaque: number; countAlpha: number } {
        const { vertices: vo, indices: io } = this.buildSpotGeomArrays(model, false);
        const { vertices: va, indices: ia } = this.buildSpotGeomArrays(model, true);
        return { countOpaque: io.length | 0, countAlpha: ia.length | 0 };
    }

    private resolveControlledPlayerSlotInMap(
        map: WebGLMapSquare,
    ): { slot: number; pid: number } | undefined {
        try {
            const r = this.renderer;
            const pe: any = r.osrsClient.playerEcs as any;
            const pid = pe.getIndexForServerId?.(r.osrsClient.controlledPlayerServerId);
            if (pid === undefined) return undefined;
            const playerIndices = this.getRenderPlayersForMap(map);
            const idx = playerIndices.indexOf(pid | 0);
            if (idx === -1) return undefined;
            return { slot: idx | 0, pid: pid | 0 };
        } catch {
            return undefined;
        }
    }

    private computeHeadOffsetUnits(pid: number): number {
        try {
            const app = this.renderer.osrsClient.playerEcs.getAppearance(pid);
            const baseRec = app ? this.ensureBaseForAppearance(app) : undefined;
            const tiles = Math.max(0.8, (baseRec?.defaultHeightTiles ?? 1.0) * 0.9);
            return Math.floor(tiles * 128);
        } catch {
            return Math.floor(1.0 * 128);
        }
    }

    // Public: draw spot id 833 on ALL players that belong to this map for given pass
    renderAlwaysSpotForMap(
        map: WebGLMapSquare,
        baseOffsetPlayer: number,
        actorDataTexture: Texture | undefined,
        pass: "opaque" | "alpha",
    ): void {
        try {
            if (!actorDataTexture) return;
            if (baseOffsetPlayer === -1) return;
            // Gather players present in this map and assign slots consistent with addPlayerRenderData
            const rAny: any = this.renderer as any;
            const pe = rAny.osrsClient.playerEcs as any;
            const playerIndices = this.getRenderPlayersForMap(map);
            if (playerIndices.length === 0) return;

            // Prepare shared state
            const transparent = pass === "alpha";
            const mapPos = vec2.fromValues(map.renderPosX, map.renderPosY);
            const frameRecords = new Map<
                number,
                {
                    vao: any;
                    vb: any;
                    ib: any;
                    drawCall: DrawCall;
                    indexCount: number;
                    midY: number;
                    bottomY: number;
                }
            >();
            const groups = this.getReusableSpotRenderGroups();

            for (let s = 0; s < playerIndices.length; s++) {
                const pid = playerIndices[s] | 0;
                const slot = s | 0; // matches addPlayerRenderData ordering

                const frameIdx = this.computeSpotFrameIndex(this.ALWAYS_SPOT_ID, pid);
                let frameRecord = frameRecords.get(frameIdx | 0);
                if (!frameRecord) {
                    frameRecord = this.getOrCreateSpotRenderRecord(
                        this.ALWAYS_SPOT_ID,
                        frameIdx | 0,
                        transparent,
                    );
                    if (!frameRecord) continue;
                    frameRecords.set(frameIdx | 0, frameRecord);
                }

                let yHead = 128;
                try {
                    yHead = this.computeHeadOffsetUnits(pid) | 0;
                } catch {}
                const fudge = 8;
                const yOff = (yHead - (frameRecord.midY || frameRecord.bottomY) + fudge) | 0;
                const groupKey = `${frameIdx | 0}|${yOff | 0}`;
                let group = groups.get(groupKey);
                if (!group) {
                    group = { frameIdx: frameIdx | 0, yOff: yOff | 0, slots: [] };
                    groups.set(groupKey, group);
                }
                group.slots.push(slot);
            }

            if (groups.size === 0) return;

            // Draw once per shared spot frame/y-offset group, reusing cached GPU objects.
            rAny.app.disable(PicoGL.CULL_FACE);
            for (const group of groups.values()) {
                const frameRecord = frameRecords.get(group.frameIdx | 0);
                if (!frameRecord || !(frameRecord.indexCount > 0)) continue;

                const dc = rAny
                    .configureDrawCall(frameRecord.drawCall)
                    .uniformBlock("SceneUniforms", rAny.sceneUniformBuffer)
                    .uniform("u_timeLoaded", -1.0)
                    .texture("u_textures", rAny.textureArray)
                    .texture("u_textureMaterials", rAny.textureMaterials)
                    .uniform("u_mapPos", mapPos)
                    .uniform("u_npcDataOffset", baseOffsetPlayer | 0)
                    .uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4)
                    .texture("u_npcDataTexture", actorDataTexture as Texture)
                    .texture("u_heightMap", map.heightMapTexture)
                    .uniform("u_sceneBorderSize", map.borderSize)
                    .uniform("u_modelYOffset", -(group.yOff | 0));

                for (let i = 0; i < group.slots.length; i++) {
                    dc.uniform("u_drawIdOverride", group.slots[i] | 0);
                    dc.draw();
                }
            }
            if (rAny.cullBackFace) rAny.app.enable(PicoGL.CULL_FACE);
        } catch {}
    }

    private getSeqMeta(
        seqId: number,
    ):
        | { isSkeletal: boolean; frameCount: number; frameLengths?: number[]; looping?: boolean }
        | undefined {
        try {
            const mv = this.renderer.osrsClient;
            const seqType = mv.seqTypeLoader.load(seqId | 0);
            if (!seqType) return undefined;
            if (seqType.isSkeletalSeq())
                return {
                    isSkeletal: true,
                    frameCount: this.getEffectiveSkeletalDuration(seqType as any, seqId | 0),
                    looping: !!seqType.looping,
                };
            const fc = Math.max(1, (seqType.frameIds?.length ?? 1) | 0);
            const lens = new Array(fc);
            for (let i = 0; i < fc; i++) lens[i] = seqType.getFrameLength(mv.seqFrameLoader, i) | 0;
            return {
                isSkeletal: false,
                frameCount: fc,
                frameLengths: lens,
                looping: !!seqType.looping,
            };
        } catch {
            return undefined;
        }
    }

    private computeFrameIndex(seqId: number, pid: number): number {
        try {
            const meta = this.getSeqMeta(seqId);
            if (!meta) return 0;
            const pe: any = this.renderer.osrsClient.playerEcs as any;
            const baseTick: number = (pe.getAnimTick?.(pid) ?? 0) | 0;
            const tick: number = baseTick | 0;
            const fc = Math.max(1, meta.frameCount | 0);
            if (meta.isSkeletal) return tick % fc;
            const lens = meta.frameLengths;
            if (lens && lens.length === fc) {
                let total = 0;
                for (let i = 0; i < fc; i++) total += lens[i] | 0;
                const t = total > 0 ? tick % total : tick % fc;
                let acc = 0;
                for (let i = 0; i < fc; i++) {
                    acc += lens[i] | 0;
                    if (t < acc) return i;
                }
            }
            return tick % fc;
        } catch {
            return 0;
        }
    }

    private resolveControlledIdleSeqOverride(
        pid: number,
    ): { seqId: number; frameIdx: number } | undefined {
        const overrideSeqId = this.renderer.playerIdleSeqId | 0;
        if (overrideSeqId < 0 || !this.isControlledPid(pid)) {
            return undefined;
        }
        return {
            seqId: overrideSeqId,
            frameIdx: this.computeFrameIndex(overrideSeqId, pid) | 0,
        };
    }

    private applySingleSequenceToModel(
        model: Model,
        seqType: any,
        seqId: number,
        frameIdx: number,
        mv: any,
        frameCycle: number = 0,
    ): boolean {
        if (!seqType) return false;
        if (seqType.isSkeletalSeq?.()) {
            const skeletal = mv.loaderFactory.getSkeletalSeqLoader?.()?.load(seqType.skeletalId);
            if (!skeletal) return false;
            const duration = this.getEffectiveSkeletalDuration(seqType, seqId | 0);
            const local = Math.max(0, frameIdx | 0) % Math.max(1, duration | 0);
            // cached sequences use the local frame index (no start offset at render time).
            model.animateSkeletal(skeletal, local | 0);
            return true;
        }

        if (seqType.frameIds && seqType.frameIds.length > 0) {
            const ids = seqType.frameIds as number[];
            const idx = Math.max(0, frameIdx | 0) % (ids.length | 0);
            const key = ids[idx] | 0;
            const frame0 = mv.seqFrameLoader.load(key);
            if (frame0) {
                const next = frameCycle > 0 ? this.smoothingTarget(seqType, idx, mv) : undefined;
                if (next) {
                    const alpha = Math.min(1, frameCycle / next.length);
                    model.animateInterpolated(frame0, next.frame, alpha, !!seqType.op14);
                } else {
                    model.animate(frame0, undefined, !!seqType.op14);
                }
                return true;
            }
        }
        return false;
    }

    /**
     * Cycles into the current frame when animation smoothing blends this player's animation
     * toward its next frame, else 0. Only a single keyframe animation is blended (not skeletal
     * ones, which already move every cycle, nor an action layered over movement).
     */
    private smoothingCycle(
        seqId: number,
        overlaySeqId: number | undefined,
        frameCycle: number,
    ): number {
        if (!(frameCycle > 0) || seqId < 0 || overlaySeqId !== undefined) return 0;
        if (!this.renderer.osrsClient.animationSmoothingPlugin?.smoothsPlayer(seqId)) return 0;
        const seqType: any = this.renderer.osrsClient.seqTypeLoader.load(seqId | 0);
        if (!seqType || seqType.isSkeletalSeq?.() || !(seqType.frameIds?.length > 1)) return 0;
        return frameCycle | 0;
    }

    /** The frame after `idx` and the current frame's length; none for the last frame. */
    private smoothingTarget(
        seqType: any,
        idx: number,
        mv: any,
    ): { frame: any; length: number } | undefined {
        const ids = seqType.frameIds as number[];
        if (idx + 1 >= ids.length) return undefined;
        const frame = mv.seqFrameLoader.load(ids[idx + 1] | 0);
        const length = seqType.getFrameLength(mv.seqFrameLoader, idx) | 0;
        return frame && length > 0 ? { frame, length } : undefined;
    }

    private applySequenceTransformationsToModel(
        model: Model,
        baseType: any,
        baseSeqId: number,
        baseFrameIdx: number,
        overlayType: any,
        overlaySeqId: number,
        overlayFrameIdx: number,
        mv: any,
        frameCycle: number = 0,
    ): boolean {
        if (!baseType) return false;
        if (!overlayType) {
            return this.applySingleSequenceToModel(
                model,
                baseType,
                baseSeqId | 0,
                baseFrameIdx | 0,
                mv,
                frameCycle | 0,
            );
        }

        const baseCached = !!baseType.isSkeletalSeq?.();
        const overlayCached = !!overlayType.isSkeletalSeq?.();

        if (baseCached) {
            const baseSkeletal = mv.loaderFactory
                .getSkeletalSeqLoader?.()
                ?.load(baseType.skeletalId);
            if (!baseSkeletal) return false;

            const baseDuration = this.getEffectiveSkeletalDuration(baseType, baseSeqId | 0);
            const baseLocal = Math.max(0, baseFrameIdx | 0) % Math.max(1, baseDuration | 0);
            const baseAnimFrame = baseLocal | 0;

            if (overlayCached) {
                if (!Array.isArray(baseType?.skeletalMasks)) {
                    model.animateSkeletal(baseSkeletal, baseAnimFrame);
                    return true;
                }

                const overlaySkeletal = mv.loaderFactory
                    .getSkeletalSeqLoader?.()
                    ?.load(overlayType.skeletalId);
                if (!overlaySkeletal) {
                    model.animateSkeletal(baseSkeletal, baseAnimFrame);
                    return false;
                }

                const overlayDuration = this.getEffectiveSkeletalDuration(
                    overlayType,
                    overlaySeqId | 0,
                );
                const overlayLocal =
                    Math.max(0, overlayFrameIdx | 0) % Math.max(1, overlayDuration | 0);
                const overlayAnimFrame = overlayLocal | 0;

                model.animateSkeletalComposite(baseSkeletal, baseAnimFrame, {
                    masks: baseType.skeletalMasks,
                    overlay: { seq: overlaySkeletal, frame: overlayAnimFrame },
                });
                return true;
            }

            // Cached base + frame overlay
            if (Array.isArray(baseType?.skeletalMasks)) {
                model.animateSkeletal(baseSkeletal, baseAnimFrame, {
                    masks: baseType.skeletalMasks,
                    maskMatch: false,
                });
            } else {
                model.animateSkeletal(baseSkeletal, baseAnimFrame);
            }

            if (overlayType.frameIds && overlayType.frameIds.length > 0) {
                const ids = overlayType.frameIds as number[];
                const idx = Math.max(0, overlayFrameIdx | 0) % (ids.length | 0);
                const key = ids[idx] | 0;
                const frame0 = mv.seqFrameLoader.load(key);
                if (!frame0) return false;
                const interleave = Array.isArray(baseType?.masks)
                    ? (baseType.masks as number[])
                    : undefined;
                if (interleave && interleave.length > 0) {
                    model.animateInterleavedFrame(frame0, !!overlayType.op14, interleave, true);
                } else {
                    model.animate(frame0, undefined, !!overlayType.op14);
                }
            }
            return true;
        }

        // Frame base
        if (!baseType.frameIds || baseType.frameIds.length <= 0) return false;
        const baseIds = baseType.frameIds as number[];
        const baseIdx = Math.max(0, baseFrameIdx | 0) % (baseIds.length | 0);
        const baseKey = baseIds[baseIdx] | 0;
        const baseFrame0 = mv.seqFrameLoader.load(baseKey);
        if (!baseFrame0) return false;

        const interleave = Array.isArray(baseType?.masks)
            ? (baseType.masks as number[])
            : undefined;

        if (overlayCached) {
            // OSRS: requires an interleave array; otherwise overlay is ignored.
            if (!interleave || interleave.length === 0) {
                model.animate(baseFrame0, undefined, !!baseType.op14);
                return true;
            }

            const overlaySkeletal = mv.loaderFactory
                .getSkeletalSeqLoader?.()
                ?.load(overlayType.skeletalId);
            if (!overlaySkeletal) {
                model.animate(baseFrame0, undefined, !!baseType.op14);
                return false;
            }

            const overlayDuration = this.getEffectiveSkeletalDuration(
                overlayType,
                overlaySeqId | 0,
            );
            const overlayLocal =
                Math.max(0, overlayFrameIdx | 0) % Math.max(1, overlayDuration | 0);
            const overlayAnimFrame = overlayLocal | 0;

            model.animateSkeletal(overlaySkeletal, overlayAnimFrame, {
                masks: Array.isArray(baseType?.skeletalMasks) ? baseType.skeletalMasks : undefined,
                maskMatch: true,
                applyAlpha: false,
            });
            model.animateInterleavedFrame(baseFrame0, !!baseType.op14, interleave, false);
            return true;
        }

        // Frame base + frame overlay
        if (
            !overlayType.frameIds ||
            overlayType.frameIds.length <= 0 ||
            !interleave ||
            interleave.length === 0
        ) {
            model.animate(baseFrame0, undefined, !!baseType.op14);
            return true;
        }

        const overlayIds = overlayType.frameIds as number[];
        const overlayIdx = Math.max(0, overlayFrameIdx | 0) % (overlayIds.length | 0);
        const overlayKey = overlayIds[overlayIdx] | 0;
        const overlayFrame0 = mv.seqFrameLoader.load(overlayKey);
        if (!overlayFrame0) {
            model.animate(baseFrame0, undefined, !!baseType.op14);
            return false;
        }

        model.animateInterleavedFrames(
            baseFrame0,
            !!baseType.op14,
            overlayFrame0,
            !!overlayType.op14,
            interleave,
        );
        return true;
    }

    private dynamicUpdateBuffersFor(
        baseModel: any,
        baseCenterX: number,
        baseCenterZ: number,
        seqId: number,
        frameIdx: number,
        cacheKey?: string,
        pid: number = 0,
        modeHint?: "idle" | "walk" | "run",
        overlaySeqId?: number,
        overlayFrameIdx?: number,
        uploadTarget: "both" | "opaqueOnly" | "alphaOnly" | "cacheOnly" = "both",
        frameCycle: number = 0,
    ): { countOpaque: number; countAlpha: number } {
        const r: any = this.renderer as any;
        if (!r.playerInterleavedBuffer || !r.playerIndexBuffer)
            return { countOpaque: 0, countAlpha: 0 };
        const controlled = this.isControlledPid(pid);
        const uploadOpaque = uploadTarget === "both" || uploadTarget === "opaqueOnly";
        const uploadAlpha = uploadTarget === "both" || uploadTarget === "alphaOnly";
        const opaqueUploadKey = cacheKey && uploadOpaque ? `opaque:${cacheKey}` : undefined;
        const alphaUploadKey = cacheKey && uploadAlpha ? `alpha:${cacheKey}` : undefined;
        // Hit cache
        if (cacheKey) {
            const c = this.geomCache.get(cacheKey);
            if (c) {
                // Keep cache access LRU-ordered (Map preserves insertion order).
                this.geomCache.delete(cacheKey);
                this.geomCache.set(cacheKey, c);
                const cachedOpaqueCount = c.inds.length | 0;
                const cachedAlphaCount = c.indsA.length | 0;
                if (uploadOpaque) {
                    this.ensurePlayerGpuCapacity(c.verts, c.inds);
                    if (this.lastUploadedOpaqueGeomKey !== opaqueUploadKey) {
                        r.playerInterleavedBuffer.data(c.verts);
                        r.playerIndexBuffer.data(c.inds);
                        this.lastUploadedOpaqueGeomKey = opaqueUploadKey;
                    }
                }
                // Update ECS with new counts
                const osrsClient = (r as any).osrsClient;
                if (osrsClient && osrsClient.playerEcs) {
                    const ecsIdx = osrsClient.playerEcs.getIndexForServerId(
                        osrsClient.controlledPlayerServerId,
                    );
                    if (ecsIdx !== undefined) {
                        osrsClient.playerEcs.setModelIndicesCount(ecsIdx, cachedOpaqueCount);
                        osrsClient.playerEcs.setModelIndicesCountAlpha(ecsIdx, cachedAlphaCount);
                        this.dynamicIndicesCount = cachedOpaqueCount;
                        this.dynamicIndicesCountAlpha = cachedAlphaCount;
                    }
                }
                if (uploadAlpha) {
                    this.ensurePlayerGpuCapacityAlpha(c.vertsA, c.indsA);
                    if (this.lastUploadedAlphaGeomKey !== alphaUploadKey) {
                        r.playerInterleavedBufferAlpha?.data(c.vertsA);
                        r.playerIndexBufferAlpha?.data(c.indsA);
                        this.lastUploadedAlphaGeomKey = alphaUploadKey;
                    }
                }
                return {
                    countOpaque: cachedOpaqueCount,
                    countAlpha: cachedAlphaCount,
                };
            }
        }
        const ModelMod = require("../../rs/model/Model").Model;
        // Do not shallow-copy face alpha: sequences (frame-based or skeletal) can mutate faceAlphas via ALPHA transforms.
        // Sharing would leak those mutations back into the cached base model and cause visual artifacts (e.g., "blur"/ghosting).
        let model = ModelMod.copyAnimated(baseModel, false, true);
        let animationApplied = false;
        try {
            const mv = this.renderer.osrsClient as any;
            const seqType = mv.seqTypeLoader.load(seqId | 0);
            const overlayId =
                typeof overlaySeqId === "number" && Number.isFinite(overlaySeqId)
                    ? overlaySeqId | 0
                    : -1;
            const overlayFrame =
                typeof overlayFrameIdx === "number" && Number.isFinite(overlayFrameIdx)
                    ? overlayFrameIdx | 0
                    : -1;

            if (seqType) {
                const overlayType =
                    overlayId >= 0 && overlayFrame >= 0
                        ? mv.seqTypeLoader.load(overlayId | 0)
                        : undefined;
                animationApplied = this.applySequenceTransformationsToModel(
                    model,
                    seqType,
                    seqId | 0,
                    frameIdx | 0,
                    overlayType,
                    overlayId | 0,
                    overlayFrame | 0,
                    mv,
                    frameCycle | 0,
                );
            }
        } catch {}
        try {
            model.calculateBounds();
            const dx = ((baseCenterX | 0) - ((model as any).xMid | 0)) | 0;
            const dz = ((baseCenterZ | 0) - ((model as any).zMid | 0)) | 0;
            if ((dx | dz) !== 0) model.translate(dx, 0, dz);
        } catch {}
        const textureLoader = this.renderer.osrsClient.textureLoader;
        const textureIdIndexMap =
            (this.renderer as any).textureIdIndexMap ?? new Map<number, number>();
        const SceneBufferMod = require("../buffer/SceneBuffer");
        const SceneBufferCls = SceneBufferMod.SceneBuffer;
        const isTrans = SceneBufferMod.isModelFaceTransparent;

        // Local-player perf: cache stable face metadata per base model, then rebuild buckets per frame.
        let facesOpaque: any[];
        let facesAlpha: any[];
        if (controlled) {
            let meta = this.baseModelFaceMetaCache.get(baseModel);
            if (!meta) {
                // Build stable face metadata without per-frame alpha (alpha can be animated).
                const faces: any[] = [];
                const priorities = baseModel.faceRenderPriorities;
                const renderLayers = baseModel.faceRenderLayers;
                for (let index = 0; index < (baseModel.faceCount | 0); index++) {
                    const hslC = baseModel.faceColors3[index];
                    if (hslC === -2) continue;
                    let textureId = -1;
                    if (baseModel.faceTextures) textureId = baseModel.faceTextures[index];
                    let priority = 0;
                    if (priorities) priority = priorities[index];
                    faces.push({
                        index,
                        alpha: 0xff,
                        priority,
                        renderLayer: renderLayers?.[index],
                        textureId,
                    });
                }
                meta = { faces };
                this.baseModelFaceMetaCache.set(baseModel, meta);
            }

            const opaque = this.localFacesOpaque;
            const alpha = this.localFacesAlpha;
            opaque.length = 0;
            alpha.length = 0;

            const faceTransparencies = model.faceAlphas;
            for (let i = 0; i < meta.faces.length; i++) {
                const face = meta.faces[i];
                const idx = face.index | 0;
                // Be conservative: if a color transform changes skip markers, honor current model state.
                if ((model.faceColors3?.[idx] ?? 0) === -2) continue;

                let aVal = 0xff;
                if (faceTransparencies && (face.textureId | 0) === -1) {
                    aVal = 0xff - (faceTransparencies[idx] & 0xff);
                }
                if (aVal === 0) continue;
                face.alpha = aVal;

                if (isTrans(textureLoader, face)) alpha.push(face);
                else opaque.push(face);
            }
            facesOpaque = opaque;
            facesAlpha = alpha;
        } else {
            // Non-local players: keep the simpler path (keeps cached geometry correctness).
            const getFaces = SceneBufferMod.getModelFaces;
            const allFaces = getFaces(model);
            facesOpaque = allFaces.filter((f: any) => !isTrans(textureLoader, f));
            facesAlpha = allFaces.filter((f: any) => isTrans(textureLoader, f));
        }

        const resetSceneBuf = (sb: any) => {
            if (!sb) return;
            try {
                sb.vertexBuf.offset = 0;
                sb.vertexBuf.vertexIndices?.clear?.();
            } catch {}
            try {
                sb.indices.length = 0;
            } catch {}
            try {
                sb.usedTextureIds?.clear?.();
            } catch {}
        };

        const fillScratch = (src: number[], alpha: boolean): Int32Array => {
            const len = src.length | 0;
            if (len <= 0) return this.emptyIndexScratch;
            let scratch = alpha ? this.localIndexScratchAlpha : this.localIndexScratch;
            if (!scratch || scratch.length < len) {
                const next = new Int32Array(Math.max(len, (scratch?.length ?? 0) * 2, 256));
                scratch = next;
                if (alpha) this.localIndexScratchAlpha = scratch;
                else this.localIndexScratch = scratch;
            }
            for (let i = 0; i < len; i++) scratch[i] = src[i] | 0;
            return scratch.subarray(0, len);
        };

        // Build opaque geometry. For local player, reuse SceneBuffer + typed index arrays.
        const actorNormals = buildActorNormals(model, baseModel);
        let vertices: Uint8Array;
        let indices: Int32Array;
        if (controlled) {
            if (!this.localSceneBuf) {
                this.localSceneBuf = new SceneBufferCls(textureLoader, textureIdIndexMap, 0, true);
            }
            resetSceneBuf(this.localSceneBuf);
            if (facesOpaque.length > 0) this.localSceneBuf.addModel(model, facesOpaque, undefined, true, actorNormals);
            vertices = this.localSceneBuf.vertexBuf.byteArray();
            indices = fillScratch(this.localSceneBuf.indices, false);
        } else {
            const sceneBuf = new SceneBufferCls(
                textureLoader,
                textureIdIndexMap,
                model.verticesCount + 16,
                true,
            );
            if (facesOpaque.length > 0) sceneBuf.addModel(model, facesOpaque, undefined, true, actorNormals);
            vertices = sceneBuf.vertexBuf.byteArray();
            indices = new Int32Array(sceneBuf.indices);
        }

        // Ensure GPU buffers have enough capacity. Recreate and rebind VAO if needed.
        if (uploadOpaque) {
            this.ensurePlayerGpuCapacity(vertices, indices);
            if (vertices.byteLength > 0) {
                r.playerInterleavedBuffer.data(vertices);
            }
            if (indices.length > 0) {
                r.playerIndexBuffer.data(indices);
            }
            this.lastUploadedOpaqueGeomKey = opaqueUploadKey;
        }
        r.playerDrawRanges = [newDrawRange(0, indices.length | 0, 1)];
        r.playerDrawRangesAlpha = [newDrawRange(0, 0, 1)];
        r.playerDrawRanges = [newDrawRange(0, indices.length | 0, 1)];
        r.playerDrawRangesAlpha = [newDrawRange(0, 0, 1)];
        // Snapshot opaque geometry before local scratch buffers are potentially reused
        // for alpha geometry generation later in this function.
        const cacheOpaqueVerts =
            cacheKey !== undefined ? new Uint8Array(vertices) : this.emptyVertexScratch;
        const cacheOpaqueInds =
            cacheKey !== undefined ? new Int32Array(indices) : this.emptyIndexScratch;
        // Update ECS with new counts (opaque now, alpha updated after potential alpha build)
        const osrsClient = (r as any).osrsClient;
        if (osrsClient && osrsClient.playerEcs) {
            const ecsIdx = osrsClient.playerEcs.getIndexForServerId(
                osrsClient.controlledPlayerServerId,
            );
            if (ecsIdx !== undefined) {
                const idxCount = Math.max(0, indices.length | 0);
                osrsClient.playerEcs.setModelIndicesCount(ecsIdx, idxCount);
                this.dynamicIndicesCount = idxCount;
                // Alpha count will be set below if we actually built alpha geometry
            }
        }

        // Transparent faces (alpha): build whenever present so wearable details
        // (e.g., wing fins on Primordial/Pegasian boots) render in the player alpha pass.
        let verticesAlpha = this.emptyVertexScratch;
        let indicesAlpha = this.emptyIndexScratch;
        if (facesAlpha.length > 0) {
            if (controlled) {
                if (!this.localSceneBuf) {
                    this.localSceneBuf = new SceneBufferCls(textureLoader, textureIdIndexMap, 0, true);
                }
                resetSceneBuf(this.localSceneBuf);
                this.localSceneBuf.addModel(model, facesAlpha, undefined, true, actorNormals);
                verticesAlpha = this.localSceneBuf.vertexBuf.byteArray();
                indicesAlpha = fillScratch(this.localSceneBuf.indices, true);
            } else {
                const sceneBufA = new SceneBufferCls(
                    textureLoader,
                    textureIdIndexMap,
                    model.verticesCount + 16,
                    true,
                );
                sceneBufA.addModel(model, facesAlpha, undefined, true, actorNormals);
                verticesAlpha = sceneBufA.vertexBuf.byteArray();
                indicesAlpha = new Int32Array(sceneBufA.indices);
            }
            if (uploadAlpha) {
                this.ensurePlayerGpuCapacityAlpha(verticesAlpha, indicesAlpha);
                r.playerInterleavedBufferAlpha?.data(verticesAlpha);
                r.playerIndexBufferAlpha?.data(indicesAlpha);
                this.lastUploadedAlphaGeomKey = alphaUploadKey;
            }
            // Update ECS and local counters for alpha counts
            try {
                const mvAny: any = (this.renderer as any).osrsClient;
                const ecsIdx = mvAny?.playerEcs?.getIndexForServerId?.(
                    mvAny?.controlledPlayerServerId,
                );
                if (ecsIdx !== undefined) {
                    mvAny.playerEcs.setModelIndicesCountAlpha(ecsIdx, indicesAlpha.length | 0);
                }
            } catch {}
            this.dynamicIndicesCountAlpha = indicesAlpha.length | 0;
        } else {
            if (uploadAlpha) {
                if (this.lastUploadedAlphaGeomKey !== alphaUploadKey) {
                    r.playerInterleavedBufferAlpha?.data(verticesAlpha);
                    r.playerIndexBufferAlpha?.data(indicesAlpha);
                    this.lastUploadedAlphaGeomKey = alphaUploadKey;
                }
            }
            this.dynamicIndicesCountAlpha = 0;
        }

        const result = {
            countOpaque: indices.length | 0,
            countAlpha: indicesAlpha.length | 0,
        };
        try {
            if (cacheKey && (animationApplied || seqId < 0)) {
                const cacheAlphaVerts = new Uint8Array(verticesAlpha);
                const cacheAlphaInds = new Int32Array(indicesAlpha);
                this.geomCache.set(cacheKey, {
                    verts: cacheOpaqueVerts,
                    inds: cacheOpaqueInds,
                    vertsA: cacheAlphaVerts,
                    indsA: cacheAlphaInds,
                });
                while (this.geomCache.size > PlayerRenderer.GEOM_CACHE_MAX_ENTRIES) {
                    const oldest = this.geomCache.keys().next().value as string | undefined;
                    if (oldest === undefined) break;
                    this.geomCache.delete(oldest);
                }
            }
        } catch {}
        return result;
    }

    private ensurePlayerGpuCapacity(vertexData: Uint8Array, indexData: Int32Array): void {
        const r: any = this.renderer as any;
        const app = r.app;
        const vao = r.playerVertexArray;
        if (!app || !vao) return;

        // Track current capacities on renderer instance
        const vbCap = Math.max(0, r.playerInterleavedBuffer?.byteLength ?? 0);
        const ibCap = Math.max(0, Math.floor((r.playerIndexBuffer?.byteLength ?? 0) / 4));

        const vertexBytes = vertexData.byteLength | 0;
        const indexCount = indexData.length | 0;
        const needGrowVB = vertexBytes > vbCap;
        const needGrowIB = indexCount > ibCap;

        // Growth policy: next power-of-two for headroom to reduce churn
        const nextPow2 = (v: number) => {
            let n = 1;
            while (n < Math.max(1, v)) n <<= 1;
            return n;
        };

        const strideBytes = ACTOR_VERTEX_STRIDE;

        if (needGrowVB) {
            const oldBuf = r.playerInterleavedBuffer;
            const requiredBytes = Math.max(strideBytes, vertexBytes);
            const pow2Bytes = nextPow2(requiredBytes);
            const capBytes = Math.ceil(pow2Bytes / strideBytes) * strideBytes;
            const newBuf = app.createInterleavedBuffer(strideBytes, capBytes);
            // Rebind VAO attribute 0 to new buffer
            r.playerVertexArray = vao.vertexAttributeBuffer(0, newBuf, {
                type: PicoGL.UNSIGNED_INT,
                size: 4,
                stride: strideBytes,
                integer: true as any,
            });
            r.playerInterleavedBuffer = newBuf;
            oldBuf?.delete();
            this.interleavedBuffer = newBuf;
            this.lastUploadedOpaqueGeomKey = undefined;
            // Recreate opaque draw call to ensure it references updated VAO (defensive)
            if (r.playerProgramOpaque || r.playerProgram) {
                r.playerDrawCall = app
                    .createDrawCall(r.playerProgramOpaque ?? r.playerProgram, r.playerVertexArray)
                    .uniformBlock("SceneUniforms", r.sceneUniformBuffer)
                    .uniform("u_timeLoaded", -1.0)
                    .uniform("u_usePlayerSlotAttribute", false)
                    .texture("u_textures", r.textureArray)
                    .texture("u_textureMaterials", r.textureMaterials)
            .texture("u_poseTexture", r.playerPoseTexture);
                // Keep alpha draw call bound to the dedicated alpha VAO; see ensurePlayerGpuCapacityAlpha().
                this.drawCall = r.playerDrawCall;
            }
        }

        if (needGrowIB) {
            const oldBuf = r.playerIndexBuffer;
            const newElems = nextPow2(indexCount);
            const initData = new Int32Array(newElems);
            const newBuf = app.createIndexBuffer(PicoGL.UNSIGNED_INT as number, initData);
            r.playerVertexArray = r.playerVertexArray.indexBuffer(newBuf);
            r.playerIndexBuffer = newBuf;
            oldBuf?.delete();
            this.indexBuffer = newBuf;
            this.lastUploadedOpaqueGeomKey = undefined;
            // Recreate opaque draw call to ensure it references updated VAO (defensive)
            if (r.playerProgramOpaque || r.playerProgram) {
                r.playerDrawCall = app
                    .createDrawCall(r.playerProgramOpaque ?? r.playerProgram, r.playerVertexArray)
                    .uniformBlock("SceneUniforms", r.sceneUniformBuffer)
                    .uniform("u_timeLoaded", -1.0)
                    .uniform("u_usePlayerSlotAttribute", false)
                    .texture("u_textures", r.textureArray)
                    .texture("u_textureMaterials", r.textureMaterials)
            .texture("u_poseTexture", r.playerPoseTexture);
                // Keep alpha draw call bound to the dedicated alpha VAO; see ensurePlayerGpuCapacityAlpha().
                this.drawCall = r.playerDrawCall;
            }
        }
    }

    // Ensure alpha buffers/VAO/drawcall have enough capacity when we render
    // dynamic player geometry via the transparent pass (rare; e.g., fishing skillcape emote).
    private ensurePlayerGpuCapacityAlpha(vertexData: Uint8Array, indexData: Int32Array): void {
        const r: any = this.renderer as any;
        const app = r.app;
        const vao = r.playerVertexArrayAlpha;
        if (!app || !vao) return;

        const vbCap = Math.max(0, r.playerInterleavedBufferAlpha?.byteLength ?? 0);
        const ibCap = Math.max(0, Math.floor((r.playerIndexBufferAlpha?.byteLength ?? 0) / 4));

        const vertexBytes = vertexData.byteLength | 0;
        const indexCount = indexData.length | 0;
        const needGrowVB = vertexBytes > vbCap;
        const needGrowIB = indexCount > ibCap;

        const nextPow2 = (v: number) => {
            let n = 1;
            while (n < Math.max(1, v)) n <<= 1;
            return n;
        };
        const strideBytes = ACTOR_VERTEX_STRIDE;

        if (needGrowVB) {
            const oldBuf = r.playerInterleavedBufferAlpha;
            const requiredBytes = Math.max(strideBytes, vertexBytes);
            const pow2Bytes = nextPow2(requiredBytes);
            const capBytes = Math.ceil(pow2Bytes / strideBytes) * strideBytes;
            const newBuf = app.createInterleavedBuffer(strideBytes, capBytes);
            r.playerVertexArrayAlpha = vao.vertexAttributeBuffer(0, newBuf, {
                type: PicoGL.UNSIGNED_INT,
                size: 4,
                stride: strideBytes,
                integer: true as any,
            });
            r.playerInterleavedBufferAlpha = newBuf;
            oldBuf?.delete();
            this.lastUploadedAlphaGeomKey = undefined;
            if (r.playerProgram) {
                r.playerDrawCallAlpha = app
                    .createDrawCall(r.playerProgram, r.playerVertexArrayAlpha)
                    .uniformBlock("SceneUniforms", r.sceneUniformBuffer)
                    .uniform("u_timeLoaded", -1.0)
                    .uniform("u_usePlayerSlotAttribute", false)
                    .texture("u_textures", r.textureArray)
                    .texture("u_textureMaterials", r.textureMaterials)
            .texture("u_poseTexture", r.playerPoseTexture);
                this.drawCallAlpha = r.playerDrawCallAlpha;
            }
        }

        if (needGrowIB) {
            const oldBuf = r.playerIndexBufferAlpha;
            const newElems = nextPow2(indexCount);
            const initData = new Int32Array(newElems);
            const newBuf = app.createIndexBuffer(PicoGL.UNSIGNED_INT as number, initData);
            r.playerVertexArrayAlpha = r.playerVertexArrayAlpha.indexBuffer(newBuf);
            r.playerIndexBufferAlpha = newBuf;
            oldBuf?.delete();
            this.lastUploadedAlphaGeomKey = undefined;
            if (r.playerProgram) {
                r.playerDrawCallAlpha = app
                    .createDrawCall(r.playerProgram, r.playerVertexArrayAlpha)
                    .uniformBlock("SceneUniforms", r.sceneUniformBuffer)
                    .uniform("u_timeLoaded", -1.0)
                    .uniform("u_usePlayerSlotAttribute", false)
                    .texture("u_textures", r.textureArray)
                    .texture("u_textureMaterials", r.textureMaterials)
            .texture("u_poseTexture", r.playerPoseTexture);
                this.drawCallAlpha = r.playerDrawCallAlpha;
            }
        }
    }

    private captureCurrentVariant(): {
        drawCall: DrawCall;
        drawCallAlpha?: DrawCall;
        frames: DrawRange[];
        framesAlpha?: DrawRange[];
        frameCount: number;
        frameLengths?: number[];
        frameHeightsTiles?: number[];
        isSkeletal: boolean;
    } {
        const r: any = this.renderer as any;
        const frameCount = r.playerFrameCount | 0 || r.playerDynamicFrameCount | 0 || 1;
        const frameLengths =
            r.playerFrameLengths?.slice?.() || r.playerDynamicFrameLengths?.slice?.();
        const frameHeightsTiles = undefined; // Removed from renderer
        const isSkeletal = !!(r.playerIsSkeletal || r.playerDynamicIsSkeletal);
        return {
            drawCall: r.playerDrawCall,
            drawCallAlpha: r.playerDrawCallAlpha,
            frames: r.playerDrawRanges || [],
            framesAlpha: r.playerDrawRangesAlpha,
            frameCount,
            frameLengths,
            frameHeightsTiles,
            isSkeletal,
        };
    }

    private getVariantFor(mode: "idle" | "walk" | "run", playerId: number) {
        // Universal variant lookup based on player ID
        const key = `player:${playerId}:${mode}`;
        return (
            this.variantCache.get(key) ||
            this.variantCache.get(`player:${playerId}:walk`) ||
            this.variantCache.get(`player:${playerId}:idle`) ||
            // Fallback to generic mode variants
            this.variantCache.get(mode) ||
            this.variantCache.get("walk") ||
            this.variantCache.get("idle")
        );
    }

    private getVariantForBot(mode: "idle" | "walk" | "run", playerId: number) {
        return (
            this.variantCache.get(`bot:${playerId}:${mode}`) ||
            this.variantCache.get(`bot:${playerId}:walk`) ||
            this.variantCache.get(`bot:${playerId}:idle`) ||
            this.getVariantFor(mode, playerId)
        );
    }

    private getVariantForAppearance(
        mode: "idle" | "walk" | "run",
        playerId: number,
        app?: PlayerAppearance,
    ) {
        if (!app) return this.getVariantForBot(mode, playerId);
        try {
            const cacheKey =
                app.getCacheKey?.() ??
                `${app.getHash?.().toString() ?? "0"}|${
                    app.getEquipKey?.() ?? app.equip.slice(0, 14).join(",")
                }`;
            const vKey = `player:${playerId}:${cacheKey}:${mode}`;
            return (
                this.variantCache.get(vKey) ||
                // fallbacks within same appearance
                this.variantCache.get(`player:${playerId}:${cacheKey}:walk`) ||
                this.variantCache.get(`player:${playerId}:${cacheKey}:idle`) ||
                // fall back to bot variant if appearance not cached
                this.getVariantForBot(mode, playerId)
            );
        } catch {
            return this.getVariantForBot(mode, playerId);
        }
    }

    getFrameCount(): number {
        return this.frameCount | 0;
    }
    getFrameLengths(): number[] | undefined {
        return this.frameLengths;
    }
    getFrameHeights(): number[] | undefined {
        return this.frameHeightsTiles;
    }
    getDefaultHeightTiles(): number {
        return this.defaultHeightTiles;
    }
    getDynamicIndicesCount(): number {
        return this.dynamicIndicesCount | 0;
    }
    getDynamicIndicesCountAlpha(): number {
        return this.dynamicIndicesCountAlpha | 0;
    }
    getInterleavedBuffer(): any {
        return this.interleavedBuffer;
    }
    getIndexBuffer(): any {
        return this.indexBuffer;
    }

    /**
     * Append player instance data for a given map into the unified actor buffer
     * and write the map's data texture offset for this frame's ring slot.
     */
    addPlayerRenderData(map: WebGLMapSquare): void {
        const r = this.renderer;
        const playerEcs = r.osrsClient.playerEcs;
        const n = playerEcs.size?.() ?? (playerEcs as any).size?.() ?? 0;
        if (!n) return;

        // Always use slot 0 for double-buffered actor data
        const sampleIdx = 0;

        const baseOffset = r.actorRenderCount;
        // Write offset for the ring slot we will sample during this frame's draw
        map.playerDataTextureOffsets[sampleIdx] = baseOffset;

        const mapBaseTileX = map.getRenderBaseTileX();
        const mapBaseTileY = map.getRenderBaseTileY();
        const mapTileSpan = map.getLocalTileSpan();

        // Append only players selected for this map for this frame (matches draw path exactly).
        const renderPlayers = this.getRenderPlayersForMap(map);
        let indexInMap = 0;
        for (let k = 0; k < renderPlayers.length; k++) {
            const i = renderPlayers[k] | 0;
            const px = playerEcs.getX(i) | 0;
            const py = playerEcs.getY(i) | 0;
            const tileX = (px / 128) | 0;
            const tileY = (py / 128) | 0;

            // Ensure capacity (8 uint16 per actor = 2 texels)
            if (r.unifiedActorData) {
                const newCount = r.actorRenderCount + 1;
                if (r.actorRenderData.length / 8 < newCount) {
                    const newData = new Uint16Array(Math.ceil((newCount * 2) / 16) * 16 * 8);
                    newData.set(r.actorRenderData);
                    r.actorRenderData = newData;
                }
            }

            const localTileX = tileX - mapBaseTileX;
            const localTileY = tileY - mapBaseTileY;

            const tx = clamp(localTileX, 0, Math.max(0, mapTileSpan - 1));
            const ty = clamp(localTileY, 0, Math.max(0, mapTileSpan - 1));
            const renderPlane = resolveHeightSamplePlaneForLocal(
                map,
                playerEcs.getLevel(i) | 0,
                tx,
                ty,
            );

            // actor positions advance on client cycles; do not render-time interpolate.
            const localX = (px - mapBaseTileX * 128) | 0;
            const localY = (py - mapBaseTileY * 128) | 0;
            // Apply yaw bias so model forward aligns with OSRS orientation
            const rot =
                (playerEcs.getRotation(i) + ((r as any).playerRotationBiasUnits ?? 0)) & 2047;

            if (r.unifiedActorData) {
                const offset = r.actorRenderCount * 8;
                // Texel 0: position, plane|rotation, interactionId
                r.actorRenderData[offset + 0] = localX;
                r.actorRenderData[offset + 1] = localY;
                r.actorRenderData[offset + 2] = renderPlane | (rot << 2);
                r.actorRenderData[offset + 3] = PLAYER_INTERACT_BASE + (indexInMap & 0x7fff);
                // Texel 1: per-actor HSL override
                // Pack: R = hue(7) | sat(7) << 7, G = lum(7) | amount(8) << 7
                const override = playerEcs.getColorOverride(i);
                const clientCycle = (r.osrsClient as any).clientCycle | 0;
                if (
                    override.amount !== 0 &&
                    clientCycle >= override.startCycle &&
                    clientCycle < override.endCycle
                ) {
                    r.actorRenderData[offset + 4] =
                        (override.hue & 0x7f) | ((override.sat & 0x7f) << 7);
                    r.actorRenderData[offset + 5] =
                        (override.lum & 0x7f) | ((override.amount & 0xff) << 7);
                } else {
                    r.actorRenderData[offset + 4] = 0;
                    r.actorRenderData[offset + 5] = 0;
                }
                r.actorRenderData[offset + 6] = 0;
                r.actorRenderData[offset + 7] = 0;
                r.actorRenderCount++;
            }
            indexInMap++;
        }
    }

    /**
     * Render opaque player geometry for a single map using unified actor texture data.
     */
    renderOpaqueForMap(
        map: WebGLMapSquare,
        actorDataTextureIndex: number,
        actorDataTexture: Texture | undefined,
    ): void {
        const r = this.renderer;
        if (!actorDataTexture) return;
        if (!this.drawCall || !this.drawRanges) return;

        const baseOffsetPlayer = map.playerDataTextureOffsets[actorDataTextureIndex];
        if (baseOffsetPlayer === -1) return;

        // Determine players selected for this map this frame (same set used by actor data upload).
        const pe = r.osrsClient.playerEcs;
        const playerIndices = this.getRenderPlayersForMap(map);
        if (playerIndices.length === 0) return;
        const activePlayerCount = pe.getActiveCount();
        const combatTargetPid = r.getCombatTargetPlayerEcsIndex();

        // Clear batch groups for this frame
        this.batchGroups.clear();

        // Reuse the slot buffer.
        const slots = this.slotsBuffer;
        if (slots.length < playerIndices.length) {
            slots.length = playerIndices.length;
        }
        // Compute slot indices (order within this map) while building the player list
        let slotCounter = 0;
        for (let j = 0; j < playerIndices.length; j++) {
            slots[j] = slotCounter++;
        }

        // Group players by appearance and animation state for batching
        for (let j = 0; j < playerIndices.length; j++) {
            const pid = playerIndices[j] | 0;
            const slot = slots[j] | 0;
            const peInst = r.osrsClient.playerEcs;
            const px = peInst.getX(pid) | 0;
            const py = peInst.getY(pid) | 0;
            const plane = peInst.getLevel(pid) | 0;
            const moving = !!(peInst as any).isMoving?.(pid);
            const wantsRun = !!(
                (peInst as any).isRunVisual?.(pid) || (peInst as any).isRunning?.(pid)
            );
            const mode: "idle" | "walk" | "run" = moving ? (wantsRun ? "run" : "walk") : "idle";
            // Action `sequence` (server-authored). Movement uses `movementSequence` separately.
            const actionSeqId = peInst.getAnimSeqId(pid) | 0;
            const movementSeqId = peInst.getAnimMovementSeqId(pid) | 0;
            const idleSeqId = peInst.getAnimSeq(pid, "idle") | 0;

            const actionDelay = (peInst.getAnimSeqDelay?.(pid) ?? 0) | 0;
            const actionActive = actionSeqId >= 0 && actionDelay === 0;
            const forcedSeq = this.resolveControlledIdleSeqOverride(pid | 0);
            const useActionSequence = forcedSeq === undefined && actionActive;
            const unanimatedIdle = shouldUseUnanimatedIdlePlayer(
                activePlayerCount,
                this.canBatchPlayer(pid, peInst) && (pid | 0) !== (combatTargetPid ?? -1),
                moving,
                actionActive,
                movementSeqId,
                idleSeqId,
            );

            let movementFrameIdx = 0;
            let actionFrameIdx = 0;
            let movementFrameCycle = 0;
            let actionFrameCycle = 0;
            if (!unanimatedIdle) {
                const controller = this.renderer.osrsClient.playerAnimController;
                const serverId = this.renderer.osrsClient.playerEcs.getServerIdForIndex(pid);
                if (controller && serverId !== undefined) {
                    const movementState = controller.getMovementSequenceState(serverId);
                    const actionState = controller.getSequenceState(serverId);
                    movementFrameIdx = (movementState?.frame ?? 0) | 0;
                    actionFrameIdx = (actionState?.frame ?? 0) | 0;
                    movementFrameCycle = (movementState?.frameCycle ?? 0) | 0;
                    actionFrameCycle = (actionState?.frameCycle ?? 0) | 0;
                }
            }

            if (!forcedSeq && !actionActive && (movementSeqId | 0) < 0) continue;

            let seqId =
                unanimatedIdle
                    ? -1
                    : forcedSeq !== undefined
                    ? forcedSeq.seqId | 0
                    : useActionSequence
                      ? actionSeqId | 0
                      : movementSeqId | 0;
            let frameIdx =
                unanimatedIdle
                    ? 0
                    : forcedSeq !== undefined
                    ? forcedSeq.frameIdx | 0
                    : useActionSequence
                      ? actionFrameIdx | 0
                      : movementFrameIdx | 0;
            let overlaySeqId: number | undefined;
            let overlayFrameIdx: number | undefined;
            if (useActionSequence) {
                let canLayer = false;
                try {
                    const st = this.renderer.osrsClient.seqTypeLoader.load(actionSeqId | 0) as any;
                    if (st?.isSkeletalSeq?.()) canLayer = Array.isArray(st.skeletalMasks);
                    else canLayer = Array.isArray(st?.masks) && st.masks.length > 0;
                } catch {}
                if (
                    canLayer &&
                    (movementSeqId | 0) >= 0 &&
                    (movementSeqId | 0) !== (idleSeqId | 0)
                ) {
                    overlaySeqId = movementSeqId | 0;
                    overlayFrameIdx = movementFrameIdx | 0;
                }
            }

            // Frame sounds: mirror server-driven movement/action unless a local debug override is active.
            if (!forcedSeq && !unanimatedIdle && (movementSeqId | 0) >= 0) {
                this.emitPlayerFrameSound(
                    pid | 0,
                    movementSeqId | 0,
                    movementFrameIdx | 0,
                    px | 0,
                    py | 0,
                    plane | 0,
                    this.isControlledPid(pid),
                    "movement",
                );
            }
            if (useActionSequence) {
                this.emitPlayerFrameSound(
                    pid | 0,
                    actionSeqId | 0,
                    actionFrameIdx | 0,
                    px | 0,
                    py | 0,
                    plane | 0,
                    this.isControlledPid(pid),
                    "action",
                );
            }

            // Debug logging moved to tickPass to avoid duplicate logs during rendering

            // Appearance is not required for logging, but is required for batching/rendering
            const app = this.renderer.osrsClient.playerEcs.getAppearance(pid);
            if (!app) continue;

            let effectiveApp = app;
            if (useActionSequence && (app.npcTransformationId ?? -1) < 0) {
                try {
                    const seqType = this.renderer.osrsClient.seqTypeLoader.load(actionSeqId | 0);
                    if (seqType && (seqType.leftHandItem >= 0 || seqType.rightHandItem >= 0)) {
                        const newEquip = app.equip.slice();
                        // OSRS cache SeqType stores item IDs with 512 offset (0x200) for equipment overrides.
                        // We must strip this offset to get the actual Item ID for our loader.
                        let shield = seqType.leftHandItem;
                        let weapon = seqType.rightHandItem;
                        if (shield >= 512) shield -= 512;
                        if (weapon >= 512) weapon -= 512;

                        if (shield >= 0) newEquip[EquipmentSlot.SHIELD] = shield;
                        if (weapon >= 0) newEquip[EquipmentSlot.WEAPON] = weapon;
                        effectiveApp = new PlayerAppearance(
                            app.gender,
                            app.colors,
                            app.kits,
                            newEquip,
                            app.headIcons,
                        );
                    }
                } catch {}
            }
            const serverId = peInst.getServerIdForIndex(pid);
            if (serverId === undefined) continue;
            effectiveApp = this.getFirstPersonAppearance(pid, effectiveApp);
            const renderableAppearance = this.resolveRenderableAppearance(serverId, effectiveApp);
            if (!renderableAppearance) continue;
            effectiveApp = renderableAppearance;

            // Create batch key from appearance hash, sequence ID, and frame index
            const appKey =
                effectiveApp.getCacheKey?.() ??
                `${effectiveApp.getHash?.().toString() ?? "0"}|${
                    effectiveApp.getEquipKey?.() ?? effectiveApp.equip.slice(0, 14).join(",")
                }`;
            const overlayKey =
                typeof overlaySeqId === "number" && typeof overlayFrameIdx === "number"
                    ? `|${overlaySeqId | 0}|${overlayFrameIdx | 0}`
                    : "";
            const frameCycle =
                forcedSeq !== undefined || unanimatedIdle
                    ? 0
                    : this.smoothingCycle(
                          seqId,
                          overlaySeqId,
                          useActionSequence ? actionFrameCycle : movementFrameCycle,
                      );
            const cycleKey = frameCycle > 0 ? `~${frameCycle}` : "";
            const batchKey = `${appKey}|${seqId}|${frameIdx}${cycleKey}${overlayKey}`;

            // Add player to batch group
            let group = this.batchGroups.get(batchKey);
            if (!group) {
                group = {
                    appearance: effectiveApp,
                    seqId: seqId | 0,
                    frameIdx: frameIdx | 0,
                    frameCycle,
                    overlaySeqId: overlaySeqId,
                    overlayFrameIdx: overlayFrameIdx,
                    instances: [],
                };
                this.batchGroups.set(batchKey, group);
            }
            group.instances.push({ slot, pid, mode });
        }

        // Batched rendering: process each batch group through the active draw backend.
        const draw = r.configureDrawCall(this.drawCall as any as DrawCall);
        const playerEcs = r.osrsClient?.playerEcs;
        const playerDeckH = r.getWorldEntityDeckHeight(0, 0);
        const playerMapPos = vec2.fromValues(map.renderPosX, map.renderPosY);
        draw.uniform("u_mapPos", playerMapPos)
            .uniform("u_npcDataOffset", baseOffsetPlayer)
            .uniform("u_modelYOffset", r.playerYOffset)
            .uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4)
            .texture("u_npcDataTexture", actorDataTexture)
            .texture("u_heightMap", map.heightMapTexture)
            .uniform("u_sceneBorderSize", map.borderSize);

        // Player models use the same winding as terrain/NPC geometry. Respect
        // the renderer's culling setting here; rendering both sides exposes
        // internal leg faces as dark triangles when a player is lifted above
        // the floor.
        if (r.cullBackFace) r.app.enable(PicoGL.CULL_FACE);
        else r.app.disable(PicoGL.CULL_FACE);

        const poses = this.preparePoses(this.batchGroups);

        // Process each batch group
        for (const [batchKey, group] of this.batchGroups) {
            // The first-person camera can look at the reverse side of an arm,
            // weapon, or shield face. Those pieces must be double-sided; normal
            // player models retain back-face culling to avoid visible internals.
            if (group.appearance.firstPersonArmsOnly) r.app.disable(PicoGL.CULL_FACE);
            else if (r.cullBackFace) r.app.enable(PicoGL.CULL_FACE);
            else r.app.disable(PicoGL.CULL_FACE);
            if (group.instances.length === 0) continue;

            const baseRec = this.ensureBaseForAppearance(group.appearance);
            if (!baseRec) continue;

            // Players in the same group share appearance and animation geometry. Upload it once,
            // while retaining one instance per actor slot for exact placement.
            slots.length = 0;
            let batchSource: (typeof group.instances)[number] | undefined;
            for (const inst of group.instances) {
                if (this.canBatchPlayer(inst.pid, playerEcs)) {
                    batchSource ??= inst;
                    slots.push(inst.slot | 0);
                }
            }

            if (batchSource) {
                const posed = poses.get(batchKey);
                let gpuGeometry = posed?.geometry ?? this.getPlayerGpuGeometry(batchKey);
                if (!gpuGeometry) {
                    this.dynamicUpdateBuffersFor(
                        baseRec.baseModel,
                        baseRec.baseCenterX,
                        baseRec.baseCenterZ,
                        group.seqId,
                        group.frameIdx,
                        batchKey,
                        batchSource.pid,
                        batchSource.mode,
                        group.overlaySeqId,
                        group.overlayFrameIdx,
                        "cacheOnly",
                        group.frameCycle,
                    );
                    gpuGeometry = this.getPlayerGpuGeometry(batchKey);
                }
                const counts = gpuGeometry
                    ? {
                          countOpaque: gpuGeometry.opaque?.count ?? 0,
                          countAlpha: gpuGeometry.alpha?.count ?? 0,
                      }
                    : this.dynamicUpdateBuffersFor(
                          baseRec.baseModel,
                          baseRec.baseCenterX,
                          baseRec.baseCenterZ,
                          group.seqId,
                          group.frameIdx,
                          batchKey,
                          batchSource.pid,
                          batchSource.mode,
                          group.overlaySeqId,
                          group.overlayFrameIdx,
                          "opaqueOnly",
                          group.frameCycle,
                      );
                for (const inst of group.instances) {
                    if (this.canBatchPlayer(inst.pid, playerEcs)) {
                        this.framePlayerAlphaCounts.set(inst.pid | 0, counts.countAlpha | 0);
                    }
                }
                if ((counts.countOpaque | 0) > 0) {
                    const playerDraw = gpuGeometry?.opaque
                        ? r
                              .configureDrawCall(gpuGeometry.opaque.drawCall)
                              .uniform("u_mapPos", playerMapPos)
                              .uniform("u_npcDataOffset", baseOffsetPlayer)
                              .uniform("u_modelYOffset", r.playerYOffset)
                              .uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4)
                              .texture("u_npcDataTexture", actorDataTexture)
                              .texture("u_heightMap", map.heightMapTexture)
                              .uniform("u_sceneBorderSize", map.borderSize)
                        : draw;
                    if (posed) {
                        playerDraw.uniform("u_poseRow", posed.row);
                    }
                    drawPlayerSlots(
                        playerDraw,
                        r.playerSlotBuffer!,
                        this.playerSlotScratch,
                        slots,
                        counts.countOpaque | 0,
                    );
                }
            }

            for (const inst of group.instances) {
                if (batchSource && this.canBatchPlayer(inst.pid, playerEcs)) {
                    continue;
                }
                const counts = this.dynamicUpdateBuffersFor(
                    baseRec.baseModel,
                    baseRec.baseCenterX,
                    baseRec.baseCenterZ,
                    group.seqId,
                    group.frameIdx,
                    batchKey,
                    inst.pid,
                    inst.mode,
                    group.overlaySeqId,
                    group.overlayFrameIdx,
                    "opaqueOnly",
                    group.frameCycle,
                );
                this.framePlayerAlphaCounts.set(inst.pid | 0, counts.countAlpha | 0);

                // Per-player WorldView: apply deck height + bobbing transform
                // inst.pid is the ECS index directly (from playerIndices)
                const wvId = playerEcs?.getWorldViewId?.(inst.pid) ?? -1;
                if (wvId >= 0) {
                    const weTransform =
                        r.worldEntityAnimator?.getTransform(wvId) ?? WebGLMapSquare.IDENTITY_MAT4;
                    draw.uniform("u_modelYOffset", r.playerYOffset + playerDeckH).uniform(
                        "u_worldEntityTransform",
                        weTransform,
                    );
                }

                // Use drawIdOverride since gl_DrawID will be 0 for single-range draws
                draw.uniform("u_drawIdOverride", inst.slot | 0);
                (draw as any).drawRanges([0, counts.countOpaque | 0, 1]);
                draw.draw();

                // Restore overworld uniforms after WE player draw
                if (wvId >= 0) {
                    draw.uniform("u_modelYOffset", r.playerYOffset).uniform(
                        "u_worldEntityTransform",
                        WebGLMapSquare.IDENTITY_MAT4,
                    );
                }
            }
            draw.uniform("u_drawIdOverride", -1); // Reset
        }
        if (r.cullBackFace) r.app.enable(PicoGL.CULL_FACE);
    }

    /**
     * Transparent player pass (alpha faces). Disabled when using dynamic player anim.
     */
    renderTransparentPlayerPass(
        playerDataTextureIndex: number,
        playerDataTexture: Texture | undefined,
    ): void {
        const r = this.renderer;
        if (!playerDataTexture || !this.drawCallAlpha || !this.drawRangesAlpha) {
            return;
        }
        const drawCallAlpha = this.drawCallAlpha as DrawCall;
        const tex = playerDataTexture as Texture;

        // Use dynamic alpha geometry when enabled, otherwise cycle pre-baked alpha ranges
        const frameId = 0; // unused in variant path

        for (let i = 0; i < r.mapManager.visibleMapCount; i++) {
            const map = r.mapManager.visibleMaps[i];
            const baseOffset = map.playerDataTextureOffsets[playerDataTextureIndex];
            if (baseOffset === -1) continue;

            const pe = r.osrsClient.playerEcs;
            const playerIndices = this.getRenderPlayersForMap(map);
            if (playerIndices.length === 0) continue;
            const activePlayerCount = pe.getActiveCount();
            const combatTargetPid = r.getCombatTargetPlayerEcsIndex();

            // PERF: Clear and reuse cached batch groups Map to avoid per-frame allocation
            this.alphaBatchGroups.clear();
            const alphaBatchGroups = this.alphaBatchGroups;

            // PERF: Reuse slots buffer instead of creating new array
            const slots = this.slotsBuffer;
            slots.length = playerIndices.length;
            let slotCounter = 0;
            for (let j = 0; j < playerIndices.length; j++) slots[j] = slotCounter++;

            // Group players by appearance and animation for alpha pass
            for (let j = 0; j < playerIndices.length; j++) {
                const pid = playerIndices[j] | 0;
                const cachedAlphaCount = this.framePlayerAlphaCounts.get(pid);
                if (cachedAlphaCount !== undefined && (cachedAlphaCount | 0) <= 0) {
                    continue;
                }
                const slot = slots[j] | 0;
                const moving = !!(r.osrsClient.playerEcs as any).isMoving?.(pid);
                const wantsRun = !!(
                    (r.osrsClient.playerEcs as any).isRunVisual?.(pid) ||
                    (r.osrsClient.playerEcs as any).isRunning?.(pid)
                );
                const mode: "idle" | "walk" | "run" = moving ? (wantsRun ? "run" : "walk") : "idle";
                const app = this.renderer.osrsClient.playerEcs.getAppearance(pid);
                if (!app) continue;

                const peInst = r.osrsClient.playerEcs;
                const actionSeqId = peInst.getAnimSeqId(pid) | 0;
                const movementSeqId = peInst.getAnimMovementSeqId(pid) | 0;
                const idleSeqId = peInst.getAnimSeq(pid, "idle") | 0;

                const actionDelay = (pe.getAnimSeqDelay?.(pid) ?? 0) | 0;
                const actionActive = actionSeqId >= 0 && actionDelay === 0;
                const forcedSeq = this.resolveControlledIdleSeqOverride(pid | 0);
                const useActionSequence = forcedSeq === undefined && actionActive;
                const unanimatedIdle = shouldUseUnanimatedIdlePlayer(
                    activePlayerCount,
                    this.canBatchPlayer(pid, peInst) && (pid | 0) !== (combatTargetPid ?? -1),
                    moving,
                    actionActive,
                    movementSeqId,
                    idleSeqId,
                );

                let movementFrameIdx = 0;
                let actionFrameIdx = 0;
                let movementFrameCycle = 0;
                let actionFrameCycle = 0;
                if (!unanimatedIdle) {
                    const controller = this.renderer.osrsClient.playerAnimController;
                    const serverId = this.renderer.osrsClient.playerEcs.getServerIdForIndex(pid);
                    if (controller && serverId !== undefined) {
                        const movementState = controller.getMovementSequenceState(serverId);
                        const actionState = controller.getSequenceState(serverId);
                        movementFrameIdx = (movementState?.frame ?? 0) | 0;
                        actionFrameIdx = (actionState?.frame ?? 0) | 0;
                        movementFrameCycle = (movementState?.frameCycle ?? 0) | 0;
                        actionFrameCycle = (actionState?.frameCycle ?? 0) | 0;
                    }
                }

                if (!forcedSeq && !actionActive && (movementSeqId | 0) < 0) continue;

                let seqId =
                    unanimatedIdle
                        ? -1
                        : forcedSeq !== undefined
                        ? forcedSeq.seqId | 0
                        : useActionSequence
                          ? actionSeqId | 0
                          : movementSeqId | 0;
                let frameIdx =
                    unanimatedIdle
                        ? 0
                        : forcedSeq !== undefined
                        ? forcedSeq.frameIdx | 0
                        : useActionSequence
                          ? actionFrameIdx | 0
                          : movementFrameIdx | 0;
                let overlaySeqId: number | undefined;
                let overlayFrameIdx: number | undefined;
                if (useActionSequence) {
                    let canLayer = false;
                    try {
                        const st = this.renderer.osrsClient.seqTypeLoader.load(
                            actionSeqId | 0,
                        ) as any;
                        if (st?.isSkeletalSeq?.()) canLayer = Array.isArray(st.skeletalMasks);
                        else canLayer = Array.isArray(st?.masks) && st.masks.length > 0;
                    } catch {}
                    if (
                        canLayer &&
                        (movementSeqId | 0) >= 0 &&
                        (movementSeqId | 0) !== (idleSeqId | 0)
                    ) {
                        overlaySeqId = movementSeqId | 0;
                        overlayFrameIdx = movementFrameIdx | 0;
                    }
                }

                let effectiveApp = app;
                if (useActionSequence && (app.npcTransformationId ?? -1) < 0) {
                    try {
                        const seqType = this.renderer.osrsClient.seqTypeLoader.load(
                            actionSeqId | 0,
                        );
                        if (seqType && (seqType.leftHandItem >= 0 || seqType.rightHandItem >= 0)) {
                            const newEquip = app.equip.slice();
                            // OSRS cache SeqType stores item IDs with 512 offset (0x200) for equipment overrides.
                            // We must strip this offset to get the actual Item ID for our loader.
                            let shield = seqType.leftHandItem;
                            let weapon = seqType.rightHandItem;
                            if (shield >= 512) shield -= 512;
                            if (weapon >= 512) weapon -= 512;

                            if (shield >= 0) newEquip[EquipmentSlot.SHIELD] = shield;
                            if (weapon >= 0) newEquip[EquipmentSlot.WEAPON] = weapon;
                            effectiveApp = new PlayerAppearance(
                                app.gender,
                                app.colors,
                                app.kits,
                                newEquip,
                                app.headIcons,
                            );
                        }
                    } catch {}
                }
                const serverId = peInst.getServerIdForIndex(pid);
                if (serverId === undefined) continue;
                effectiveApp = this.getFirstPersonAppearance(pid, effectiveApp);
                const renderableAppearance = this.resolveRenderableAppearance(serverId, effectiveApp);
                if (!renderableAppearance) continue;
                effectiveApp = renderableAppearance;

                // Create batch key
                const appKey =
                    effectiveApp?.getCacheKey?.() ??
                    `${effectiveApp?.getHash?.().toString() ?? "0"}|${
                        effectiveApp?.getEquipKey?.() ??
                        effectiveApp?.equip?.slice?.(0, 14)?.join(",") ??
                        ""
                    }`;
                const overlayKey =
                    typeof overlaySeqId === "number" && typeof overlayFrameIdx === "number"
                        ? `|${overlaySeqId | 0}|${overlayFrameIdx | 0}`
                        : "";
                const frameCycle =
                    forcedSeq !== undefined || unanimatedIdle
                        ? 0
                        : this.smoothingCycle(
                              seqId,
                              overlaySeqId,
                              useActionSequence ? actionFrameCycle : movementFrameCycle,
                          );
                const cycleKey = frameCycle > 0 ? `~${frameCycle}` : "";
                const batchKey = `${appKey}|${seqId}|${frameIdx}${cycleKey}${overlayKey}`;

                // Add to alpha batch group
                let group = alphaBatchGroups.get(batchKey);
                if (!group) {
                    group = {
                        appearance: effectiveApp,
                        seqId: seqId | 0,
                        frameIdx: frameIdx | 0,
                        frameCycle,
                        overlaySeqId: overlaySeqId,
                        overlayFrameIdx: overlayFrameIdx,
                        instances: [],
                    };
                    alphaBatchGroups.set(batchKey, group);
                }
                group.instances.push({ slot, pid, mode });
            }
            if (alphaBatchGroups.size === 0) continue;

            // Render batched alpha groups.
            const alphaPoses = this.preparePoses(alphaBatchGroups);
            const draw = r.configureDrawCall(this.drawCallAlpha as any as DrawCall);
            const playerEcsAlpha = r.osrsClient?.playerEcs;
            const alphaDeckH = r.getWorldEntityDeckHeight(0, 0);
            const alphaMapPos = vec2.fromValues(map.renderPosX, map.renderPosY);
            draw.uniform("u_mapPos", alphaMapPos)
                .uniform("u_npcDataOffset", baseOffset)
                .uniform("u_modelYOffset", r.playerYOffset)
                .uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4)
                .texture("u_npcDataTexture", playerDataTexture)
                .texture("u_heightMap", map.heightMapTexture)
                .uniform("u_sceneBorderSize", map.borderSize);

            r.app.disable(PicoGL.CULL_FACE);

            for (const [batchKey, group] of alphaBatchGroups) {
                if (group.instances.length === 0) continue;

                const baseRec = this.ensureBaseForAppearance(group.appearance);
                if (!baseRec) continue;

                slots.length = 0;
                let batchSource: (typeof group.instances)[number] | undefined;
                for (const inst of group.instances) {
                    if (this.canBatchPlayer(inst.pid, playerEcsAlpha)) {
                        batchSource ??= inst;
                        slots.push(inst.slot | 0);
                    }
                }

                if (batchSource) {
                    const posed = alphaPoses.get(batchKey);
                    let gpuGeometry = posed?.geometry ?? this.getPlayerGpuGeometry(batchKey);
                    if (!gpuGeometry) {
                        this.dynamicUpdateBuffersFor(
                            baseRec.baseModel,
                            baseRec.baseCenterX,
                            baseRec.baseCenterZ,
                            group.seqId,
                            group.frameIdx,
                            batchKey,
                            batchSource.pid,
                            batchSource.mode,
                            group.overlaySeqId,
                            group.overlayFrameIdx,
                            "cacheOnly",
                            group.frameCycle,
                        );
                        gpuGeometry = this.getPlayerGpuGeometry(batchKey);
                    }
                    const counts = gpuGeometry
                        ? { countAlpha: gpuGeometry.alpha?.count ?? 0 }
                        : this.dynamicUpdateBuffersFor(
                              baseRec.baseModel,
                              baseRec.baseCenterX,
                              baseRec.baseCenterZ,
                              group.seqId,
                              group.frameIdx,
                              batchKey,
                              batchSource.pid,
                              batchSource.mode,
                              group.overlaySeqId,
                              group.overlayFrameIdx,
                              "alphaOnly",
                              group.frameCycle,
                          );
                    if ((counts.countAlpha | 0) > 0) {
                        const playerDraw = gpuGeometry?.alpha
                            ? r
                                  .configureDrawCall(gpuGeometry.alpha.drawCall)
                                  .uniform("u_mapPos", alphaMapPos)
                                  .uniform("u_npcDataOffset", baseOffset)
                                  .uniform("u_modelYOffset", r.playerYOffset)
                                  .uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4)
                                  .texture("u_npcDataTexture", playerDataTexture)
                                  .texture("u_heightMap", map.heightMapTexture)
                                  .uniform("u_sceneBorderSize", map.borderSize)
                            : draw;
                        if (posed) {
                            playerDraw.uniform("u_poseRow", posed.row);
                        }
                        drawPlayerSlots(
                            playerDraw,
                            r.playerSlotBuffer!,
                            this.playerSlotScratch,
                            slots,
                            counts.countAlpha | 0,
                        );
                    }
                }

                for (const inst of group.instances) {
                    if (batchSource && this.canBatchPlayer(inst.pid, playerEcsAlpha)) {
                        continue;
                    }
                    const counts = this.dynamicUpdateBuffersFor(
                        baseRec.baseModel,
                        baseRec.baseCenterX,
                        baseRec.baseCenterZ,
                        group.seqId,
                        group.frameIdx,
                        batchKey,
                        inst.pid,
                        inst.mode,
                        group.overlaySeqId,
                        group.overlayFrameIdx,
                        "alphaOnly",
                        group.frameCycle,
                    );

                    if ((counts.countAlpha | 0) <= 0) continue;

                    // Per-player WorldView: apply deck height + bobbing transform
                    const wvIdAlpha = playerEcsAlpha?.getWorldViewId?.(inst.pid) ?? -1;
                    if (wvIdAlpha >= 0) {
                        const weTransform =
                            r.worldEntityAnimator?.getTransform(wvIdAlpha) ??
                            WebGLMapSquare.IDENTITY_MAT4;
                        draw.uniform("u_modelYOffset", r.playerYOffset + alphaDeckH).uniform(
                            "u_worldEntityTransform",
                            weTransform,
                        );
                    }

                    // Use drawIdOverride since gl_DrawID will be 0 for single-range draws
                    draw.uniform("u_drawIdOverride", inst.slot | 0);
                    (draw as any).drawRanges([0, counts.countAlpha | 0, 1]);
                    draw.draw();

                    // Restore overworld uniforms after WE player draw
                    if (wvIdAlpha >= 0) {
                        draw.uniform("u_modelYOffset", r.playerYOffset).uniform(
                            "u_worldEntityTransform",
                            WebGLMapSquare.IDENTITY_MAT4,
                        );
                    }
                }
                draw.uniform("u_drawIdOverride", -1); // Reset
            }
            if (r.cullBackFace) r.app.enable(PicoGL.CULL_FACE);
        }
    }

    private emitPlayerFrameSound(
        pid: number,
        seqId: number,
        frameIdx: number,
        worldX: number,
        worldY: number,
        plane: number,
        isLocalPlayer: boolean,
        channel: "movement" | "action",
    ): void {
        const key = `${pid | 0}|${channel}`;
        const last = this.playerSoundState.get(key);
        if (last && last.seqId === seqId && last.frameIdx === frameIdx) {
            return;
        }
        this.playerSoundState.set(key, { seqId, frameIdx });
        try {
            const mv = this.renderer.osrsClient;
            const seqType = mv.seqTypeLoader.load(seqId);
            // Check for both modern frameSounds and legacy soundEffects formats
            if (!seqType || (!seqType.frameSounds?.size && !seqType.soundEffects?.length)) return;
            mv.handleSeqFrameSounds(seqType, frameIdx, {
                position: { x: worldX, y: worldY, z: plane * 128 },
                isLocalPlayer,
            });
        } catch {}
    }

    private isControlledPid(pid: number): boolean {
        try {
            const mv = this.renderer.osrsClient;
            const idx = mv.playerEcs.getIndexForServerId(mv.controlledPlayerServerId);
            return idx !== undefined && (idx | 0) === (pid | 0);
        } catch {
            return false;
        }
    }

    private canBatchPlayer(pid: number, playerEcs: any): boolean {
        return (
            !!this.renderer.playerSlotBuffer &&
            !this.isControlledPid(pid) &&
            (playerEcs?.getWorldViewId?.(pid) ?? -1) < 0
        );
    }

    private resetRenderSelectionFrameIfNeeded(): void {
        const frameId = (this.renderer.stats?.frameCount ?? 0) | 0;
        if (frameId === this.frameRenderSelectionId) return;
        this.frameRenderSelectionId = frameId;
        this.frameRenderPlayersByMap.clear();
        this.framePlayerAlphaCounts.clear();
    }

    getRenderPlayersForMap(map: WebGLMapSquare): number[] {
        this.resetRenderSelectionFrameIfNeeded();

        const key = ((map.mapX & 0xffff) << 16) | (map.mapY & 0xffff);
        const cached = this.frameRenderPlayersByMap.get(key);
        if (cached) {
            return cached;
        }

        const out: number[] = [];
        const pe = this.renderer.osrsClient.playerEcs;
        const overlayView = this.renderer.osrsClient.worldViewManager.getWorldViewByOverlayMapId(
            map.id,
        );
        const renderSelf = this.renderer.osrsClient.renderSelf !== false;
        // Instances are one 104-tile scene, not a single 64-tile world map square.
        const baseTileX = map.getRenderBaseTileX();
        const baseTileY = map.getRenderBaseTileY();
        const tileSpan = map.getLocalTileSpan();

        for (const activePid of pe.getAllActiveIndices()) {
            const pid = activePid | 0;
            const isFirstPersonPlayer = this.isFirstPersonArmsPlayer(pid);
            if (!renderSelf && !isFirstPersonPlayer && this.isControlledPid(pid)) {
                continue;
            }

            const px = pe.getX(pid) | 0;
            const py = pe.getY(pid) | 0;
            const tileX = (px >> 7) | 0;
            const tileY = (py >> 7) | 0;
            const worldViewId = pe.getWorldViewId(pid) | 0;

            if (overlayView) {
                if ((worldViewId | 0) !== (overlayView.id | 0)) {
                    continue;
                }
                if (!overlayView.containsTile(tileX, tileY)) {
                    continue;
                }
            } else {
                if (worldViewId >= 0) {
                    continue;
                }
                if (
                    tileX < baseTileX || tileX >= baseTileX + tileSpan ||
                    tileY < baseTileY || tileY >= baseTileY + tileSpan
                ) {
                    continue;
                }
            }
            if (!isFirstPersonPlayer && !this.renderer.shouldRenderPlayerIndex(pid)) {
                continue;
            }

            out.push(pid | 0);
        }

        this.frameRenderPlayersByMap.set(key, out);
        return out;
    }
}
