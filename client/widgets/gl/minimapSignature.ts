import { ClientState } from "../../game/ClientState";
import { hintArrow } from "../../game/HintArrow";

/**
 * Longest the minimap goes without a redraw while nothing it shows has changed. Its own draw
 * refreshes `minimapGeometry.drawnAt`, which minimap plugin overlays treat as stale after
 * 500 ms; it also picks up what the signature leaves out (a tile image finishing loading, a
 * friend's dot colour, an NPC's map-dot varbit).
 */
export const MINIMAP_REFRESH_MS = 200;

/** The parts of the client the minimap signature reads (OsrsClient fits it). */
export type MinimapSignatureSource = {
    controlledPlayerServerId: number;
    minimapZoom?: number;
    camera?: { yaw?: number };
    playerMovementSync?: { getState?: (serverId: number) => { level?: number } | undefined };
    playerEcs?: {
        getIndexForServerId?: (serverId: number) => number | undefined;
        getAllServerIds?: () => Iterable<number>;
        getX: (index: number) => number;
        getY: (index: number) => number;
        getLevel?: (index: number) => number;
        getWorldViewId?: (index: number) => number;
        getIsHidden?: (index: number) => boolean;
    };
    npcEcs?: {
        getAllActiveIds?: () => Iterable<number>;
        getX: (id: number) => number;
        getY: (id: number) => number;
        getMapId: (id: number) => number;
        getLevel?: (id: number) => number;
        getNpcTypeId?: (id: number) => number;
    };
    groundItems?: { getVersion?: () => number };
};

const mix = (hash: number, value: number): number => Math.imul(hash ^ (value | 0), 0x01000193);

/**
 * A hash of everything the minimap draws from frame to frame: the player's position, plane and
 * camera yaw, zoom, the destination flag, and every player, NPC and ground item dot. NaN (never
 * equal) while it cannot tell, so the minimap redraws: on a boat (the deck moves under the
 * player), or with a hint arrow up (it blinks and follows its target).
 */
export function minimapSignature(client: MinimapSignatureSource): number {
    if (hintArrow.type !== 0) return NaN;
    const players = client.playerEcs;
    const localId = client.controlledPlayerServerId | 0;
    let h = 0x811c9dc5;
    if (players) {
        const local = players.getIndexForServerId?.(localId);
        if (local !== undefined && local >= 0) {
            if (((players.getWorldViewId?.(local) ?? -1) | 0) >= 0) return NaN;
            h = mix(h, players.getX(local));
            h = mix(h, players.getY(local));
            h = mix(h, players.getIsHidden?.(local) ? 1 : 0);
        }
    }
    h = mix(h, client.playerMovementSync?.getState?.(localId)?.level ?? -1);
    h = mix(h, Math.round((client.camera?.yaw ?? 0) * 64));
    h = mix(h, Math.round((client.minimapZoom ?? 4) * 1024));
    h = mix(h, ClientState.destinationWorldX);
    h = mix(h, ClientState.destinationWorldY);
    if (players?.getAllServerIds) {
        for (const id of players.getAllServerIds()) {
            if (id === localId) continue;
            const index = players.getIndexForServerId?.(id);
            if (index === undefined || index < 0) continue;
            h = mix(h, id);
            h = mix(h, players.getX(index));
            h = mix(h, players.getY(index));
            h = mix(h, players.getLevel?.(index) ?? 0);
            h = mix(h, players.getIsHidden?.(index) ? 1 : 0);
        }
    }
    const npcs = client.npcEcs;
    if (npcs?.getAllActiveIds) {
        for (const id of npcs.getAllActiveIds()) {
            h = mix(h, id);
            h = mix(h, npcs.getX(id));
            h = mix(h, npcs.getY(id));
            h = mix(h, npcs.getMapId(id));
            h = mix(h, npcs.getLevel?.(id) ?? 0);
            h = mix(h, npcs.getNpcTypeId?.(id) ?? -1);
        }
    }
    h = mix(h, client.groundItems?.getVersion?.() ?? 0);
    return h >>> 0;
}
