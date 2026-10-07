import type { NpcEcs } from "../ecs/NpcEcs";
import type { ForcedMovementUpdate } from "./PlayerSyncTypes";

/**
 * Starts an NPC's exact move from its update block. The tiles are relative to the tile the NPC
 * now stands on (the server teleports it there the same tick), and the cycles are absolute, so
 * `clientCycle` is the cycle the block was decoded against. NPC positions are their centres.
 */
export function applyNpcExactMove(
    npcEcs: NpcEcs,
    ecsId: number,
    move: ForcedMovementUpdate,
    clientCycle: number,
): void {
    const state = npcEcs.getServerState(ecsId);
    if (!state) return;
    const centre = Math.max(1, npcEcs.getSize(ecsId) | 0) << 6;
    const startTileX = (state.tileX + (move.startDeltaX | 0)) | 0;
    const startTileY = (state.tileY + (move.startDeltaY | 0)) | 0;
    const endTileX = (state.tileX + (move.endDeltaX | 0)) | 0;
    const endTileY = (state.tileY + (move.endDeltaY | 0)) | 0;
    const endX = (endTileX << 7) + centre;
    const endY = (endTileY << 7) + centre;
    npcEcs.startExactMove(
        ecsId,
        (move.startCycle - clientCycle) | 0,
        (move.endCycle - clientCycle) | 0,
        (startTileX << 7) + centre,
        (startTileY << 7) + centre,
        endX,
        endY,
        move.direction & 2047,
    );
    npcEcs.setServerState(ecsId, { ...state, subX: endX, subY: endY, tileX: endTileX, tileY: endTileY });
}
