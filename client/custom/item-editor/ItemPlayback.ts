import type { SeqType } from '../../rs/config/seqtype/SeqType';
export function animationTimeline(seq: SeqType): number[] {
    if (seq.isSkeletalSeq())
        return Array.from({ length: Math.max(0, seq.getSkeletalDuration()) }, (_, i) => (i + 1) * 20);
    let duration = 0;
    return (seq.frameIds ?? []).map((_, index) => {
        // The client advances at cycle > frameLength, then resets cycle to 1.
        // The first frame starts at cycle 0. One client cycle is 20 ms.
        duration += Math.max(1, (seq.frameLengths?.[index] ?? 0) + (index === 0 ? 1 : 0)) * 20;
        return duration;
    });
}
export function animationFrame(timeline: number[], elapsed: number): number {
    return timeline.findIndex(end => elapsed < end);
}
