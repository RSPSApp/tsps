import { Mobile } from "../../entity/impl/Mobile";
import { CombatFactory } from "./CombatFactory";
import { World } from "../../World";
import { AreaManager } from "../../model/areas/AreaManager";
import type { SpecialAttackTargeting } from "./WeaponSpecialTraits";

export interface SpecialTargetingResult {
    /** Extra mobiles (NPCs and players) the same special should also strike (excludes the primary). */
    secondaryTargets: Mobile[];
    /** A footprint-aware special hits the primary again instead of sweeping. */
    largeTargetExtraHit: boolean;
}

const EMPTY: SpecialTargetingResult = { secondaryTargets: [], largeTargetExtraHit: false };

/** Tiles a mobile occupies: its south-west corner and square footprint. */
function footprint(mobile: Mobile): { x: number; y: number; z: number; size: number } {
    const location = mobile.getLocation();
    return { x: location.getX(), y: location.getY(), z: location.getZ(), size: Math.max(1, mobile.getSize()) };
}

/**
 * Resolves forward-line / footprint target selection for a special attack. Candidates are
 * every NPC and player on the primary's plane; each one the shape reaches must pass the
 * shared secondary-target permission checks. Accuracy and damage rolls stay in the normal
 * hit pipeline.
 */
export class SpecialAttackTargetingResolver {
    static resolve(
        attacker: Mobile,
        primary: Mobile,
        targeting: SpecialAttackTargeting | undefined
    ): SpecialTargetingResult {
        if (!targeting || (targeting.pattern !== "forward_line" && targeting.pattern !== "surrounding")) {
            return EMPTY;
        }
        if (!attacker || !primary || !attacker.isPlayer()) {
            return EMPTY;
        }

        const large = targeting.largeTargetExtraHit;
        if (
            large &&
            primary.isNpc() &&
            Math.max(1, primary.getAsNpc().getSize()) >= Math.max(2, Math.trunc(large.minimumSize))
        ) {
            return { secondaryTargets: [], largeTargetExtraHit: true };
        }

        if (
            targeting.requiresMultiCombat === true &&
            (!AreaManager.inMulti(attacker) || !AreaManager.inMulti(primary))
        ) {
            return EMPTY;
        }

        const limit = Math.max(0, Math.trunc(targeting.maxTargets) - 1);
        if (limit === 0) {
            return EMPTY;
        }

        const found: Mobile[] = [];
        const seen = new Set<Mobile>();
        let playersHit = primary.isPlayer() ? 1 : 0;
        // Returns true once the cap is reached.
        const take = (candidate: Mobile): boolean => {
            if (seen.has(candidate)) {
                return false;
            }
            seen.add(candidate);
            if (candidate.isPlayer() && playersHit >= Math.max(0, Math.trunc(targeting.maxPlayerTargets ?? 0))) {
                return false;
            }
            if (!CombatFactory.canAttackSecondaryTarget(attacker, primary, candidate)) {
                return false;
            }
            if (candidate.isPlayer()) {
                playersHit++;
            }
            found.push(candidate);
            return found.length >= limit;
        };

        const z = primary.getLocation().getZ();
        const candidates: Mobile[] = [];
        const collect = (mobile: Mobile) => {
            if (mobile !== primary && mobile !== attacker && mobile.getLocation().getZ() === z) {
                candidates.push(mobile);
            }
        };
        World.getNpcs().forEach(collect);
        World.getPlayers().forEach(collect);

        if (targeting.pattern === "surrounding") {
            const origin = attacker.getLocation();
            for (const candidate of candidates) {
                const { x, y, size } = footprint(candidate);
                if (
                    origin.getX() >= x - 1 && origin.getX() <= x + size &&
                    origin.getY() >= y - 1 && origin.getY() <= y + size &&
                    take(candidate)
                ) {
                    break;
                }
            }
            return { secondaryTargets: found, largeTargetExtraHit: false };
        }

        const width = Math.max(1, Math.trunc(targeting.width));
        const half = Math.floor((width - 1) / 2);
        const attackerLocation = attacker.getLocation();
        const primaryLocation = primary.getLocation();
        const dx = Math.sign(primaryLocation.getX() - attackerLocation.getX());
        const dy = Math.sign(primaryLocation.getY() - attackerLocation.getY());
        if (dx === 0 && dy === 0) {
            return EMPTY;
        }
        const perpX = -dy;
        const perpY = dx;
        for (let lateral = -half; lateral <= half; lateral++) {
            const tx = primaryLocation.getX() + perpX * lateral;
            const ty = primaryLocation.getY() + perpY * lateral;
            for (const candidate of candidates) {
                const { x, y, size } = footprint(candidate);
                if (tx >= x && tx < x + size && ty >= y && ty < y + size && take(candidate)) {
                    return { secondaryTargets: found, largeTargetExtraHit: false };
                }
            }
        }
        return { secondaryTargets: found, largeTargetExtraHit: false };
    }
}
