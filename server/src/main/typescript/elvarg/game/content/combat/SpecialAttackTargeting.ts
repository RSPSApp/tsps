import { Mobile } from "../../entity/impl/Mobile";
import type { NPC } from "../../entity/impl/npc/NPC";
import { World } from "../../World";
import { AreaManager } from "../../model/areas/AreaManager";
import type { SpecialAttackTargeting } from "./WeaponSpecialTraits";

export interface SpecialTargetingResult {
    /** Extra NPCs the same special should also strike (excludes the primary). */
    secondaryTargets: Mobile[];
    /** A footprint-aware special hits the primary again instead of sweeping. */
    largeTargetExtraHit: boolean;
}

const EMPTY: SpecialTargetingResult = { secondaryTargets: [], largeTargetExtraHit: false };

/**
 * Resolves forward-line / footprint target selection for a special attack.
 * Core-neutral: it only reads locations and the NPC list, and leaves accuracy
 * and damage rolls to the normal hit pipeline.
 */
export class SpecialAttackTargetingResolver {
    static resolve(
        attacker: Mobile,
        primary: Mobile,
        targeting: SpecialAttackTargeting | undefined
    ): SpecialTargetingResult {
        if (!targeting || targeting.pattern !== "forward_line") {
            return EMPTY;
        }
        if (!attacker || !primary || !attacker.isPlayer() || !primary.isNpc()) {
            return EMPTY;
        }

        const large = targeting.largeTargetExtraHit;
        if (
            large &&
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
        const depth = Math.max(1, attackerLocation.getDistance(primaryLocation) + 1);

        const found: Mobile[] = [];
        const seen = new Set<Mobile>();
        for (let d = 1; d <= depth; d++) {
            for (let lateral = -half; lateral <= half; lateral++) {
                const x = attackerLocation.getX() + dx * d + perpX * lateral;
                const y = attackerLocation.getY() + dy * d + perpY * lateral;
                const npc = SpecialAttackTargetingResolver.npcAt(x, y, primaryLocation.getZ(), primary);
                if (npc && !seen.has(npc)) {
                    seen.add(npc);
                    found.push(npc);
                    if (found.length >= limit) {
                        return { secondaryTargets: found, largeTargetExtraHit: false };
                    }
                }
            }
        }
        return { secondaryTargets: found, largeTargetExtraHit: false };
    }

    private static npcAt(x: number, y: number, z: number, primary: Mobile): NPC | null {
        let result: NPC | null = null;
        World.getNpcs().forEach((npc) => {
            if (result || npc === primary) {
                return;
            }
            if (!npc.isRegistered() || npc.getHitpoints() <= 0) {
                return;
            }
            const location = npc.getLocation();
            if (location.getZ() !== z) {
                return;
            }
            const size = Math.max(1, npc.getSize());
            if (
                x >= location.getX() && x < location.getX() + size &&
                y >= location.getY() && y < location.getY() + size
            ) {
                result = npc;
            }
        });
        return result;
    }
}
