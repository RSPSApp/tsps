import { CrossFloor } from "../../CrossFloor";
import { BoatManager } from "../sailing/BoatManager";
import type { Mobile } from "../../entity/impl/Mobile";
import type { Location } from "../../model/Location";
import type { PrivateArea } from "../../model/areas/impl/PrivateArea";

/**
 * Where two combatants are, for reach, range and line of sight. Normally their own tiles and
 * private areas. When they fight across a boat's deck (one aboard, the other in the main world or
 * on another boat), each is measured from the main-world tile under them and a deck counts as the
 * main world, as sync already treats it: a player aboard shoots a sea creature at its real range.
 * Whether such a fight is allowed at all is content's call (CombatFactory.canAttackByPolicy).
 */
export class CombatPosition {
    /** Whether the two stand on different decks, or one on a deck and the other ashore. */
    static acrossDeck(a: Mobile, b: Mobile): boolean {
        const aBoat = CombatPosition.boatOf(a);
        const bBoat = CombatPosition.boatOf(b);
        return (aBoat !== undefined || bBoat !== undefined) && aBoat !== bBoat;
    }

    /** The boat a combatant is aboard; nothing for an actor with no area at all. */
    private static boatOf(mobile: Mobile) {
        return typeof (mobile as any)?.getArea === "function" ? BoatManager.getBoatAboard(mobile) : undefined;
    }

    /** A combatant's tile against the other. */
    static location(mobile: Mobile, other: Mobile): Location {
        return CombatPosition.acrossDeck(mobile, other) ? BoatManager.rootLocation(mobile) : mobile.getLocation();
    }

    /** A combatant's private area against the other: a deck counts as the main world across decks. */
    static area(mobile: Mobile, other: Mobile): PrivateArea | null {
        return CombatPosition.acrossDeck(mobile, other) ? BoatManager.syncArea(mobile) : mobile.getPrivateArea();
    }

    /** Chebyshev distance between their tiles, as `Location.getDistance` measures it. */
    static distance(a: Mobile, b: Mobile): number {
        const first = CombatPosition.location(a, b), second = CombatPosition.location(b, a);
        return CrossFloor.combatEnabled() ? CrossFloor.distance(first, second) : first.getDistance(second);
    }

    /** Projectile flight distance includes the vertical gap between floors. */
    static projectileDistance(a: Mobile, b: Mobile): number {
        const first = CombatPosition.location(a, b), second = CombatPosition.location(b, a);
        return CrossFloor.projectileDistance(first, second);
    }

    /**
     * Chebyshev distance from `a`'s tile to the nearest tile of `b`: a large target is measured edge to
     * edge, not to its south-west tile (Wiki: Hit delay; rsprox projectile end cycles). Zero inside the
     * footprint; callers apply their own minimum.
     */
    static edgeDistance(a: Mobile, b: Mobile): number {
        const from = CombatPosition.location(a, b);
        const to = CombatPosition.location(b, a);
        const size = Math.max(1, b.getSize?.() ?? 1);
        const dx = Math.max(0, to.getX() - from.getX(), from.getX() - (to.getX() + size - 1));
        const dy = Math.max(0, to.getY() - from.getY(), from.getY() - (to.getY() + size - 1));
        return Math.max(dx, dy);
    }
}
