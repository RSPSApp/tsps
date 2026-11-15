/**
 * Whether the world menu's interaction pass is held back right now (check.ts).
 *
 * A menu that just opened must not be rebuilt or closed by the hover pass for `cooldownFrames` frames, so
 * the pass returns early until then. A right-click pick (`picked`) builds the menu itself, so it is never
 * held back: otherwise a pick within the cooldown of the previous menu waits for it, and because the
 * cooldown counts frames that wait is 10 frames: ~333 ms at 30 FPS against ~83 ms at 120 FPS.
 * A left click always runs the pass, as before.
 */
export interface MenuCooldownInput {
    mouseX: number;
    mouseY: number;
    frameCount: number;
    menuOpenedFrame: number;
    cooldownFrames: number;
    leftClicked: boolean;
    picked: boolean;
}

export function menuCooldownBlocksPass(input: MenuCooldownInput): boolean {
    if (input.leftClicked) return false;
    if (input.mouseX === -1 || input.mouseY === -1) return true;
    return !input.picked && input.frameCount - input.menuOpenedFrame < input.cooldownFrames;
}
