import type { NPC } from "@runelite/api/Client";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import { clearHintArrow, hintArrow, setHintArrowNpc, setHintArrowTile } from "../../game/HintArrow";

/** RuneLite's HintArrowType values, as `hintArrow.type` encodes them. */
const HINT_NPC = 1;

/** OSRS's tile hint: a height byte of 100 and the centre position (2) with the plane in the low bits. */
const TILE_HINT_HEIGHT = 100;
const TILE_HINT_CENTRE = 2;

/** `Client.setHintArrow(npc | WorldPoint)`: an NPC hint by server index, or a tile hint at its centre. */
export function setHintArrow(target: NPC | WorldPoint): void {
    if (target instanceof WorldPoint) {
        setHintArrowTile(target.getX(), target.getY(), TILE_HINT_HEIGHT, (TILE_HINT_CENTRE << 2) | (target.getPlane() & 3));
        return;
    }
    setHintArrowNpc(target.getIndex());
}

export { clearHintArrow };

/** The server index of the hinted NPC, or -1 when the hint is not an NPC hint. */
export function hintArrowNpcIndex(): number {
    return hintArrow.type === HINT_NPC ? hintArrow.npcId | 0 : -1;
}
