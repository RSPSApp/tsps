import { DrawRange } from "./DrawRange";

export type AnimationFrames = {
    frames: DrawRange[];
    framesAlpha: DrawRange[] | undefined;
    /**
     * Set when a keyframe animation is baked smoothed (Animation Smoothing): `frames` then
     * holds one blended frame per client cycle, and keyframe i's run starts at frameStarts[i].
     */
    frameStarts?: number[];
    /** The unanimated model OSRS draws after a one-shot loc sequence ends. */
    baseFrame?: number;
};
