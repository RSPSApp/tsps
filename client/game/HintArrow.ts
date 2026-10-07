/**
 * Server-driven OSRS hint arrow state.
 *
 * The server sends either an NPC hint (type 1, target follows the actor like the
 * Kalphite Queen head icon) or a tile hint (type 2). [TutorialHintOverlay]
 * renders the native yellow `headicons_hint` sprite above the target.
 */
export interface HintArrowState {
    /** 0 = none, 1 = npc, 2 = tile. */
    type: number;
    npcId: number;
    x: number;
    y: number;
    /** Height above the tile in tiles for type 2 hints (0 = ground level). */
    height: number;
}

export const hintArrow: HintArrowState = { type: 0, npcId: 0, x: 0, y: 0, height: 0 };

export function setHintArrowNpc(npcId: number): void {
    hintArrow.type = 1;
    hintArrow.npcId = npcId | 0;
}

export function setHintArrowTile(x: number, y: number, height: number): void {
    hintArrow.type = 2;
    hintArrow.x = x | 0;
    hintArrow.y = y | 0;
    hintArrow.height = height | 0;
}

export function clearHintArrow(): void {
    hintArrow.type = 0;
}

/** Native blink: visible while `gameCycle % 20 < 10`, with gameCycle ticking every 20ms. */
export function isHintArrowBlinkOn(): boolean {
    return Math.floor(performance.now() / 20) % 20 < 10;
}
