import { CombatFactory, CanAttackResponse } from "../../../content/combat/CombatFactory";
import { CombatRange } from "../../../content/combat/CombatRange";
import { CombatMethod } from "../../../content/combat/method/CombatMethod";
import { NpcDefinition } from "../../../definition/NpcDefinition"
import { Player } from "../player/Player";
import { AreaManager } from "../../../model/areas/AreaManager";
import { PrivateArea } from "../../../model/areas/impl/PrivateArea";
import { NPC } from "./NPC";
import { PluginManager } from "../../../../plugins/PluginManager";

export class NpcAggression {

    public static process(player: Player) {
        // Make sure we can attack the player
        if (CombatFactory.inCombat(player) && !AreaManager.inMulti(player)) {
            return;
        }

        NpcAggression.runAggression(player, player.getLocalNpcs());

        if (player.getArea() instanceof PrivateArea) {
            NpcAggression.runAggression(player, (player.getArea() as PrivateArea).getNpcs());
        }
    }

    private static runAggression(player: Player, npcs: NPC[]) {
        const area = player.getArea();
        for (let npc of npcs) {
            if (npc == null) {
                continue;
            }

            // Get the NPC's current definition (taking into account possible transformation)
            let npcDefinition: NpcDefinition = npc.getCurrentDefinition();
            if (npcDefinition == null || npc.getHitpoints() <= 0
                || npc.getPrivateArea() != player.getPrivateArea()
                || (npc.isOwnerOnly?.() && npc.getOwner?.() !== player)) {
                // Make sure the npc is available to attack the player.
                continue;
            }

            const rule = area ? PluginManager.callArea(area, "npcAggression", player, npc) : null;
            if (rule === false || (rule !== true && !npcDefinition.isAggressive())) {
                continue;
            }

            if (rule !== true && npcDefinition.buildsAggressionTolerance() && player.getAggressionTolerance().finished()
                && ((area ? PluginManager.callArea(area, "npcAggressionTolerance", player, npc) : null)
                    ?? PluginManager.emitNpcAggressionTolerance(player, npc)) !== true) {
                // If Player has obtained tolerance to this NPC, don't be aggressive.
                // Tolerance is per-npc, so skip just this one - the rest of the
                // list may still contain npcs the player isn't tolerant to.
                continue;
            }

            if (CombatFactory.inCombat(npc)) {
                // An npc keeps the target it acquired until combat ends - it never
                // re-hunts (or randomly re-rolls) while it has one, multi or not.
                // Matches LostCity's consumeHuntTarget()/huntAll() and OSRS.
                continue;
            }

            if (rule !== true && !npc.isAggressiveTo(player)) {
                // Ensure the NPC can be aggressive to this player.
                continue;
            }

            // The NPC's authority to start this fight is its aggression range from the spawn:
            // `max range + attack range`, measured from the spawn footprint. NPC locations are
            // south-west corners, so the footprint already extends `size - 1` tiles north and
            // east; the size must not be added as a symmetric radius. A player outside it cannot
            // be attacked, even when the NPC has wandered close enough to hunt (Wiki
            // Aggressiveness#Aggression range). An area rule that forces aggression overrides it.
            const method: CombatMethod = CombatFactory.getMethod(npc);
            const attackDistance = method.attackDistance(npc);
            const spawnDistance = CombatRange.footprintDistance(
                npc.getSpawnPosition(), npcDefinition.getSize(), player.getLocation());
            if (rule !== true && spawnDistance > npcDefinition.getAggressionRange(attackDistance)) {
                continue;
            }

            // The Wiki's hunt range starts at the NPC's current south-west tile, not its spawn
            // (Aggressiveness#Hunt range). A ranged or magic NPC can at least see as far as it
            // can cast; the definition's huntRange is the floor (default 3, KQ 9).
            const huntDistance = npc.getLocation().getDistance(player.getLocation());
            const huntRange = Math.max(npcDefinition.getHuntRange(), attackDistance);

            if (huntDistance <= huntRange) {
                if (CombatFactory.canAttack(npc, method, player) == CanAttackResponse.CAN_ATTACK) {
                    npc.getCombat().attack(player);
                    break;
                }
            }
        }
    }
}
