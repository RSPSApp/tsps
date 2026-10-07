import { Model } from "../../model/Model";
import { ModelData } from "../../model/ModelData";
import { ModelLoader } from "../../model/ModelLoader";
import { SeqFrameLoader } from "../../model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../../model/skeletal/SkeletalSeqLoader";
import { TextureLoader } from "../../texture/TextureLoader";
import { SeqType } from "../seqtype/SeqType";
import { SeqTypeLoader } from "../seqtype/SeqTypeLoader";
import { VarManager } from "../vartype/VarManager";
import { NpcType } from "./NpcType";
import { NpcTypeLoader } from "./NpcTypeLoader";

export class NpcModelLoader {
    modelCache: Map<number, Model>;

    constructor(
        readonly npcTypeLoader: NpcTypeLoader,
        readonly modelLoader: ModelLoader,
        readonly textureLoader: TextureLoader,
        readonly seqTypeLoader: SeqTypeLoader,
        readonly seqFrameLoader: SeqFrameLoader,
        readonly skeletalSeqLoader: SkeletalSeqLoader | undefined,
        readonly varManager: VarManager,
    ) {
        this.modelCache = new Map();
    }

    getModel(
        npcType: NpcType,
        seqId: number,
        frame: number,
        movementSeqId: number = -1,
        movementFrame: number = -1,
        frameCycle: number = 0,
    ): Model | undefined {
        if (npcType.transforms) {
            const transformed = npcType.transform(this.varManager, this.npcTypeLoader);
            if (!transformed) {
                return undefined;
            }
            return this.getModel(
                transformed,
                seqId,
                frame,
                movementSeqId | 0,
                movementFrame | 0,
                frameCycle | 0,
            );
        }

        // NPC has no model IDs defined (opcode 1 was never decoded)
        if (!npcType.modelIds || npcType.modelIds.length === 0) {
            return undefined;
        }

        let model = this.modelCache.get(npcType.id);
        if (!model) {
            const missesBefore = this.modelLoader.missCount ?? 0;
            const models = new Array<ModelData>(npcType.modelIds.length);
            for (let i = 0; i < models.length; i++) {
                const modelData = this.modelLoader.getModel(npcType.modelIds[i]);
                if (modelData) {
                    models[i] = modelData;
                }
            }
            if ((this.modelLoader.missCount ?? 0) !== missesBefore) {
                // A part is still streaming in; don't cache a partial merge.
                return undefined;
            }

            const merged = ModelData.merge(models, models.length);

            if (npcType.recolorFrom) {
                const retexture =
                    npcType.cacheInfo.game === "runescape" && npcType.cacheInfo.revision <= 464;
                for (let i = 0; i < npcType.recolorFrom.length; i++) {
                    merged.recolor(npcType.recolorFrom[i], npcType.recolorTo[i]);
                    if (retexture) {
                        merged.retexture(npcType.recolorFrom[i], npcType.recolorTo[i]);
                    }
                }
            }

            if (npcType.retextureFrom) {
                for (let i = 0; i < npcType.retextureFrom.length; i++) {
                    merged.retexture(npcType.retextureFrom[i], npcType.retextureTo[i]);
                }
            }

            model = merged.light(
                this.textureLoader,
                npcType.ambient + 64,
                npcType.contrast * 5 + 850,
                -30,
                -50,
                -30,
            );

            this.modelCache.set(npcType.id, model);
        }

        const hasScale = npcType.widthScale !== 128 || npcType.heightScale !== 128;
        const actionSeqType =
            seqId >= 0 && frame >= 0 ? this.seqTypeLoader.load(seqId | 0) : undefined;
        const movementSeqType =
            movementSeqId >= 0 && movementFrame >= 0
                ? this.seqTypeLoader.load(movementSeqId | 0)
                : undefined;

        if (actionSeqType || movementSeqType) {
            model = Model.copyAnimated(model, false, true);
            this.applyNpcSequenceTransformations(
                model,
                actionSeqType,
                seqId | 0,
                frame | 0,
                movementSeqType,
                movementSeqId | 0,
                movementFrame | 0,
                frameCycle | 0,
            );
        } else if (hasScale) {
            model = Model.copyAnimated(model, true, true);
        }

        if (hasScale) {
            model.scale(npcType.widthScale, npcType.heightScale, npcType.widthScale);
        }

        return model;
    }

    private applyNpcSequenceTransformations(
        model: Model,
        baseType: SeqType | undefined,
        baseSeqId: number,
        baseFrame: number,
        overlayType: SeqType | undefined,
        overlaySeqId: number,
        overlayFrame: number,
        frameCycle: number = 0,
    ): void {
        if (!baseType) {
            if (overlayType) {
                this.applySingleSequenceToModel(
                    model,
                    overlayType,
                    overlaySeqId | 0,
                    overlayFrame | 0,
                    frameCycle | 0,
                );
            }
            return;
        }
        if (!overlayType) {
            this.applySingleSequenceToModel(
                model,
                baseType,
                baseSeqId | 0,
                baseFrame | 0,
                frameCycle | 0,
            );
            return;
        }

        const baseCached = !!baseType.isSkeletalSeq?.();
        const overlayCached = !!overlayType.isSkeletalSeq?.();

        if (baseCached) {
            const baseSkeletal = this.skeletalSeqLoader?.load(baseType.skeletalId);
            if (!baseSkeletal) return;

            const baseDuration = Math.max(1, baseType.getSkeletalDuration() | 0);
            const baseLocal = Math.max(0, baseFrame | 0) % baseDuration;

            if (overlayCached) {
                if (!Array.isArray(baseType?.skeletalMasks)) {
                    model.animateSkeletal(baseSkeletal, baseLocal | 0);
                    return;
                }

                const overlaySkeletal = this.skeletalSeqLoader?.load(overlayType.skeletalId);
                if (!overlaySkeletal) {
                    model.animateSkeletal(baseSkeletal, baseLocal | 0);
                    return;
                }

                const overlayDuration = Math.max(1, overlayType.getSkeletalDuration() | 0);
                const overlayLocal = Math.max(0, overlayFrame | 0) % overlayDuration;

                model.animateSkeletalComposite(baseSkeletal, baseLocal | 0, {
                    masks: baseType.skeletalMasks,
                    overlay: { seq: overlaySkeletal, frame: overlayLocal | 0 },
                });
                return;
            }

            if (Array.isArray(baseType?.skeletalMasks)) {
                model.animateSkeletal(baseSkeletal, baseLocal | 0, {
                    masks: baseType.skeletalMasks,
                    maskMatch: false,
                });
            } else {
                model.animateSkeletal(baseSkeletal, baseLocal | 0);
            }

            this.applyFrameOverlayToModel(model, baseType, overlayType, overlayFrame | 0);
            return;
        }

        if (!baseType.frameIds || baseType.frameIds.length <= 0) {
            return;
        }
        const baseIds = baseType.frameIds as number[];
        const baseIdx = Math.max(0, baseFrame | 0) % (baseIds.length | 0);
        const baseSeqFrame = this.seqFrameLoader.load(baseIds[baseIdx] | 0);
        if (!baseSeqFrame) {
            return;
        }

        const interleave = Array.isArray(baseType?.masks)
            ? (baseType.masks as number[])
            : undefined;

        if (overlayCached) {
            if (!interleave || interleave.length === 0) {
                model.animate(baseSeqFrame, undefined, !!baseType.op14);
                return;
            }

            const overlaySkeletal = this.skeletalSeqLoader?.load(overlayType.skeletalId);
            if (!overlaySkeletal) {
                model.animate(baseSeqFrame, undefined, !!baseType.op14);
                return;
            }

            const overlayDuration = Math.max(1, overlayType.getSkeletalDuration() | 0);
            const overlayLocal = Math.max(0, overlayFrame | 0) % overlayDuration;

            model.animateSkeletal(overlaySkeletal, overlayLocal | 0, {
                masks: Array.isArray(baseType?.skeletalMasks) ? baseType.skeletalMasks : undefined,
                maskMatch: true,
                applyAlpha: false,
            });
            model.animateInterleavedFrame(baseSeqFrame, !!baseType.op14, interleave, false);
            return;
        }

        if (
            !overlayType.frameIds ||
            overlayType.frameIds.length <= 0 ||
            !interleave ||
            interleave.length === 0
        ) {
            model.animate(baseSeqFrame, undefined, !!baseType.op14);
            return;
        }

        const overlayIds = overlayType.frameIds as number[];
        const overlayIdx = Math.max(0, overlayFrame | 0) % (overlayIds.length | 0);
        const overlaySeqFrame = this.seqFrameLoader.load(overlayIds[overlayIdx] | 0);
        if (!overlaySeqFrame) {
            model.animate(baseSeqFrame, undefined, !!baseType.op14);
            return;
        }

        model.animateInterleavedFrames(
            baseSeqFrame,
            !!baseType.op14,
            overlaySeqFrame,
            !!overlayType.op14,
            interleave,
        );
    }

    private applySingleSequenceToModel(
        model: Model,
        seqType: SeqType,
        seqId: number,
        frame: number,
        frameCycle: number = 0,
    ): void {
        if (seqType.isSkeletalSeq()) {
            const skeletalSeq = this.skeletalSeqLoader?.load(seqType.skeletalId);
            if (!skeletalSeq) {
                return;
            }
            const duration = Math.max(1, seqType.getSkeletalDuration() | 0);
            const localFrame = Math.max(0, frame | 0) % duration;
            model.animateSkeletal(skeletalSeq, localFrame | 0);
            return;
        }

        if (!seqType.frameIds || seqType.frameIds.length === 0) {
            return;
        }

        const frameIds = seqType.frameIds as number[];
        const idx = Math.max(0, frame | 0) % (frameIds.length | 0);
        const seqFrame = this.seqFrameLoader.load(frameIds[idx] | 0);
        if (!seqFrame) return;
        // Animation smoothing: blend `frameCycle` cycles of the way toward the next frame.
        const nextFrame =
            frameCycle > 0 && idx + 1 < frameIds.length
                ? this.seqFrameLoader.load(frameIds[idx + 1] | 0)
                : undefined;
        const length = nextFrame ? seqType.getFrameLength(this.seqFrameLoader, idx) | 0 : 0;
        if (nextFrame && length > 0) {
            const alpha = Math.min(1, frameCycle / length);
            model.animateInterpolated(seqFrame, nextFrame, alpha, !!seqType.op14);
        } else {
            model.animate(seqFrame, undefined, !!seqType.op14);
        }
    }

    private applyFrameOverlayToModel(
        model: Model,
        baseType: SeqType,
        overlayType: SeqType,
        overlayFrame: number,
    ): void {
        if (!overlayType.frameIds || overlayType.frameIds.length <= 0) {
            return;
        }

        const overlayIds = overlayType.frameIds as number[];
        const overlayIdx = Math.max(0, overlayFrame | 0) % (overlayIds.length | 0);
        const overlaySeqFrame = this.seqFrameLoader.load(overlayIds[overlayIdx] | 0);
        if (!overlaySeqFrame) {
            return;
        }

        const interleave = Array.isArray(baseType?.masks)
            ? (baseType.masks as number[])
            : undefined;
        if (interleave && interleave.length > 0) {
            model.animateInterleavedFrame(overlaySeqFrame, !!overlayType.op14, interleave, true);
        } else {
            model.animate(overlaySeqFrame, undefined, !!overlayType.op14);
        }
    }

    transformNpcModel(model: Model, seqType: SeqType, frame: number): Model {
        if (seqType.isSkeletalSeq()) {
            const skeletalSeq = this.skeletalSeqLoader?.load(seqType.skeletalId);
            if (!skeletalSeq) {
                return Model.copyAnimated(model, true, true);
            }
            model = Model.copyAnimated(model, !skeletalSeq.hasAlphaTransform, true);

            const duration = Math.max(1, seqType.getSkeletalDuration() | 0);
            const localFrame = Math.max(0, frame | 0) % duration;
            // cached sequences use the local frame index (no start offset at render time).
            model.animateSkeletal(skeletalSeq, localFrame | 0);
        } else {
            if (!seqType.frameIds || seqType.frameIds.length === 0) {
                return Model.copyAnimated(model, true, true);
            }

            const seqFrame = this.seqFrameLoader.load(seqType.frameIds[frame]);

            if (seqFrame) {
                model = Model.copyAnimated(
                    model,
                    !seqFrame.hasAlphaTransform,
                    !seqFrame.hasColorTransform,
                );

                model.animate(seqFrame, undefined, seqType.op14);
            }
        }

        return model;
    }

    clearCache(): void {
        this.modelCache.clear();
    }
}
