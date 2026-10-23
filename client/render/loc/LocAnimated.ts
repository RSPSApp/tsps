import { SeqType } from "../../rs/config/seqtype/SeqType";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { AnimationFrames } from "../AnimationFrames";

/** Plays an animated loc's frame sounds, at its tile (fine units) and level. */
export type LocFrameSoundHandler = (
    seqType: SeqType,
    frame: number,
    context: { x: number; y: number; level: number },
) => void;

export class LocAnimated {
    seqType?: SeqType;

    frame = 0;
    /** Client cycles into the current keyframe (0-based) and its length, for smoothed frames. */
    frameCycle = 0;
    frameLength = 1;
    cycleStart: number;
    private lastSoundFrame: number = -1;
    // Reusable context object for onFrameSound callback to avoid allocation
    private readonly soundContext: { x: number; y: number; level: number };

    constructor(
        readonly drawRangeIndex: number,
        readonly drawRangeAlphaIndex: number,

        readonly drawRangeLodIndex: number,
        readonly drawRangeLodAlphaIndex: number,

        readonly drawRangeInteractIndex: number,
        readonly drawRangeInteractAlphaIndex: number,

        readonly drawRangeInteractLodIndex: number,
        readonly drawRangeInteractLodAlphaIndex: number,

        readonly anim: AnimationFrames,
        seqType: SeqType,
        cycle: number,
        randomStart: boolean,

        // Position and ID for ambient sounds
        readonly id: number,
        readonly x: number,
        readonly y: number,
        readonly level: number,
        readonly rotation: number,
    ) {
        this.seqType = seqType;
        this.cycleStart = cycle - 1;
        // Initialize sound context once with position data
        this.soundContext = { x, y, level };

        if (randomStart && seqType.frameStep !== -1) {
            if (seqType.isSkeletalSeq()) {
                this.frame = Math.floor(Math.random() * seqType.getSkeletalDuration());
            } else {
                this.frame = Math.floor(Math.random() * seqType.frameIds.length);
                this.cycleStart -= Math.floor(Math.random() * seqType.frameLengths[this.frame]);
            }
        }
    }

    /**
     * A square's locs are rebuilt when one of its multilocs changes (a varbit the cache reads),
     * but the animations on them go on: OSRS keeps a loc's animation object through its transform
     * changes. Each rebuilt loc playing the same sequence on the same loc picks up where it was,
     * instead of restarting (the Giants' Foundry crucible poured twice when it emptied mid-pour).
     */
    static carryOver(previous: readonly LocAnimated[], next: readonly LocAnimated[]): void {
        if (previous.length === 0) return;
        const byLoc = new Map<string, LocAnimated>();
        for (const loc of previous) {
            if (loc.seqType) byLoc.set(loc.key(), loc);
        }
        for (const loc of next) {
            const old = byLoc.get(loc.key());
            if (!old || old.seqType?.id !== loc.seqType?.id) continue;
            loc.frame = old.frame;
            loc.frameCycle = old.frameCycle;
            loc.frameLength = old.frameLength;
            loc.cycleStart = old.cycleStart;
            loc.lastSoundFrame = old.lastSoundFrame;
        }
    }

    private key(): string {
        return `${this.id},${this.x},${this.y},${this.level},${this.rotation}`;
    }

    /**
     * The baked frame to draw. Smoothed animations (anim.frameStarts) bake a few blended steps
     * through each keyframe; otherwise it is the keyframe itself, as `frame` is.
     */
    drawFrame(): number {
        const starts = this.anim.frameStarts;
        const frame = this.frame | 0;
        if (!starts) return frame;
        const start = starts[frame] ?? 0;
        const steps = Math.max(1, (starts[frame + 1] ?? this.anim.frames.length) - start);
        // Steps are spread evenly through the keyframe (SdMapDataLoader.smoothedFrameRuns).
        const step = Math.floor(((this.frameCycle | 0) * steps) / this.frameLength);
        return start + Math.min(step, steps - 1);
    }

        getDrawRangeIndex(isAlpha: boolean, isInteract: boolean, isLod: boolean) {
        if (isInteract) {
            if (isLod) {
                return isAlpha
                    ? this.drawRangeInteractLodAlphaIndex
                    : this.drawRangeInteractLodIndex;
            } else {
                return isAlpha ? this.drawRangeInteractAlphaIndex : this.drawRangeInteractIndex;
            }
        } else {
            if (isLod) {
                return isAlpha ? this.drawRangeLodAlphaIndex : this.drawRangeLodIndex;
            } else {
                return isAlpha ? this.drawRangeAlphaIndex : this.drawRangeIndex;
            }
        }
    }

    update(
        seqFrameLoader: SeqFrameLoader,
        cycle: number,
        onFrameSound?: LocFrameSoundHandler,
    ): number {
        if (!this.seqType) {
            this.lastSoundFrame = -1;
            return 0;
        }

        const seqType = this.seqType;
        const previousFrame = this.frame;
        let elapsed = cycle - this.cycleStart;
        if (elapsed > 100 && this.seqType.frameStep > 0) {
            elapsed = 100;
        }

        if (this.seqType.isSkeletalSeq()) {
            const duration = this.seqType.getSkeletalDuration();
            this.frame += elapsed;
            elapsed = 0;
            if (this.frame >= duration) {
                this.frame = duration - this.seqType.frameStep;
                if (this.frame < 0 || this.frame > duration) {
                    this.frame = 0;
                    this.seqType = undefined;
                    return 0;
                }
            }
        } else {
            while (elapsed > this.seqType.getFrameLength(seqFrameLoader, this.frame)) {
                elapsed -= this.seqType.getFrameLength(seqFrameLoader, this.frame);
                this.frame++;
                if (this.frame >= this.seqType.frameLengths.length) {
                    this.frame -= this.seqType.frameStep;
                    if (this.frame < 0 || this.frame >= this.seqType.frameLengths.length) {
                        this.frame = 0;
                        this.cycleStart = cycle - 1;
                        this.seqType = undefined;
                        return 0;
                    }
                    continue;
                }
            }
        }

        this.cycleStart = cycle - elapsed;
        // A keyframe's cycles run 1..length here (cycleStart starts a cycle back).
        this.frameCycle = this.seqType && !this.seqType.isSkeletalSeq() ? Math.max(0, elapsed - 1) : 0;
        this.frameLength =
            this.seqType && !this.seqType.isSkeletalSeq()
                ? Math.max(1, this.seqType.getFrameLength(seqFrameLoader, this.frame) | 0)
                : 1;

        if (this.seqType && this.frame < previousFrame) {
            this.lastSoundFrame = -1;
        }

        if (this.seqType && onFrameSound && this.seqType.frameSounds?.size) {
            const currentFrame = this.frame;
            if (currentFrame !== this.lastSoundFrame) {
                const effects = this.seqType.frameSounds.get(currentFrame);
                if (effects && effects.length) {
                    // Use reusable context object to avoid allocation per call
                    onFrameSound(this.seqType, currentFrame, this.soundContext);
                }
                this.lastSoundFrame = currentFrame;
            }
        }

        return this.frame;
    }
}
