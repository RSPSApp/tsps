import { World } from "../../../World";
import { NPC } from "../../../entity/impl/npc/NPC";
import { Player } from "../../../entity/impl/player/Player";
import { Skill } from "../../../model/Skill";
import { HitDamage } from "../hit/HitDamage";
import { HitMask } from "../hit/HitMask";
import { Animation } from "../../../model/Animation";
import { CombatRange } from "../CombatRange";
import { PathFinder } from "../../../model/movement/path/PathFinder";
import { Task } from "../../../task/Task";
import { TaskManager } from "../../../task/TaskManager";
import { Location } from "../../../model/Location";

const THRALL_KEY = "arceuus:thrall";
const THRALL_PURSUIT_KEY = "arceuus:thrall-pursuit";

export class ArceuusThralls {
    public static summon(player: Player, npcId: number, prayerCost: number, maxHit: number, attackDistance: number): void {
        const previous = player.getAttribute(THRALL_KEY) as NPC | null;
        if (previous?.isRegistered()) World.getRemoveNPCQueue().push(previous);

        player.getSkillManager().decreaseCurrentLevel(
            Skill.PRAYER,
            prayerCost,
            0,
        );
        const thrall = NPC.create(npcId, player.getLocation().clone());
        thrall.setOwner(player);
        thrall.setPet(true);
        thrall.setUntargetable(true);
        thrall.setFollowing(player);
        (thrall as any).__skipDefaultRespawn = true;
        player.setAttribute(THRALL_KEY, thrall);
        World.getAddNPCQueue().push(thrall);

        let ticks = player.getSkillManager().getCurrentLevel(Skill.MAGIC);
        let attackTicks = 0;
        TaskManager.submit(new class extends Task {
            constructor() { super(1); }
            execute(): void {
                if (player.getAttribute(THRALL_KEY) !== thrall || !player.isRegistered() || --ticks <= 0) {
                    if (thrall.isRegistered()) World.getRemoveNPCQueue().push(thrall);
                    if (player.getAttribute(THRALL_KEY) === thrall) player.setAttribute(THRALL_KEY, null);
                    this.stop();
                    return;
                }
                if (!thrall.isRegistered()) return;
                const target = player.getCombat().getTarget();
                if (!target?.isNpc() || !target.isRegistered() || target.isUntargetable() || target.getHitpoints() <= 0) {
                    if (thrall.getFollowing() !== player) {
                        thrall.getMovementQueue().reset();
                        thrall.setAttribute(THRALL_PURSUIT_KEY, null);
                        thrall.setFollowing(player);
                    }
                    return;
                }
                if (thrall.getInteractingMobile() !== target) thrall.setMobileInteraction(target);

                const overlappingTarget = CombatRange.overlapsEntities(thrall, target);
                if (overlappingTarget) {
                    thrall.setFollowing(null);
                    thrall.setAttribute(THRALL_PURSUIT_KEY, null);
                    thrall.getMovementQueue().setPursuitCheckpoint(PathFinder.naiveEntityDestination(thrall, target));
                    return;
                }

                if (thrall.calculateDistance(target) > attackDistance) {
                    thrall.setFollowing(null);
                    const destination = CombatRange.rangedDestination(thrall, target, attackDistance);
                    const previousDestination = thrall.getAttribute(THRALL_PURSUIT_KEY) as Location | null;
                    if (!previousDestination?.equals(destination)) {
                        PathFinder.calculateGroundItemRoute(thrall, destination);
                        thrall.setAttribute(THRALL_PURSUIT_KEY, destination);
                    }
                    return;
                }
                if (thrall.getFollowing() != null || thrall.getAttribute(THRALL_PURSUIT_KEY) != null) {
                    thrall.setFollowing(null);
                    thrall.getMovementQueue().reset();
                    thrall.setAttribute(THRALL_PURSUIT_KEY, null);
                }

                if (++attackTicks % 4 === 0) {
                    thrall.performAnimation(new Animation(thrall.getAttackAnim()));
                    target.getCombat().getHitQueue().addPendingDamage([new HitDamage(maxHit, HitMask.RED)]);
                    target.getCombat().addDamage(player, maxHit);
                }
            }
        });
    }
}
