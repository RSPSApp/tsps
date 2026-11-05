/**
 * OSRS draws "Loading - please wait." over its last frame while it loads a map. This client builds
 * squares in workers, so after a teleport the camera reached the destination before anything there
 * could be drawn, and the game showed the bare sky colour for a second or more (issue #2017). While
 * the player's own square can't be drawn, the renderers present the last scene they drew instead,
 * with the interface and the loading box drawn over it as usual.
 */
export class SceneFrameHold {
    /** A square that never builds shouldn't freeze the view: past this, the live scene is drawn. */
    static readonly MAX_HOLD_MS = 10_000;

    private holdingSinceMs = -1;

    /**
     * Whether this frame presents the held scene instead of drawing one. `heldFrameValid` is
     * whether the renderer still has a scene from a frame whose square was ready, at this size.
     */
    update(heldFrameValid: boolean, squareReady: boolean, nowMs: number): boolean {
        if (squareReady) {
            this.holdingSinceMs = -1;
            return false;
        }
        if (!heldFrameValid) return false;
        if (this.holdingSinceMs < 0) this.holdingSinceMs = nowMs;
        return nowMs - this.holdingSinceMs < SceneFrameHold.MAX_HOLD_MS;
    }

    reset(): void {
        this.holdingSinceMs = -1;
    }
}
