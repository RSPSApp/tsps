import { ClientState } from "../../../game/ClientState";

/** Tiles on a scene side and on a chunk side (RuneLite's Constants.SCENE_SIZE / CHUNK_SIZE). */
const SCENE_SIZE = 104;
const CHUNK_SIZE = 8;

/** The scene base the client last loaded, read live so a point can tell whether it is in the scene. */
export interface SceneBaseSource {
    getBaseX?(): number;
    getBaseY?(): number;
}

/** An absolute tile: x, y and plane (RuneLite's net.runelite.api.coords.WorldPoint). */
export class WorldPoint {
    constructor(
        readonly x: number,
        readonly y: number,
        readonly plane: number,
    ) {}

    getX(): number {
        return this.x;
    }

    getY(): number {
        return this.y;
    }

    getPlane(): number {
        return this.plane;
    }

    /** The 64x64 map region this tile is in (RuneLite's getRegionID). */
    getRegionID(): number {
        return ((this.x >> 6) << 8) | (this.y >> 6);
    }

    getRegionX(): number {
        return this.x & 63;
    }

    getRegionY(): number {
        return this.y & 63;
    }

    /** Chebyshev distance, or MAX_SAFE_INTEGER across planes (RuneLite's distanceTo). */
    distanceTo(other: WorldPoint): number {
        if (other.plane !== this.plane) return Number.MAX_SAFE_INTEGER;
        return this.distanceTo2D(other);
    }

    distanceTo2D(other: WorldPoint): number {
        return Math.max(Math.abs(this.x - other.x), Math.abs(this.y - other.y));
    }

    dx(dx: number): WorldPoint {
        return new WorldPoint(this.x + dx, this.y, this.plane);
    }

    dy(dy: number): WorldPoint {
        return new WorldPoint(this.x, this.y + dy, this.plane);
    }

    equals(other: WorldPoint | null | undefined): boolean {
        return !!other && other.x === this.x && other.y === this.y && other.plane === this.plane;
    }

    toString(): string {
        return `WorldPoint(x=${this.x}, y=${this.y}, plane=${this.plane})`;
    }

    /** Whether the tile is inside the loaded scene (RuneLite's isInScene: its local point exists). */
    isInScene(_client?: unknown): boolean {
        const baseX = ClientState.baseX, baseY = ClientState.baseY;
        return this.x >= baseX && this.x < baseX + SCENE_SIZE && this.y >= baseY && this.y < baseY + SCENE_SIZE;
    }

    /**
     * The overworld tile an instance tile was copied from (RuneLite's getMirrorPoint). Outside an
     * instance, or for a tile whose chunk has no template, the point itself.
     */
    static getMirrorPoint(point: WorldPoint, toOverworld: boolean): WorldPoint {
        if (!toOverworld || !ClientState.inInstance) return point;
        const chunks = ClientState.instanceTemplateChunks;
        if (!chunks) return point;
        const sceneX = point.x - ClientState.baseX, sceneY = point.y - ClientState.baseY;
        if (sceneX < 0 || sceneY < 0 || sceneX >= SCENE_SIZE || sceneY >= SCENE_SIZE) return point;
        const template = chunks[point.plane]?.[sceneX >> 3]?.[sceneY >> 3];
        if (template === undefined || template === -1) return point;
        const rotation = (template >> 1) & 0x3;
        const templateChunkY = ((template >> 3) & 0x7ff) * CHUNK_SIZE;
        const templateChunkX = ((template >> 14) & 0x3ff) * CHUNK_SIZE;
        const templatePlane = (template >> 24) & 0x3;
        const unrotated = new WorldPoint((sceneX & 7) + templateChunkX, (sceneY & 7) + templateChunkY, templatePlane);
        return WorldPoint.rotate(unrotated, (4 - rotation) & 3);
    }

    /** Rotates a tile within its 8x8 chunk by quarter turns (RuneLite's rotate). */
    static rotate(point: WorldPoint, rotation: number): WorldPoint {
        const chunkX = point.x & ~(CHUNK_SIZE - 1), chunkY = point.y & ~(CHUNK_SIZE - 1);
        const x = point.x & (CHUNK_SIZE - 1), y = point.y & (CHUNK_SIZE - 1);
        switch (rotation & 3) {
            case 1:
                return new WorldPoint(chunkX + y, chunkY + (CHUNK_SIZE - 1 - x), point.plane);
            case 2:
                return new WorldPoint(chunkX + (CHUNK_SIZE - 1 - x), chunkY + (CHUNK_SIZE - 1 - y), point.plane);
            case 3:
                return new WorldPoint(chunkX + (CHUNK_SIZE - 1 - y), chunkY + x, point.plane);
            default:
                return point;
        }
    }
}
