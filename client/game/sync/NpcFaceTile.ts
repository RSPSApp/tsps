import type { NpcEcs } from "../ecs/NpcEcs";
import { computeFacingRotation } from "../utils/rotation";

/**
 * Turns an NPC once towards a world tile (OSRS npc face coord). As with positions, the tile is
 * offset by the NPC's size: a 5x5 sent the corner tile it will stop on faces straight along its
 * path (the Doom of Mokhaiotl's capture). Only its target rotation is set: it turns at its own
 * speed and keeps that facing until something else turns it.
 */
export function applyNpcFaceTile(npcEcs: NpcEcs, ecsId: number, tile: { x: number; y: number }): void {
    const offset = Math.max(1, npcEcs.getSize(ecsId) | 0) << 6;
    const dx = (npcEcs.getWorldX(ecsId) | 0) - (((tile.x | 0) << 7) + offset);
    const dy = (npcEcs.getWorldY(ecsId) | 0) - (((tile.y | 0) << 7) + offset);
    const rotation = computeFacingRotation(dx, dy);
    if (rotation !== undefined) npcEcs.setTargetRot(ecsId, rotation);
}
