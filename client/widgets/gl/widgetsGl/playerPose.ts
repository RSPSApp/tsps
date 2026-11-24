/**
 * Whether a model widget is drawn in the local player's live pose:
 *  - content type 328 (the local player's model), when it has no sequence of its own;
 *  - model type 7 (a player composition: the worn-equipment and makeover previews), always.
 *    OSRS poses that model with the local player's idle animation at its current frame and
 *    ignores the widget's own sequence.
 */
export function usesLocalPlayerPose(
    w: { contentType?: number; modelType?: number; isPlayerModel?: boolean },
    sequenceId: number | undefined,
): boolean {
    if (((w.modelType ?? 0) | 0) === 7 || w.isPlayerModel === true) return true;
    return sequenceId === undefined && ((w.contentType ?? 0) | 0) === 328;
}
