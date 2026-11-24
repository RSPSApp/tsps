import { SampledAnimationRegistry } from "../../../custom/animations/SampledAnimationRegistry";
import type { OsrsClient } from "../../../game/OsrsClient";
import { Model } from "../../../rs/model/Model";
import type { SeqType } from "../../../rs/config/seqtype/SeqType";
import type { DynamicNpcAnimLoader, NpcFrameRequest } from "../../npc/DynamicNpcAnimLoader";
import { LabelPose, LabelRig } from "../../player/LabelPose";
import { buildLabelledActorRestMesh, type PosedActorGeometry } from "./actorPlayers";

type NpcPose = { matrices: Float32Array; rigidNormals?: boolean };
type NpcRig = { rig: LabelRig | null; rigidBase: boolean };
const MAX_POSES = 4096;
const MAX_REST_MESHES = 512;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;

/** NPC keyframe matrices reuse the player's label shader, rest meshes and pose texture. */
export class NpcPoseGeometry {
    private readonly rigs = new WeakMap<Model, NpcRig>();
    private readonly poses = new Map<string, NpcPose | null>();
    private readonly rest = new Map<string, PosedActorGeometry>();
    private poseBytes = 0;
    private restBytes = 0;
    private context?: string;

    constructor(
        private readonly client: OsrsClient,
        private readonly loader: DynamicNpcAnimLoader,
        private readonly textureIdIndexMap: Map<number, number>,
    ) {}

    resolve(request: NpcFrameRequest, requireRigidNormals: boolean): PosedActorGeometry | undefined {
        const context = this.loader.getContextKey();
        if (context !== this.context) { this.clear(); this.context = context; }
        const revision = this.loader.revision;
        if (!request[5]?.base) return undefined;
        if (requireRigidNormals) {
            const cached = this.loader.peekBaseModel(request[0]);
            // Cold/ineligible HD bodies go straight to the async CPU path, without a main-thread model build.
            if (!cached || !this.rigFor(cached).rigidBase) return undefined;
        }
        const baseType = this.client.seqTypeLoader.load(request[1]);
        const overlayType = (request[3] ?? -1) >= 0 ? this.client.seqTypeLoader.load(request[3]!) : undefined;
        if (!this.supportedFrames(baseType, request[2], request[5].base.next, true) ||
            (overlayType && !this.supportedFrames(overlayType, request[4] ?? 0, request[5].overlay?.next, true))) return undefined;
        const source = this.loader.getGpuPoseSource(...request);
        if (!source) return undefined;
        if (this.loader.revision !== revision) { this.clear(); this.context = this.loader.getContextKey(); }
        const key = `npc-pose:${source.key}`;
        let pose = this.poses.get(key);
        if (pose !== undefined) {
            this.poses.delete(key);
            this.poses.set(key, pose);
        } else {
            pose = null;
            const { rig } = this.rigFor(source.baseModel);
            const width = source.npcType.widthScale / 128, height = source.npcType.heightScale / 128;
            // Integer CPU animation truncates after each operation; matrices cannot reproduce it.
            if (rig && width > 0 && height > 0 && source.interpolation?.base &&
                this.supportedFrames(baseType, source.frameId, source.interpolation.base.next) &&
                (!overlayType || this.supportedFrames(overlayType, source.overlayFrameId, source.interpolation.overlay?.next))) {
                const labelled = new LabelPose(rig);
                this.loader.getModelLoader()!.applyNpcSequenceTransformations(
                    labelled, baseType, request[1], source.frameId,
                    overlayType, request[3] ?? -1, source.overlayFrameId, source.interpolation,
                );
                if (!labelled.needsCpu) {
                    const matrices = labelled.finish(0, 0);
                    const scales = [width, height, width];
                    // Rest vertices already carry NPC size, including vertices with no label.
                    for (let label = 0; label < rig.labelCount; label++) for (let row = 0; row < 3; row++) {
                        const offset = label * 12 + row * 4;
                        for (let column = 0; column < 3; column++) matrices[offset + column] *= scales[row] / scales[column];
                        matrices[offset + 3] *= scales[row];
                    }
                    pose = { matrices };
                }
            }
            this.poses.set(key, pose);
            this.poseBytes += pose?.matrices.byteLength ?? 0;
            while (this.poses.size > MAX_POSES || (this.poseBytes > MAX_CACHE_BYTES && this.poses.size > 1)) {
                const oldest = this.poses.keys().next().value!;
                this.poseBytes -= this.poses.get(oldest)?.matrices.byteLength ?? 0;
                this.poses.delete(oldest);
            }
        }
        if (!pose) return undefined;
        if (requireRigidNormals) {
            pose.rigidNormals ??= this.hasRigidNormals(this.rigFor(source.baseModel).rig!, pose.matrices);
            if (!pose.rigidNormals) return undefined;
        }
        const restKey = `npc-rest:${source.baseKey}`;
        let rest = this.rest.get(restKey);
        if (rest) {
            this.rest.delete(restKey);
            this.rest.set(restKey, rest);
        } else {
            const model = Model.copyAnimated(source.baseModel, true, true);
            model.enableFractionalAnimation();
            model.scale(source.npcType.widthScale, source.npcType.heightScale, source.npcType.widthScale);
            if ([model.verticesX, model.verticesY, model.verticesZ].some(axis => axis.some(v => Math.abs(v) >= 16384))) return undefined;
            rest = buildLabelledActorRestMesh(restKey, model, this.rigFor(source.baseModel).rig!,
                this.client.textureLoader, this.loader.getTextureIdIndexMap?.() ?? this.textureIdIndexMap);
            this.rest.set(restKey, rest);
            this.restBytes += this.meshBytes(rest);
            while (this.rest.size > MAX_REST_MESHES || (this.restBytes > MAX_CACHE_BYTES && this.rest.size > 1)) {
                const oldest = this.rest.keys().next().value!;
                this.restBytes -= this.meshBytes(this.rest.get(oldest)!);
                this.rest.delete(oldest);
            }
        }
        if (!rest.opaqueIndices.length && !rest.alphaIndices.length) return undefined;
        return { ...rest, matrices: pose.matrices, poseKey: key };
    }

    clear(): void {
        this.poses.clear();
        this.rest.clear();
        this.poseBytes = this.restBytes = 0;
    }

    private meshBytes(mesh: PosedActorGeometry): number {
        return mesh.opaqueVertices.byteLength + mesh.alphaVertices.byteLength + mesh.opaqueIndices.byteLength +
            mesh.alphaIndices.byteLength + (mesh.opaqueLabels?.byteLength ?? 0) + (mesh.alphaLabels?.byteLength ?? 0);
    }

    private supportedFrames(type: SeqType, frame: number, next?: number, allowMissingNext = false): boolean {
        if (SampledAnimationRegistry.get(type.id) || type.isSkeletalSeq() || !type.frameIds?.length) return false;
        for (const index of next === undefined ? [frame] : [frame, next]) {
            const loaded = this.client.seqFrameLoader.load(type.frameIds[Math.max(0, index) % type.frameIds.length]);
            if (!loaded && index === next && allowMissingNext) continue;
            if (!loaded || loaded.hasAlphaTransform || loaded.hasColorTransform) return false;
        }
        return true;
    }

    private rigFor(model: Model): NpcRig {
        let cached = this.rigs.get(model);
        if (!cached) {
            const rig = LabelRig.of(model) ?? null;
            const labels = rig?.vertexLabelOf();
            cached = { rig, rigidBase: !!labels?.length && labels[0] >= 0 && labels.every(label => label === labels[0]) };
            this.rigs.set(model, cached);
        }
        return cached;
    }

    /** A shared positive uniform rigid transform preserves the welded smooth normals. */
    private hasRigidNormals(rig: LabelRig, matrices: Float32Array): boolean {
        const labels = rig.vertexLabelOf();
        const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
        const first = labels[0] < 0 ? identity : matrices.subarray(labels[0] * 12, labels[0] * 12 + 12);
        for (const label of labels) for (let i = 0; i < 12; i++) {
            if ((label < 0 ? identity[i] : matrices[label * 12 + i]) !== first[i]) return false;
        }
        const x = [first[0], first[4], first[8]], y = [first[1], first[5], first[9]], z = [first[2], first[6], first[10]];
        const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const length = dot(x, x), tolerance = 1e-5 * length;
        const determinant = x[0] * (y[1] * z[2] - y[2] * z[1]) - y[0] * (x[1] * z[2] - x[2] * z[1]) + z[0] * (x[1] * y[2] - x[2] * y[1]);
        return determinant > 0 && Math.abs(dot(y, y) - length) < tolerance && Math.abs(dot(z, z) - length) < tolerance &&
            Math.abs(dot(x, y)) < tolerance && Math.abs(dot(x, z)) < tolerance && Math.abs(dot(y, z)) < tolerance;
    }
}
