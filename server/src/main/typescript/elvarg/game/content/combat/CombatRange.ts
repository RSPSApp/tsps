import { RegionManager } from "../../collision/RegionManager";
import type { Mobile } from "../../entity/impl/Mobile";
import { Location } from "../../model/Location";
import { PathFinder } from "../../model/movement/path/PathFinder";
import { CombatType } from "./CombatType";
import type { CombatMethod } from "./method/CombatMethod";

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Footprint-aware combat reach and routing. */
export class CombatRange {
    static canReach(attacker: Mobile, method: CombatMethod, target: Mobile): boolean {
        if (!attacker || !target || attacker.getPrivateArea() !== target.getPrivateArea()) {
            return false;
        }

        const attackerLocation = attacker.getLocation();
        const targetLocation = target.getLocation();
        if (attackerLocation.getZ() !== targetLocation.getZ()) {
            return false;
        }

        const attackerBounds = this.bounds(attacker);
        const targetBounds = this.bounds(target);
        const range = Math.max(1, method.attackDistance(attacker) | 0);
        if (this.overlaps(attackerBounds, targetBounds) || this.distance(attackerBounds, targetBounds) > range) {
            return false;
        }

        if (method.type() === CombatType.MELEE) {
            return range === 1
                ? this.hasOpenSharedEdge(attackerBounds, targetBounds, attackerLocation.getZ(), attacker.getPrivateArea())
                : this.hasMeleeLine(attackerBounds, targetBounds, attackerLocation.getZ(), attacker.getPrivateArea());
        }

        if (attacker.isNpc()) {
            return this.hasProjectileLine(targetBounds, attackerBounds, target, attackerLocation.getZ());
        }

        const forward = this.hasProjectileLine(attackerBounds, targetBounds, attacker, attackerLocation.getZ());
        return forward && (!target.isPlayer() ||
            this.hasProjectileLine(targetBounds, attackerBounds, target, attackerLocation.getZ()));
    }

    static route(attacker: Mobile, method: CombatMethod, target: Mobile): boolean {
        // Route toward the moving entity itself. Combat's post-movement phase stops the queue
        // as soon as the method's real range/line-of-sight check succeeds, so this
        // naturally finds the first usable ranged, magic, or melee tile without a
        // separate geometric attack-tile heuristic.
        PathFinder.calculateEntityRoute(attacker, target);
        return attacker.getMovementQueue().hasRoute();
    }

    /**
     * Approach distance for an at-range interaction: within `range` tiles of the
     * destination with an open projectile line. This is the generic mechanic behind
     * spells and other actions that resolve without walking adjacent - use it as a
     * walk-to reach predicate so the actor closes in only until it is satisfied.
     */
    static withinApproachDistance(source: Mobile, destination: Location, range: number): boolean {
        if (!source || !destination) {
            return false;
        }
        const sourceLocation = source.getLocation();
        if (sourceLocation.getZ() !== destination.getZ()) {
            return false;
        }
        const sourceBounds = this.bounds(source);
        const destinationBounds = {
            minX: destination.getX(),
            minY: destination.getY(),
            maxX: destination.getX(),
            maxY: destination.getY(),
        };
        if (this.distance(sourceBounds, destinationBounds) > Math.max(0, range | 0)) {
            return false;
        }
        return this.hasProjectileLine(sourceBounds, destinationBounds, source, sourceLocation.getZ());
    }

    static overlapsEntities(a: Mobile, b: Mobile): boolean {
        return !!a && !!b && a.getLocation().getZ() === b.getLocation().getZ() &&
            this.overlaps(this.bounds(a), this.bounds(b));
    }

    /** A tile on the source's current side of a target, exactly `range` tiles from its footprint. */
    static rangedDestination(source: Mobile, target: Mobile, range: number): Location {
        const sourceBounds = this.bounds(source);
        const targetBounds = this.bounds(target);
        const targetLocation = target.getLocation();
        const distance = Math.max(1, range | 0);
        const closest = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

        return new Location(
            sourceBounds.maxX < targetBounds.minX ? targetBounds.minX - distance
                : sourceBounds.minX > targetBounds.maxX ? targetBounds.maxX + distance
                    : closest(source.getLocation().getX(), targetBounds.minX, targetBounds.maxX),
            sourceBounds.maxY < targetBounds.minY ? targetBounds.minY - distance
                : sourceBounds.minY > targetBounds.maxY ? targetBounds.maxY + distance
                    : closest(source.getLocation().getY(), targetBounds.minY, targetBounds.maxY),
            targetLocation.getZ(),
        );
    }

    private static bounds(entity: Mobile): Bounds {
        const location = entity.getLocation();
        const size = Math.max(1, entity.getSize() | 0);
        return {
            minX: location.getX(),
            minY: location.getY(),
            maxX: location.getX() + size - 1,
            maxY: location.getY() + size - 1,
        };
    }

    private static distance(a: Bounds, b: Bounds): number {
        return Math.max(
            0,
            b.minX - a.maxX,
            a.minX - b.maxX,
            b.minY - a.maxY,
            a.minY - b.maxY,
        );
    }

    private static overlaps(a: Bounds, b: Bounds): boolean {
        return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
    }

    private static hasOpenSharedEdge(a: Bounds, b: Bounds, z: number, area: any): boolean {
        if (a.maxX + 1 === b.minX || b.maxX + 1 === a.minX) {
            const fromX = a.maxX + 1 === b.minX ? a.maxX : a.minX;
            const toX = a.maxX + 1 === b.minX ? b.minX : b.maxX;
            for (let y = Math.max(a.minY, b.minY); y <= Math.min(a.maxY, b.maxY); y++) {
                if (this.hasOpenCardinalEdge(fromX, y, toX, y, z, area)) return true;
            }
        }
        if (a.maxY + 1 === b.minY || b.maxY + 1 === a.minY) {
            const fromY = a.maxY + 1 === b.minY ? a.maxY : a.minY;
            const toY = a.maxY + 1 === b.minY ? b.minY : b.maxY;
            for (let x = Math.max(a.minX, b.minX); x <= Math.min(a.maxX, b.maxX); x++) {
                if (this.hasOpenCardinalEdge(x, fromY, x, toY, z, area)) return true;
            }
        }
        return false;
    }

    private static hasOpenCardinalEdge(fromX: number, fromY: number, toX: number, toY: number, z: number, area: any): boolean {
        const fromMask = toX > fromX ? 0x8 : toX < fromX ? 0x80 : toY > fromY ? 0x2 : 0x20;
        const toMask = toX > fromX ? 0x80 : toX < fromX ? 0x8 : toY > fromY ? 0x20 : 0x2;
        const invalid = RegionManager.UNKNOWN | RegionManager.UNLOADED_TILE;
        return (RegionManager.getClipping(fromX, fromY, z, area) & (fromMask | invalid)) === 0
            && (RegionManager.getClipping(toX, toY, z, area) & (toMask | invalid)) === 0;
    }

    private static hasMeleeLine(a: Bounds, b: Bounds, z: number, area: any): boolean {
        const from = this.nearestTile(a, b);
        const to = this.nearestTile(b, a);
        return RegionManager.canMove(from.x, from.y, to.x, to.y, z, 1, 1, area);
    }

    private static hasProjectileLine(source: Bounds, destination: Bounds, entity: Mobile, z: number): boolean {
        return RegionManager.canProjectileAttackBounds(
            new Location(source.minX, source.minY, z),
            new Location(destination.minX, destination.minY, z),
            source.maxX - source.minX + 1,
            source.maxY - source.minY + 1,
            destination.maxX - destination.minX + 1,
            destination.maxY - destination.minY + 1,
            entity.getPrivateArea(),
        );
    }

    private static nearestTile(from: Bounds, to: Bounds): { x: number; y: number } {
        return {
            x: Math.max(from.minX, Math.min(from.maxX, to.minX)),
            y: Math.max(from.minY, Math.min(from.maxY, to.minY)),
        };
    }
}
