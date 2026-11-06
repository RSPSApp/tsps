import { ClientState } from "../../../game/ClientState";

/** Tiles on a scene side (RuneLite's Constants.SCENE_SIZE). */
const SCENE_SIZE = 104;

/** RuneLite's REGION_MIRRORS: Prifddinas's real regions paired with their overworld map copies. */
const REGION_MIRRORS = [12894, 8755, 12895, 8756, 13150, 9011, 13151, 9012];

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

    /** The tile at an offset inside a 64x64 map region (RuneLite's fromRegion). */
    static fromRegion(regionId: number, regionX: number, regionY: number, plane: number): WorldPoint {
        return new WorldPoint(((regionId >>> 8) << 6) + regionX, ((regionId & 0xff) << 6) + regionY, plane);
    }

    /**
     * RuneLite's getMirrorPoint: the same tile in the paired Prifddinas region (the real city and
     * its overworld map copy are mirrors). `toOverworld` converts from the real region to the map
     * copy; a tile outside the mirrored regions is returned unchanged.
     */
    static getMirrorPoint(point: WorldPoint, toOverworld: boolean): WorldPoint {
        const region = point.getRegionID();
        for (let i = 0; i < REGION_MIRRORS.length; i += 2) {
            const real = REGION_MIRRORS[i], overworld = REGION_MIRRORS[i + 1];
            if (region === (toOverworld ? real : overworld)) {
                return WorldPoint.fromRegion(toOverworld ? overworld : real, point.getRegionX(), point.getRegionY(), point.plane);
            }
        }
        return point;
    }
}
