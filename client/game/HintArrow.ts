import type { OverlayUpdateArgs } from "../ui/devoverlay/Overlay";

/**
 * Server-driven OSRS hint arrow state.
 *
 * The server sends an NPC hint (type 1, the Kalphite Queen head icon), a player hint
 * (type 3, an overhead arrow riding the actor, e.g. a Castle Wars flag carrier) or a
 * tile hint (type 2). Tile hints are drawn by [TutorialHintOverlay]; actor hints join
 * the player's overhead head icons so they follow the rendered head smoothly.
 */
export interface HintArrowState {
    /** 0 = none, 1 = npc, 2 = tile, 3 = player. */
    type: number;
    npcId: number;
    /** Server id of the hinted player for type 3 hints. */
    playerId: number;
    x: number;
    y: number;
    /** OSRS's height byte for type 2 hints: the arrow sits height * 2 world units (128 a tile) up. */
    height: number;
    /** OSRS's position type for type 2 hints: 2 centre, 3 west, 4 east, 5 south, 6 north edge. */
    position: number;
    /** Floor the tile hint sits on; hints on another plane are not drawn. */
    plane: number;
}

export const hintArrow: HintArrowState = { type: 0, npcId: 0, playerId: 0, x: 0, y: 0, height: 0, position: 2, plane: 0 };
let hintArrowRevision = 0;
/** Allows optional client providers to release only their own arrow. */
export const getHintArrowRevision = (): number => hintArrowRevision;

export function setHintArrowNpc(npcId: number): void {
    hintArrowRevision++;
    hintArrow.type = 1;
    hintArrow.npcId = npcId | 0;
}

/** A tile hint: OSRS's height byte, and OSRS's position type (bits 2-4) with the plane (bits 0-1). */
export function setHintArrowTile(x: number, y: number, height: number, packed: number): void {
    hintArrowRevision++;
    hintArrow.type = 2;
    hintArrow.x = x | 0;
    hintArrow.y = y | 0;
    hintArrow.height = (height | 0) & 0xff;
    const position = ((packed | 0) >> 2) & 0x07;
    hintArrow.position = position >= 2 && position <= 6 ? position : 2;
    hintArrow.plane = (packed | 0) & 0x03;
}

/**
 * Where on its tile a tile hint points, in 1/128 tile units, as the OSRS client places it:
 * the centre, or the middle of the west, east, south or north edge.
 */
export function hintArrowTileOffset(position: number): [number, number] {
    switch (position) {
        case 3: return [0, 64];
        case 4: return [128, 64];
        case 5: return [64, 0];
        case 6: return [64, 128];
        default: return [64, 64];
    }
}

/** An overhead arrow over a specific player, for as long as the server keeps sending it. */
export function setHintArrowPlayer(playerId: number): void {
    hintArrowRevision++;
    hintArrow.type = 3;
    hintArrow.playerId = playerId | 0;
}

export function clearHintArrow(): void {
    hintArrowRevision++;
    hintArrow.type = 0;
}

/** Native blink: visible while `gameCycle % 20 < 10`, with gameCycle ticking every 20ms. */
export function isHintArrowBlinkOn(): boolean {
    return Math.floor(performance.now() / 20) % 20 < 10;
}

type NpcOverlayAnchorResolver = (
    ecsId: number,
    baseWorldX: number,
    baseWorldZ: number,
    npcTypeId: number,
) => { worldX: number; worldZ: number; logicalHeightTiles: number };

/**
 * Where the NPC (type 1) or tile (type 2) hint arrow's anchor lands on screen, shared by the
 * WebGL TutorialHintOverlay and the WebGPU HintArrowLayer. Undefined when there is nothing to draw.
 */
export function hintArrowScreenPoint(
    args: OverlayUpdateArgs,
    client: any,
    resolveNpcOverlayAnchor: NpcOverlayAnchorResolver | undefined,
): [number, number] | undefined {
    const helpers = args.helpers;
    if (!helpers?.worldToScreen) return undefined;
    let worldX: number;
    let worldY: number;
    let plane: number;
    let heightOffsetTiles: number;
    if (hintArrow.type === 1) {
        // Follow the rendered (interpolated) NPC like the native head icons do.
        const npcEcs = client?.npcEcs;
        const ecsId = npcEcs?.getEcsIdForServer?.(hintArrow.npcId);
        if (ecsId === undefined || ecsId < 0) return undefined;
        const mid = npcEcs.getMapId(ecsId) | 0;
        const typeId = npcEcs.getNpcTypeId(ecsId) | 0;
        // Native: worldToScreenActor(npc, getLogicalHeightWithAnimationOffset() + 15).
        const anchor = resolveNpcOverlayAnchor?.(
            ecsId,
            ((mid >> 8) & 0xff) * 64 + (npcEcs.getX(ecsId) | 0) / 128,
            (mid & 0xff) * 64 + (npcEcs.getY(ecsId) | 0) / 128,
            typeId,
        );
        if (!anchor) return undefined;
        worldX = anchor.worldX;
        worldY = anchor.worldZ;
        plane = npcEcs.getLevel(ecsId) | 0;
        heightOffsetTiles = anchor.logicalHeightTiles + 15 / 128;
    } else if (hintArrow.type === 2) {
        // Tile hints carry their own floor: another floor's target is not drawn here.
        const localPlane = args.state.playerLevel ?? 0;
        if ((hintArrow.plane | 0) !== localPlane) return undefined;
        // As the OSRS client: the tile's centre or edge, `height * 2` world units up.
        const [subX, subY] = hintArrowTileOffset(hintArrow.position);
        worldX = hintArrow.x + subX / 128;
        worldY = hintArrow.y + subY / 128;
        plane = localPlane;
        heightOffsetTiles = ((hintArrow.height | 0) * 2) / 128;
    } else {
        // Actor hints (type 3) are overhead head icons, drawn with the other head icons.
        return undefined;
    }

    // Scene Y points down, so "up" is ground minus the offset.
    const ground = helpers.getMinTileHeightInRadius?.(worldX, worldY, plane, 0) ?? 0;
    const screen = helpers.worldToScreen(worldX, ground - heightOffsetTiles, worldY) as
        | number[]
        | Float32Array
        | undefined;
    if (!screen || typeof screen[0] !== "number" || typeof screen[1] !== "number") return undefined;
    return [screen[0], screen[1]];
}
