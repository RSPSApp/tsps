import type { Location } from "./model/Location";

/** Optional cross-floor visibility and ranged combat. Read after environment setup. */
export class CrossFloor {
    /** Legacy combined switch remains supported when the newer switches are unset. */
    private static legacyEnabled(): boolean { return process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT === "1"; }
    static enabled(): boolean {
        return process.env.CROSS_FLOOR_VISIBILITY === undefined
            ? CrossFloor.legacyEnabled()
            : process.env.CROSS_FLOOR_VISIBILITY === "1";
    }
    static combatEnabled(): boolean {
        return process.env.CROSS_FLOOR_COMBAT === undefined
            ? (process.env.CROSS_FLOOR_VISIBILITY === undefined && CrossFloor.legacyEnabled())
            : process.env.CROSS_FLOOR_COMBAT === "1";
    }
    static distance(a: Location, b: Location): number {
        return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
    }
    /** Projectile travel follows OSRS's horizontal Chebyshev tile distance on every floor. */
    static projectileDistance(a: Location, b: Location): number {
        return CrossFloor.distance(a, b);
    }
    static canCross(a: Location, b: Location): boolean {
        return CrossFloor.combatEnabled() && a.getZ() >= 0 && a.getZ() < 4 && b.getZ() >= 0 && b.getZ() < 4;
    }
    static visible(viewer: Location, target: Location, range: number): boolean {
        const sameFloor = viewer.getZ() === target.getZ();
        const crossFloorVisible = CrossFloor.enabled() && viewer.getZ() >= 0 && viewer.getZ() < 4 &&
            target.getZ() >= 0 && target.getZ() < 4;
        return (sameFloor || crossFloorVisible) && CrossFloor.distance(viewer, target) <= range;
    }

    /** Projectiles may render across floors when enabled; actor visibility additionally checks line of sight and roofs. */
    static projectileVisible(viewer: Location, target: Location, range: number): boolean {
        const sameFloor = viewer.getZ() === target.getZ();
        const crossFloorProjectile = CrossFloor.enabled() && viewer.getZ() >= 0 && viewer.getZ() < 4 &&
            target.getZ() >= 0 && target.getZ() < 4;
        return (sameFloor || crossFloorProjectile) && CrossFloor.distance(viewer, target) <= range;
    }
}
