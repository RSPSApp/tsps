import { CombatFactory, CanAttackResponse } from "../../../content/combat/CombatFactory";
import { CombatRange } from "../../../content/combat/CombatRange";
import { CombatMethod } from "../../../content/combat/method/CombatMethod";
import { NpcDefinition } from "../../../definition/NpcDefinition"
import { Player } from "../player/Player";
import { AreaManager } from "../../../model/areas/AreaManager";
import { PrivateArea } from "../../../model/areas/impl/PrivateArea";
import { NPC } from "./NPC";
import { PluginManager } from "../../../../plugins/PluginManager";
import { World } from "../../../World";

/** Wiki (PJ timer): a monster attacking the player holds them for 8 ticks in single-way combat. */
const SINGLE_WAY_HOLD_TICKS = 8;

export class NpcAggression {
    /**
     * The index of the player each hunter took, and the cycle it took them on. An index, not the player, so a
     * world NPC doesn't keep a logged-out player alive; getTarget() === player says which player it is.
     */
    private static readonly huntedAt = new WeakMap<NPC, { playerIndex: number; cycle: number }>();

    public static process(player: Player) {
        // Wiki (PJ timer): 8 ticks of single-way protection while a monster is attacking,
        // ended early when that monster dies, so a kill lets the next hunter engage.
        if (CombatFactory.inCombat(player) && !AreaManager.inMulti(player)) {
            return;
        }

        const localNpcs = player.getLocalNpcs();
        const instanceNpcs = player.getArea() instanceof PrivateArea ? (player.getArea() as PrivateArea).getNpcs() : null;
        // A hunter that took the player on an earlier tick holds them while it walks in, before its first hit
        // starts the PJ timer above (#6922: on main, three chaos druids took the player within 4 ticks and stood
        // around them refused). Ours: the Wiki's single-way rule, one monster at a time, read as holding from the
        // moment it takes the player, for the PJ timer's 8 ticks, so one that never reaches them lets go.
        const held = NpcAggression.heldBySingleHunter(player, localNpcs)
            || (instanceNpcs != null && NpcAggression.heldBySingleHunter(player, instanceNpcs));

        // Both passes share one tick, so a single-combat hunter taken in the first blocks the second's.
        const engaged = NpcAggression.runAggression(player, localNpcs, held);

        if (instanceNpcs != null) {
            NpcAggression.runAggression(player, instanceNpcs, engaged);
        }
    }

    /**
     * Whether a living, ordinary NPC that took the player by aggression in the last 8 ticks still has them as
     * its target. Setting a target does not mark the player as under attack until a hit lands, so without this
     * the next hunter would take the player on the following tick and stand beside them, refused (#6922).
     * Always-multi NPCs (summoned minions) never hold anyone.
     */
    private static heldBySingleHunter(player: Player, npcs: NPC[]): boolean {
        const cycle = World.getProcessCycle();
        for (const npc of npcs) {
            if (npc == null || npc.getHitpoints() <= 0 || npc.isMultiCombat() || npc.getCombat().getTarget() !== player) {
                continue;
            }
            const hunted = NpcAggression.huntedAt.get(npc);
            if (hunted != null && hunted.playerIndex === player.getIndex() && cycle - hunted.cycle < SINGLE_WAY_HOLD_TICKS) return true;
        }
        return false;
    }

    /**
     * Returns whether a single-combat hunter holds the player (`engaged`: one did before this pass,
     * on an earlier tick or in the local pass).
     */
    private static runAggression(player: Player, npcs: NPC[], engaged = false): boolean {
        const area = player.getArea();
        // Set once a single-combat hunter has taken the player this tick.
        let singleCombatEngaged = engaged;
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
            // An area may flag a definition-passive NPC as aggressive (Ape Atoll natives in human form). Only the
            // flag and, when asked, the combat-level gate are lifted; the time tolerance and the range still apply.
            const override = area && rule !== false ? PluginManager.callArea(area, "npcAggressionOverride", player, npc) : null;
            const flagged = override?.aggressive === true;
            const liftsCombatLevel = flagged && override?.ignoreCombatLevel === true;
            if (rule === false || (rule !== true && !flagged && !npcDefinition.isAggressive())) {
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

            if (rule !== true && !liftsCombatLevel && !npc.isAggressiveTo(player)) {
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
                    // In multi-combat every hunter in range engages on the same tick, as live
                    // OSRS does. In single-combat only the first one takes the player this
                    // tick: setting its target does not mark the player as under attack until
                    // a hit lands, so canAttack cannot tell the others the player is taken.
                    // Always-multi NPCs (summoned minions) still join, whatever the list order.
                    const multi = CombatFactory.multiCombatBetween(npc, player);
                    if (!multi && singleCombatEngaged) {
                        continue;
                    }
                    npc.getCombat().attack(player);
                    NpcAggression.huntedAt.set(npc, { playerIndex: player.getIndex(), cycle: World.getProcessCycle() });
                    // Any ordinary NPC that engages counts, even under multi rules: a hunter on
                    // a single tile next to the multi area must not join it this tick.
                    if (!npc.isMultiCombat()) {
                        singleCombatEngaged = true;
                    }
                }
            }
        }
        return singleCombatEngaged;
    }
}
