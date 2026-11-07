import { Polygon, type Point } from "@runelite/awt/Shapes";
import { ClientState } from "../../game/ClientState";
import type { MinimapGeometry, SceneGeometry } from "../../game/scene/SceneGeometry";
import type { NPC } from "./Client";
import type { WorldPoint } from "./coords/WorldPoint";

/** Local units a tile (RuneLite's Perspective.LOCAL_TILE_SIZE). */
export const LOCAL_TILE_SIZE = 128;

/** The engine state RuneLite's Perspective needs: the renderer's scene geometry and the minimap. */
export interface PerspectiveClient {
    sceneGeometry?: SceneGeometry;
    minimapGeometry?: MinimapGeometry;
    npcEcs?: { getEcsIdForServer(serverId: number): number | undefined; getX(id: number): number; getY(id: number): number; getLevel(id: number): number; getNpcTypeId(id: number): number };
    npcTypeLoader?: { load(id: number): { size?: number } | undefined };
}

const toPoint = (p: readonly [number, number] | undefined): Point | null => (p ? { x: p[0], y: p[1] } : null);

/** RuneLite's Perspective: world tiles to canvas pixels through the active renderer. */
export const Perspective = {
    /** The tile's four corners on the canvas, or null off-screen (getCanvasTilePoly). */
    getCanvasTilePoly(client: PerspectiveClient, point: WorldPoint, size = 1): Polygon | null {
        return Perspective.getCanvasTileAreaPoly(client, point.getX(), point.getY(), point.getPlane(), size);
    },

    /** A size x size tile area from its south-west corner (getCanvasTileAreaPoly). */
    getCanvasTileAreaPoly(client: PerspectiveClient, x: number, y: number, plane: number, size: number): Polygon | null {
        const scene = client.sceneGeometry;
        if (!scene) return null;
        const corners: Array<[number, number]> = [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
        const out: Array<[number, number]> = [];
        for (const [cx, cy] of corners) {
            const p = scene.worldToScreen(cx, scene.tileHeight(cx, cy, plane), cy);
            if (!p) return null;
            out.push([p[0], p[1]]);
        }
        return new Polygon(out);
    },

    /** The canvas point above a tile's centre, `zOffset` local units up (localToCanvas). */
    localToCanvas(client: PerspectiveClient, point: WorldPoint, zOffset: number): Point | null {
        const scene = client.sceneGeometry;
        if (!scene) return null;
        const cx = point.getX() + 0.5, cy = point.getY() + 0.5;
        // Scene heights are tiles, negative upwards; RuneLite's zOffset is in local units above the ground.
        const height = scene.tileHeight(cx, cy, point.getPlane()) - zOffset / LOCAL_TILE_SIZE;
        return toPoint(scene.worldToScreen(cx, height, cy));
    },

    /** Where an image's top left goes so it is centred above a tile (getCanvasImageLocation). */
    getCanvasImageLocation(client: PerspectiveClient, point: WorldPoint, image: { width: number; height: number }, zOffset: number): Point | null {
        const p = Perspective.localToCanvas(client, point, zOffset);
        return p ? { x: p.x - Math.trunc(image.width / 2), y: p.y - Math.trunc(image.height / 2) } : null;
    },

    /** Where text's baseline start goes so it is centred above a tile (getCanvasTextLocation). */
    getCanvasTextLocation(client: PerspectiveClient, point: WorldPoint, textWidth: number, zOffset: number): Point | null {
        const p = Perspective.localToCanvas(client, point, zOffset);
        return p ? { x: p.x - Math.trunc(textWidth / 2), y: p.y } : null;
    },

    /** An NPC's tile polygon from its live position and size (Actor.getCanvasTilePoly). */
    getActorTilePoly(client: PerspectiveClient, actor: NPC): Polygon | null {
        const scene = client.sceneGeometry;
        const npcs = client.npcEcs;
        if (!scene || !npcs) return null;
        const ecsId = npcs.getEcsIdForServer(actor.getIndex());
        if (ecsId === undefined) return null;
        const size = Math.max(1, client.npcTypeLoader?.load(npcs.getNpcTypeId(ecsId) | 0)?.size ?? 1);
        const cx = npcs.getX(ecsId) / LOCAL_TILE_SIZE, cy = npcs.getY(ecsId) / LOCAL_TILE_SIZE;
        return Perspective.getCanvasTileAreaPoly(client, cx - size / 2, cy - size / 2, npcs.getLevel(ecsId) | 0, size);
    },

    /** Where an image goes above an NPC (Actor.getCanvasImageLocation). */
    getActorImageLocation(client: PerspectiveClient, actor: NPC, image: { width: number; height: number }, zOffset: number): Point | null {
        const scene = client.sceneGeometry;
        const npcs = client.npcEcs;
        if (!scene || !npcs) return null;
        const ecsId = npcs.getEcsIdForServer(actor.getIndex());
        if (ecsId === undefined) return null;
        const cx = npcs.getX(ecsId) / LOCAL_TILE_SIZE, cy = npcs.getY(ecsId) / LOCAL_TILE_SIZE;
        const plane = npcs.getLevel(ecsId) | 0;
        const p = toPoint(scene.worldToScreen(cx, scene.tileHeight(cx, cy, plane) - zOffset / LOCAL_TILE_SIZE, cy));
        return p ? { x: p.x - Math.trunc(image.width / 2), y: p.y - Math.trunc(image.height / 2) } : null;
    },

    /** The tile's centre on the minimap, or null when the minimap is hidden or the tile is beyond it (localToMinimap). */
    localToMinimap(client: PerspectiveClient, point: WorldPoint): Point | null {
        const minimap = client.minimapGeometry;
        if (!minimap || minimap.plane !== ClientState.plane) return null;
        return toPoint(minimap.worldToMinimap(point.getX() + 0.5, point.getY() + 0.5));
    },
};
