import { Location } from "../../model/Location";
import { Boundary } from "../../model/Boundary";
import { Mobile } from "../../entity/impl/Mobile";
import { WORLD_ZONE_BOUNDARIES } from "../../definition/WorldDefinition";

import { RegionManager } from "../../collision/RegionManager";

export class Wilderness {
    // [minX, maxX, minY, maxY] - minY doubles as the level-1 line.
    private static readonly LEVELLED_AREAS = [
        [2944, 3391, 3520, 4351],
        [2944, 3455, 9920, 10879],
    ];
    /** Plugin-given levels (e.g. the Wilderness boss caves), asked before the strips above. */
    private static readonly levelSources = new Map<string, (x: number, y: number) => number | null>();

    /** Gives the level of some tiles: `source` answers a level, or null to pass. A reload replaces it by name. */
    public static setLevelSource(name: string, source: (x: number, y: number) => number | null): void {
        Wilderness.levelSources.set(name, source);
    }

    public static isInSafeBuilding(location: Location | null | undefined): boolean {
        return !!location && WORLD_ZONE_BOUNDARIES["all-buildings-safe"].some((boundary) => boundary.inside(location)) &&
            (RegionManager.getRegion(location.getX(), location.getY())
                ?.isUnderRoof(location.getX(), location.getY(), location.getZ()) ?? false);
    }

    /**
     * Any PvP-tagged ground, safe carve-outs included. The overlay hangs off this: inside a
     * PvP area you either get the skull or, in a safe spot, the skull with the red cross.
     */
    public static isPvpArea(location: Location | null | undefined): boolean {
        return !!location && WORLD_ZONE_BOUNDARIES.pvp.some((boundary) => boundary.inside(location));
    }

    public static isInLocation(location: Location | null | undefined): boolean {
        if (!location) {
            return false;
        }
        return !Wilderness.isInSafeBuilding(location) && !WORLD_ZONE_BOUNDARIES.safe.some((boundary) => boundary.inside(location))
            && Wilderness.isPvpArea(location);
    }

    /**
     * The Wilderness map's own PvP ground (world.json zones with bounds), not a PvP world's
     * global `pvp` tag. The PJ timer's 20-tick Wilderness rule follows geography; the global
     * tag only makes the whole world attackable and uses the PvP-world timer elsewhere.
     */
    public static isGeographicPvp(location: Location | null | undefined): boolean {
        if (!location) {
            return false;
        }
        if (Wilderness.isInSafeBuilding(location) || WORLD_ZONE_BOUNDARIES.safe.some((boundary) => boundary.inside(location))) {
            return false;
        }
        return WORLD_ZONE_BOUNDARIES.pvp.some((boundary) => !Wilderness.isGlobalPvpBoundary(boundary) && boundary.inside(location));
    }

    /** A PvP zone with no map bounds covers every tile (a PvP world's global tag). */
    private static isGlobalPvpBoundary(boundary: Boundary): boolean {
        return boundary.getX() <= 0 && boundary.getX2() >= 0x3fff
            && boundary.getY() <= 0 && boundary.getY2() >= 0x3fff;
    }

    public static isIn(character: Mobile | null | undefined): boolean {
        return Wilderness.isInLocation(character?.getLocation?.());
    }

    /**
     * Wilderness levels only exist on the original Wilderness map - the surface strip and the
     * caves beneath it, the same boxes cache script 384 measures the overlay level from. A PvP
     * zone anywhere else (a PvP world, a custom zone) is attackable but unlevelled, so it must
     * not inherit a level from its y.
     */
    public static levelAt(x: number, y: number): number {
        for (const source of Wilderness.levelSources.values()) {
            const level = source(x, y);
            if (level != null) {
                return level;
            }
        }
        for (const [minX, maxX, minY, maxY] of Wilderness.LEVELLED_AREAS) {
            if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
                return Math.floor((y - minY) / 8) + 1;
            }
        }
        return 0;
    }

    /** Multi-combat zones are per plane (world.json `z`); the plane defaults to the surface. */
    public static isMulti(x: number, y: number, z: number = 0): boolean {
        const location = new Location(x, y, z);
        return WORLD_ZONE_BOUNDARIES["multi-combat"].some((boundary) => boundary.inside(location));
    }

    public static intersectsArea(minX: number, maxX: number, minY: number, maxY: number, z: number): boolean {
        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
            return false;
        }
        if (!Number.isFinite(z)) {
            return false;
        }
        return WORLD_ZONE_BOUNDARIES.pvp.some((boundary) => {
            const boundaryZ = boundary.height ?? 0;
            const boundaryMinX = boundary.getX();
            const boundaryMaxX = boundary.getX2();
            const boundaryMinY = boundary.getY();
            const boundaryMaxY = boundary.getY2();
            return (
                boundaryZ === z &&
                boundaryMinX <= maxX &&
                boundaryMaxX >= minX &&
                boundaryMinY <= maxY &&
                boundaryMaxY >= minY
            );
        });
    }
}
