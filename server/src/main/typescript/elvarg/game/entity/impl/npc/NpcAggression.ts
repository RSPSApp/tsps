import { CombatFactory, CanAttackResponse } from "../../../content/combat/CombatFactory";
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
                || !npcDefinition.isAggressive()
                || npc.getPrivateArea() != player.getPrivateArea()
                || (npc.isOwnerOnly?.() && npc.getOwner?.() !== player)) {
                // Make sure the npc is available to attack the player.
                continue;
            }

            if (npcDefinition.buildsAggressionTolerance() && player.getAggressionTolerance().finished()
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

            if (!npc.isAggressiveTo(player)) {
                // Ensure the NPC can be aggressive to this player.
                continue;
            }

            // Make sure we have the proper distance to attack the player.
            let distanceToPlayer = npc.getSpawnPosition().getDistance(player.getLocation());

            // Get the npc's combat method
            let method: CombatMethod = CombatFactory.getMethod(npc);

            // Get the max distance this npc can attack from.
            // We should always attack if we're at least 3 tiles from the player.
            let aggressionDistance = npc.aggressionDistance();

            if (distanceToPlayer < npcDefinition.getCombatFollowDistance() && distanceToPlayer <= aggressionDistance) {
                if (CombatFactory.canAttack(npc, method, player) == CanAttackResponse.CAN_ATTACK) {
                    npc.getCombat().attack(player);
                    break;
                }
            }
        }
    }
}
