import type { Location } from "./model/Location";

interface PlanePolicy {
    supportsPlane(plane: number): boolean;
    canSeeAcrossPlanes(viewer: number, target: number): boolean;
    combatEnabled(): boolean;
}

/** Plane checks shared by entity synchronisation, interactions and combat. */
export class CrossFloor {
    private static policy?: PlanePolicy;

    static registerPolicy(policy: PlanePolicy): void {
        CrossFloor.policy = policy;
    }

    static enabled(): boolean {
        return CrossFloor.policy !== undefined;
    }

    static combatEnabled(): boolean {
        return CrossFloor.policy?.combatEnabled() ?? false;
    }

    static includesOtherPlanes(plane: number): boolean {
        return CrossFloor.policy?.supportsPlane(plane) ?? false;
    }

    static visibleOnPlane(viewer: number, target: number): boolean {
        return viewer === target || (CrossFloor.policy?.canSeeAcrossPlanes(viewer, target) ?? false);
    }

    static distance(a: Location, b: Location): number {
        return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
    }
    /** Projectile travel follows OSRS's horizontal Chebyshev tile distance on every floor. */
    static projectileDistance(a: Location, b: Location): number {
        return CrossFloor.distance(a, b);
    }
    static canCross(a: Location, b: Location): boolean {
        return CrossFloor.combatEnabled() && CrossFloor.includesOtherPlanes(a.getZ()) && CrossFloor.includesOtherPlanes(b.getZ());
    }
    static visible(viewer: Location, target: Location, range: number): boolean {
        return CrossFloor.visibleOnPlane(viewer.getZ(), target.getZ()) && CrossFloor.distance(viewer, target) <= range;
    }

    static projectileVisible(viewer: Location, target: Location, range: number): boolean {
        return CrossFloor.visible(viewer, target, range);
    }
}
