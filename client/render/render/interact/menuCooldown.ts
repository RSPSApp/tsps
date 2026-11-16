/**
 * Whether the world menu's interaction pass is held back right now (check.ts).
 *
 * A menu that just opened must not be rebuilt or closed by the hover pass for `cooldownFrames` frames, so
 * the pass returns early until then. A right-click pick is a one-frame pulse (InputManager.onFrameStart moves
 * clickMode1 to clickMode3 and clears it every frame; pickX/pickY read only while it is RIGHT), so a pick that
 * arrives inside the cooldown was dropped: that right-click opened no menu, and the player had to click again
 * once the cooldown had passed. The cooldown counts frames, so that is 10 frames: ~333 ms at 30 FPS against
 * ~83 ms at 120 FPS. A pick builds the menu itself, so a desktop pick is never held back. A touch pick (a
 * long press sets the same RIGHT click) keeps the cooldown as before. A left click always runs the pass.
 */
export interface MenuCooldownInput {
    mouseX: number;
    mouseY: number;
    frameCount: number;
    menuOpenedFrame: number;
    cooldownFrames: number;
    leftClicked: boolean;
    picked: boolean;
    touch: boolean;
}

export function menuCooldownBlocksPass(input: MenuCooldownInput): boolean {
    if (input.leftClicked) return false;
    if (input.mouseX === -1 || input.mouseY === -1) return true;
    const pickBypasses = input.picked && !input.touch;
    return !pickBypasses && input.frameCount - input.menuOpenedFrame < input.cooldownFrames;
}
