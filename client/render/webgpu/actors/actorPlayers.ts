import { packedActorBounds, type ActorBounds } from "../../ActorVisibility";
import { playerInterpolation } from "../../player/PlayerInterpolation";
import { applyInterpolatedFrames, interpolationFrame, interpolationKey, type ActorInterpolation } from "../../../rs/model/seq/FrameInterpolation";
import type { OsrsClient } from "../../../game/OsrsClient";
import { withSeqHandItems } from "../../../rs/config/player/Equipment";
import type { PlayerAppearance } from "../../../rs/config/player/PlayerAppearance";
import { Model } from "../../../rs/model/Model";
import type { TextureLoader } from "../../../rs/texture/TextureLoader";
import { buildActorNormals } from "../../buffer/ActorNormals";
import { SceneBuffer, getModelFacesFiltered } from "../../buffer/SceneBuffer";
import { LabelPose, LabelRig } from "../../player/LabelPose";

/**
 * CPU-posed player geometry for the WebGPU backend.
 *
 * The WebGL renderer poses every player on the CPU too (`PlayerRenderer.dynamicUpdateBuffersFor`
 * plus `applySequenceTransformationsToModel`); this module ports that pipeline without the GL
 * buffer upload and batching layers; geometry is cached per appearance|sequence|frame.
 *
 * Like PlayerRenderer's GPU animation, keyframe poses that only move whole labels are not built
 * on the CPU: `resolve` returns the appearance's rest-pose mesh (built once, one label per vertex)
 * plus one 3x4 matrix per label (LabelPose), which vs_player applies. Animation smoothing makes
 * every frame a new pose, so this keeps it from rebuilding a mesh per player per frame.
 */

export interface PosedActorGeometry {
    /** Geometry cache key: the pose for CPU-posed meshes, the appearance for rest meshes. */
    key: string;
    opaqueVertices: Uint8Array;
    opaqueIndices: Int32Array;
    alphaVertices: Uint8Array;
    alphaIndices: Int32Array;
    /** GPU pose: per-vertex label + 1 of the rest mesh, and the pose's label matrices. */
    opaqueLabels?: Uint32Array;
    alphaLabels?: Uint32Array;
    matrices?: Float32Array;
    /** The pose's key, shared by every player in the same pose this frame. */
    poseKey?: string;
    bounds?: ActorBounds;
}

/** One unshared face corner per label: shared by player and NPC rest meshes. */
export function buildLabelledActorRestMesh(
    key: string,
    baseModel: Model,
    rig: LabelRig,
    textureLoader: TextureLoader,
    textureIdIndexMap: Map<number, number>,
): PosedActorGeometry {
    const vertexLabel = rig.vertexLabelOf();
    const normals = buildActorNormals(baseModel);
    const build = (alpha: boolean) => {
        const faces = getModelFacesFiltered(baseModel, textureLoader, alpha);
        const sceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, faces.length * 3 + 16, true);
        if (faces.length > 0) sceneBuf.addModel(baseModel, faces, undefined, false, normals);
        const labels = new Uint32Array(faces.length * 3);
        for (let i = 0; i < faces.length; i++) {
            const face = faces[i].index;
            labels[i * 3] = vertexLabel[baseModel.indices1[face]] + 1;
            labels[i * 3 + 1] = vertexLabel[baseModel.indices2[face]] + 1;
            labels[i * 3 + 2] = vertexLabel[baseModel.indices3[face]] + 1;
        }
        return {
            vertices: sceneBuf.vertexBuf.byteArray() as Uint8Array,
            indices: Int32Array.from(sceneBuf.indices),
            labels,
        };
    };
    const opaque = build(false);
    const alpha = build(true);
    return {
        key,
        opaqueVertices: opaque.vertices,
        opaqueIndices: opaque.indices,
        opaqueLabels: opaque.labels,
        alphaVertices: alpha.vertices,
        alphaIndices: alpha.indices,
        alphaLabels: alpha.labels,
    };
}

interface BaseAppearance {
    baseModel: Model;
    baseCenterX: number;
    baseCenterZ: number;
}

/** ~1024 player frames at the ~40 KB a frame measures; a crowd of ~25 fits. */
const MAX_CPU_GEOMETRY_ENTRIES = 1024;
/** PlayerRenderer.POSE_CACHE_MAX_ENTRIES: matrices are a few KB per pose. */
const MAX_POSE_ENTRIES = 4096;
const MAX_REST_MESH_ENTRIES = 512;

export class PlayerPoseGeometry {
    private readonly baseCache = new Map<string, BaseAppearance | undefined>();
    private readonly geomCache = new Map<string, PosedActorGeometry>();
    private readonly skeletalDurationCache = new Map<number, number>();
    private readonly poseCache = new Map<string, Float32Array | null>();
    private readonly restCache = new Map<string, PosedActorGeometry>();
    private readonly rigs = new WeakMap<Model, LabelRig | null>();
    private readonly opaqueSceneBuf: SceneBuffer;
    private readonly alphaSceneBuf: SceneBuffer;

    constructor(
        private readonly client: OsrsClient,
        private readonly textureIdIndexMap: Map<number, number>,
        private readonly loadedTextureIds: Set<number>,
        private readonly updateTextureArray: (textures: Map<number, Int32Array>) => void,
    ) {
        const textureLoader = client.textureLoader as TextureLoader;
        // smoothActor=true -> ACTOR_VERTEX_STRIDE (20-byte) vertices, the layout the WebGL
        // player CPU path and the WebGPU player pipeline use.
        this.opaqueSceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 0, true);
        this.alphaSceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 0, true);
    }

    /**
     * Returns the posed geometry for one player this frame, or undefined while it cannot pose.
     * `allowGpu` false forces a CPU-posed mesh (when the frame's pose rows are full).
     */
    resolve(pid: number, allowGpu: boolean = true, visible?: (geometry: PosedActorGeometry) => boolean): PosedActorGeometry | undefined {
        const pe = this.client.playerEcs;
        const actionSeqId = pe.getAnimSeqId(pid) | 0;
        const movementSeqId = pe.getAnimMovementSeqId(pid) | 0;
        const idleSeqId = pe.getAnimSeq(pid, "idle") | 0;
        const actionDelay = pe.getAnimSeqDelay?.(pid) ?? 0;
        const actionActive = actionSeqId >= 0 && actionDelay === 0;
        if (!actionActive && movementSeqId < 0) return undefined;

        let app = pe.getAppearance(pid);
        if (!app) return undefined;
        if (actionActive) {
            try {
                app = withSeqHandItems(app, this.client.seqTypeLoader.load(actionSeqId));
            } catch {}
        }

        const base = this.baseForAppearance(app);
        if (!base) return undefined;

        let movementFrameIdx = 0;
        let actionFrameIdx = 0;
        const controller = this.client.playerAnimController;
        const serverId = pe.getServerIdForIndex(pid);
        if (controller && serverId !== undefined) {
            const movementState = controller.getMovementSequenceState(serverId);
            const actionState = controller.getSequenceState(serverId);
            movementFrameIdx = (movementState?.frame ?? 0) | 0;
            actionFrameIdx = (actionState?.frame ?? 0) | 0;
        }

        const seqId = actionActive ? actionSeqId : movementSeqId;
        const frameIdx = actionActive ? actionFrameIdx : movementFrameIdx;

        let overlaySeqId: number | undefined;
        let overlayFrameIdx: number | undefined;
        if (actionActive) {
            let canLayer = false;
            try {
                const st = this.client.seqTypeLoader.load(actionSeqId) as any;
                if (st?.isSkeletalSeq?.()) canLayer = Array.isArray(st.skeletalMasks);
                else canLayer = Array.isArray(st?.masks) && st.masks.length > 0;
            } catch {}
            if (canLayer && movementSeqId >= 0 && movementSeqId !== idleSeqId) {
                overlaySeqId = movementSeqId;
                overlayFrameIdx = movementFrameIdx;
            }
        }

        const interpolation = playerInterpolation(this.client, pid, seqId, frameIdx, overlaySeqId, overlayFrameIdx);
        const overlayKey =
            overlaySeqId !== undefined && overlayFrameIdx !== undefined
                ? `|${overlaySeqId | 0}|${overlayFrameIdx | 0}`
                : "";
        const cycleKey = interpolationKey(interpolation);
        const appKey = app.getCacheKey?.() ?? this.appearanceFallbackKey(app);
        const key = `${appKey}|${seqId}|${frameIdx}${cycleKey}${overlayKey}`;

        const cpuPose = this.geomCache.get(key);
        // Only final CPU poses have bounds; rest meshes do not bound a GPU label animation.
        if (cpuPose && (!allowGpu || this.poseCache.get(key) === null) && visible && !visible(cpuPose)) return undefined;

        if (allowGpu) {
            const matrices = this.poseFor(key, base, { seqId, frameIdx, interpolation, overlaySeqId, overlayFrameIdx });
            const rest = matrices ? this.restMeshFor(appKey, base.baseModel) : undefined;
            if (rest) return { ...rest, matrices, poseKey: key };
        }

        const cached = this.geomCache.get(key);
        if (cached) {
            this.geomCache.delete(key);
            this.geomCache.set(key, cached);
            return cached;
        }

        const built = this.build(base.baseModel, base.baseCenterX, base.baseCenterZ, {
            seqId,
            frameIdx,
            interpolation,
            overlaySeqId,
            overlayFrameIdx,
        });
        if (!built) return undefined;
        const [geometry, animated] = built;
        geometry.key = key;
        if (!animated) return geometry;
        this.geomCache.set(key, geometry);
        while (this.geomCache.size > MAX_CPU_GEOMETRY_ENTRIES) {
            const oldest = this.geomCache.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            this.geomCache.delete(oldest);
        }
        return geometry;
    }

    clear(): void {
        this.baseCache.clear();
        this.geomCache.clear();
        this.skeletalDurationCache.clear();
        this.poseCache.clear();
        this.restCache.clear();
    }

    /** Port of PlayerRenderer.poseFor: the pose's label matrices, or none if it needs the CPU. */
    private poseFor(
        key: string,
        base: BaseAppearance,
        anim: { seqId: number; frameIdx: number; interpolation?: ActorInterpolation; overlaySeqId?: number; overlayFrameIdx?: number },
    ): Float32Array | undefined {
        const cached = this.poseCache.get(key);
        if (cached !== undefined) {
            this.poseCache.delete(key);
            this.poseCache.set(key, cached);
            return cached ?? undefined;
        }
        let matrices: Float32Array | null = null;
        // A frame still streaming in leaves the rest pose: draw it, but don't keep it.
        let keep = true;
        try {
            const rig = this.rigFor(base.baseModel);
            // The CPU path re-centres the posed model on the base centre; GPU poses assume none.
            if (rig && (base.baseCenterX | 0) === 0 && (base.baseCenterZ | 0) === 0) {
                const seqType: any = anim.seqId >= 0 ? this.client.seqTypeLoader.load(anim.seqId | 0) : undefined;
                const overlayType: any = anim.overlaySeqId !== undefined && anim.overlayFrameIdx !== undefined
                    ? this.client.seqTypeLoader.load(anim.overlaySeqId | 0)
                    : undefined;
                if (seqType && !seqType.isSkeletalSeq?.() && !overlayType?.isSkeletalSeq?.()) {
                    const pose = new LabelPose(rig);
                    keep = this.applySequenceToModel(
                        pose,
                        anim.seqId,
                        anim.frameIdx,
                        anim.overlaySeqId,
                        anim.overlayFrameIdx,
                        anim.interpolation,
                    );
                    if (!pose.needsCpu) matrices = pose.finish(0, 0);
                }
            }
        } catch {
            matrices = null;
        }
        if (!keep) return matrices ?? undefined;
        this.poseCache.set(key, matrices);
        while (this.poseCache.size > MAX_POSE_ENTRIES) {
            this.poseCache.delete(this.poseCache.keys().next().value as string);
        }
        return matrices ?? undefined;
    }

    private rigFor(model: Model): LabelRig | undefined {
        let rig = this.rigs.get(model);
        if (rig === undefined) {
            rig = LabelRig.of(model) ?? null;
            this.rigs.set(model, rig);
        }
        return rig ?? undefined;
    }

    /**
     * Port of PlayerRenderer.restMeshFor: the appearance's rest-pose mesh with unshared vertices,
     * so each face corner carries its own label (+ 1; 0 = unlabelled, left unposed).
     */
    private restMeshFor(appKey: string, baseModel: Model): PosedActorGeometry | undefined {
        const key = `rest:${appKey}`;
        const hit = this.restCache.get(key);
        if (hit) {
            this.restCache.delete(key);
            this.restCache.set(key, hit);
            return hit;
        }
        const rig = this.rigFor(baseModel);
        if (!rig) return undefined;
        const textureLoader = this.client.textureLoader as TextureLoader;
        const rest = buildLabelledActorRestMesh(key, baseModel, rig, textureLoader, this.textureIdIndexMap);
        this.restCache.set(key, rest);
        while (this.restCache.size > MAX_REST_MESH_ENTRIES) {
            this.restCache.delete(this.restCache.keys().next().value as string);
        }
        return rest;
    }

    private appearanceFallbackKey(app: PlayerAppearance): string {
        return `${app.getHash?.().toString() ?? "0"}|${app.getEquipKey?.() ?? ""}`;
    }

    private baseForAppearance(app: PlayerAppearance): BaseAppearance | undefined {
        const key = app.getCacheKey?.() ?? this.appearanceFallbackKey(app);
        const cached = this.baseCache.get(key);
        if (cached !== undefined) return cached;

        const mv = this.client;
        let result: BaseAppearance | undefined;
        try {
            const rec = mv.playerEcs.ensureBaseForAppearance(app, {
                idkTypeLoader: mv.idkTypeLoader,
                objTypeLoader: mv.objTypeLoader,
                modelLoader: mv.modelLoader,
                textureLoader: mv.textureLoader,
                npcTypeLoader: mv.npcTypeLoader,
                seqTypeLoader: mv.seqTypeLoader,
                seqFrameLoader: mv.seqFrameLoader,
                skeletalSeqLoader: mv.skeletalSeqLoader,
                varManager: mv.varManager,
                basTypeLoader: mv.basTypeLoader,
            });
            if (rec) {
                result = {
                    baseModel: rec.baseModel as Model,
                    baseCenterX: rec.baseCenterX | 0,
                    baseCenterZ: rec.baseCenterZ | 0,
                };
                this.uploadModelTextures(result.baseModel);
            }
        } catch {
            result = undefined;
        }
        this.baseCache.set(key, result);
        return result;
    }

    /** Port of PlayerRenderer.ensureBaseForAppearance's texture upload block. */
    private uploadModelTextures(model: Model): void {
        try {
            const textureLoader = this.client.textureLoader as TextureLoader;
            const used = new Set<number>();
            if (model.faceTextures) {
                for (let i = 0; i < model.faceCount; i++) {
                    const tid = model.faceTextures[i];
                    if (tid !== -1 && textureLoader.isSd?.(tid)) used.add(tid);
                }
            }
            if (used.size === 0) return;
            const toUpload = new Map<number, Int32Array>();
            for (const tid of used) {
                if (this.loadedTextureIds.has(tid)) continue;
                try {
                    toUpload.set(tid, textureLoader.getPixelsArgb(tid, 128, true, 1.0));
                } catch {}
            }
            if (toUpload.size > 0) this.updateTextureArray(toUpload);
        } catch {}
    }

    private build(
        baseModel: Model,
        baseCenterX: number,
        baseCenterZ: number,
        anim: {
            seqId: number;
            frameIdx: number;
            interpolation?: ActorInterpolation;
            overlaySeqId?: number;
            overlayFrameIdx?: number;
        },
    ): [PosedActorGeometry, boolean] | undefined {
        try {
            const model = Model.copyAnimated(baseModel, false, true);
            const animated = this.applySequenceToModel(
                model,
                anim.seqId,
                anim.frameIdx,
                anim.overlaySeqId,
                anim.overlayFrameIdx,
                anim.interpolation,
            );

            try {
                model.calculateBounds();
                const dx = (baseCenterX - ((model as any).xMid | 0)) | 0;
                const dz = (baseCenterZ - ((model as any).zMid | 0)) | 0;
                if ((dx | dz) !== 0) model.translate(dx, 0, dz);
            } catch {}

            const textureLoader = this.client.textureLoader as TextureLoader;
            // CPU poses retain fractional positions alongside the normal and colour words.
            const actorNormals = buildActorNormals(model, baseModel);
            const opaqueFaces = getModelFacesFiltered(model, textureLoader, false);
            const alphaFaces = getModelFacesFiltered(model, textureLoader, true);

            this.resetSceneBuf(this.opaqueSceneBuf);
            if (opaqueFaces.length > 0) {
                this.opaqueSceneBuf.addModel(model, opaqueFaces, undefined, true, actorNormals);
            }
            const opaqueVertices = new Uint8Array(this.opaqueSceneBuf.vertexBuf.byteArray());
            const opaqueIndices = new Int32Array(this.opaqueSceneBuf.indices);

            this.resetSceneBuf(this.alphaSceneBuf);
            if (alphaFaces.length > 0) {
                this.alphaSceneBuf.addModel(model, alphaFaces, undefined, true, actorNormals);
            }
            const alphaVertices = new Uint8Array(this.alphaSceneBuf.vertexBuf.byteArray());
            const alphaIndices = new Int32Array(this.alphaSceneBuf.indices);

            return [{
                key: "",
                opaqueVertices,
                opaqueIndices,
                alphaVertices,
                alphaIndices,
                bounds: packedActorBounds(opaqueVertices, alphaVertices),
            }, animated];
        } catch {
            return undefined;
        }
    }

    private resetSceneBuf(sceneBuf: SceneBuffer): void {
        try {
            sceneBuf.vertexBuf.offset = 0;
            sceneBuf.vertexBuf.vertexIndices.clear();
        } catch {}
        sceneBuf.indices.length = 0;
        sceneBuf.usedTextureIds.clear();
    }

    // ── Ports of PlayerRenderer's sequence application ─────────────────────────────────────────

    private applySequenceToModel(
        model: Model,
        seqId: number,
        frameIdx: number,
        overlaySeqId: number | undefined,
        overlayFrameIdx: number | undefined,
        interpolation: ActorInterpolation | undefined,
    ): boolean {
        try {
            const seqType = this.client.seqTypeLoader.load(seqId | 0);
            const overlayId =
                typeof overlaySeqId === "number" && Number.isFinite(overlaySeqId)
                    ? overlaySeqId | 0
                    : -1;
            const overlayFrame =
                typeof overlayFrameIdx === "number" && Number.isFinite(overlayFrameIdx)
                    ? overlayFrameIdx | 0
                    : -1;
            if (!seqType) return false;
            const overlayType =
                overlayId >= 0 && overlayFrame >= 0
                    ? this.client.seqTypeLoader.load(overlayId)
                    : undefined;
            return this.applySequenceTransformations(
                model,
                seqType as any,
                seqId | 0,
                frameIdx | 0,
                overlayType as any,
                overlayId,
                overlayFrame,
                interpolation,
            );
        } catch {
            return false;
        }
    }

    private applySingleSequence(
        model: Model,
        seqType: any,
        seqId: number,
        frameIdx: number,
        interpolation: ActorInterpolation | undefined,
    ): boolean {
        if (!seqType) return false;
        if (seqType.isSkeletalSeq?.()) {
            const skeletal = this.client.skeletalSeqLoader?.load(seqType.skeletalId);
            if (!skeletal) return false;
            const duration = this.effectiveSkeletalDuration(seqType, seqId | 0);
            const local = Math.max(0, frameIdx | 0) % Math.max(1, duration | 0);
            model.animateSkeletal(skeletal, local | 0);
            return true;
        }

        if (seqType.frameIds && seqType.frameIds.length > 0) {
            const ids = seqType.frameIds as number[];
            const idx = Math.max(0, frameIdx | 0) % (ids.length | 0);
            const frame0 = this.client.seqFrameLoader.load(ids[idx] | 0);
            if (!frame0) return false;
            if (interpolation) {
                return applyInterpolatedFrames(model, this.client.seqFrameLoader, seqType, idx, interpolation);
            } else {
                model.animate(frame0, undefined, !!seqType.op14);
            }
            return true;
        }
        return false;
    }

    private applySequenceTransformations(
        model: Model,
        baseType: any,
        baseSeqId: number,
        baseFrameIdx: number,
        overlayType: any,
        overlaySeqId: number,
        overlayFrameIdx: number,
        interpolation: ActorInterpolation | undefined,
    ): boolean {
        if (!baseType) return false;
        if (!overlayType) {
            return this.applySingleSequence(model, baseType, baseSeqId, baseFrameIdx, interpolation);
        }

        if (interpolation && !baseType.isSkeletalSeq?.() && !overlayType.isSkeletalSeq?.()) {
            return applyInterpolatedFrames(model, this.client.seqFrameLoader, baseType, baseFrameIdx,
                interpolation, overlayType, overlayFrameIdx);
        }

        const baseCached = !!baseType.isSkeletalSeq?.();
        const overlayCached = !!overlayType.isSkeletalSeq?.();
        const skeletalLoader = this.client.skeletalSeqLoader;

        if (baseCached) {
            const baseSkeletal = skeletalLoader?.load(baseType.skeletalId);
            if (!baseSkeletal) return false;

            const baseDuration = this.effectiveSkeletalDuration(baseType, baseSeqId | 0);
            const baseAnimFrame =
                Math.max(0, baseFrameIdx | 0) % Math.max(1, baseDuration | 0);

            if (overlayCached) {
                if (!Array.isArray(baseType?.skeletalMasks)) {
                    model.animateSkeletal(baseSkeletal, baseAnimFrame);
                    return true;
                }
                const overlaySkeletal = skeletalLoader?.load(overlayType.skeletalId);
                if (!overlaySkeletal) {
                    model.animateSkeletal(baseSkeletal, baseAnimFrame);
                    return false;
                }
                const overlayDuration = this.effectiveSkeletalDuration(overlayType, overlaySeqId | 0);
                const overlayAnimFrame =
                    Math.max(0, overlayFrameIdx | 0) % Math.max(1, overlayDuration | 0);
                model.animateSkeletalComposite(baseSkeletal, baseAnimFrame, {
                    masks: baseType.skeletalMasks,
                    overlay: { seq: overlaySkeletal, frame: overlayAnimFrame } as any,
                });
                return true;
            }

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
                const frame0 = this.client.seqFrameLoader.load(ids[idx] | 0);
                if (!frame0) return false;
                const interleave = Array.isArray(baseType?.masks)
                    ? (baseType.masks as number[])
                    : undefined;
                model.animateInterleavedFrame(frame0, !!overlayType.op14, interleave, true,
                    interpolationFrame(overlayType, interpolation?.overlay, this.client.seqFrameLoader), interpolation?.overlay?.alpha);
            }
            return true;
        }

        if (!baseType.frameIds || baseType.frameIds.length <= 0) return false;
        const baseIds = baseType.frameIds as number[];
        const baseIdx = Math.max(0, baseFrameIdx | 0) % (baseIds.length | 0);
        const baseFrame0 = this.client.seqFrameLoader.load(baseIds[baseIdx] | 0);
        if (!baseFrame0) return false;

        const interleave = Array.isArray(baseType?.masks)
            ? (baseType.masks as number[])
            : undefined;

        if (overlayCached) {
            if (!interleave || interleave.length === 0) {
                model.animate(baseFrame0 as any, undefined, !!baseType.op14);
                return true;
            }
            const overlaySkeletal = skeletalLoader?.load(overlayType.skeletalId);
            if (!overlaySkeletal) {
                model.animate(baseFrame0 as any, undefined, !!baseType.op14);
                return false;
            }
            const overlayDuration = this.effectiveSkeletalDuration(overlayType, overlaySeqId | 0);
            const overlayAnimFrame =
                Math.max(0, overlayFrameIdx | 0) % Math.max(1, overlayDuration | 0);
            model.animateSkeletal(overlaySkeletal, overlayAnimFrame, {
                masks: Array.isArray(baseType?.skeletalMasks) ? baseType.skeletalMasks : undefined,
                maskMatch: true,
                applyAlpha: false,
            });
            model.animateInterleavedFrame(baseFrame0, !!baseType.op14, interleave, false,
                interpolationFrame(baseType, interpolation?.base, this.client.seqFrameLoader), interpolation?.base?.alpha);
            return true;
        }

        if (
            !overlayType.frameIds ||
            overlayType.frameIds.length <= 0 ||
            !interleave ||
            interleave.length === 0
        ) {
            model.animate(baseFrame0 as any, undefined, !!baseType.op14);
            return true;
        }

        const overlayIds = overlayType.frameIds as number[];
        const overlayIdx = Math.max(0, overlayFrameIdx | 0) % (overlayIds.length | 0);
        const overlayFrame0 = this.client.seqFrameLoader.load(overlayIds[overlayIdx] | 0);
        if (!overlayFrame0) {
            model.animate(baseFrame0 as any, undefined, !!baseType.op14);
            return false;
        }
        model.animateInterleavedFrames(
            baseFrame0 as any,
            !!baseType.op14,
            overlayFrame0 as any,
            !!overlayType.op14,
            interleave,
        );
        return true;
    }

    private effectiveSkeletalDuration(seqType: any, seqId: number): number {
        const cached = this.skeletalDurationCache.get(seqId | 0);
        if (cached && cached > 0) return cached | 0;
        let duration = Number(seqType?.getSkeletalDuration?.() ?? 0) | 0;
        if (!(duration > 0)) duration = 1;
        this.skeletalDurationCache.set(seqId | 0, duration | 0);
        return duration | 0;
    }
}
