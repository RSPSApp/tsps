import { Sound } from "../../Sound";
import { Sounds } from "../../Sounds";
import { PrayerHandler } from "../PrayerHandler";
import { Dueling, DuelRule, DuelState } from "../Duelling";
import { WeaponInterfaces } from "./WeaponInterfaces";
import { WeaponInterfaceManager } from "./WeaponInterfaceManager";
import { DamageFormulas } from "./formula/DamageFormulas";
import { HitDamage } from "./hit/HitDamage";
import { HitMask } from "./hit/HitMask";
import { PendingHit } from "./hit/PendingHit";
import { CombatSpells } from "./magic/CombatSpells";
import { ArceuusSpells } from "./magic/ArceuusSpells";
import { CombatMethod } from "./method/CombatMethod";
import { MagicCombatMethod } from "./method/impl/MagicCombatMethod";
import { MeleeCombatMethod } from "./method/impl/MeleeCombatMethod";
import { RangedCombatMethod } from "./method/impl/RangedCombatMethod";
import { Ammunition, RangedData, RangedWeapon } from "./ranged/RangedData";
import { Mobile } from "../../entity/impl/Mobile";
import type { NPC } from "../../entity/impl/npc/NPC";
import { CoordinateState } from "../../entity/impl/npc/NPCMovementCoordinator";
import type { Player } from "../../entity/impl/player/Player";
import { Animation } from "../../model/Animation";
import { EffectTimer } from "../../model/EffectTimer"
import { Flag } from "../../model/Flag";
import { Graphic } from "../../model/Graphic";
import { GraphicHeight } from "../../model/GraphicHeight";
import { Item } from "../../model/Item";
import { Location } from "../../model/Location";
import { Skill } from "../../model/Skill";
import { SkullType } from "../../model/SkullType"
import { AreaManager } from "../../model/areas/AreaManager";
import { Equipment } from "../../model/container/impl/Equipment";
import { BonusManager } from "../../model/equipment/BonusManager";
import { PlayerRights } from "../../model/rights/PlayerRights";
import { Task } from "../../task/Task";
import { TaskManager } from "../../task/TaskManager";
import { CombatPoisonEffect } from "../../task/impl/CombatPoisonEffect"
import { ItemIdentifiers } from "../../../util/ItemIdentifiers";
import { Misc } from "../../../util/Misc";
import { NpcIdentifiers } from "../../../util/NpcIdentifiers";
import { RandomGen } from "../../../util/RandomGen";
import { TimerKey } from "../../../util/timers/TimerKey";
import { CombatType } from "./CombatType";
import { CombatSpecial } from "./CombatSpecial";
import { resolveSpecialAttackType } from "./WeaponSpecialTraits";
import { CombatPoisonData } from "../../task/impl/CombatPoisonEffect";
import { PoisonType } from "../../task/impl/CombatPoisonEffect";
import { CombatConstants } from "./CombatConstants";
import { Wilderness } from "../wilderness/Wilderness";
import { PluginManager } from "../../../plugins/PluginManager";
import { ServerPerf } from "../../../util/ServerPerf";
import { World } from "../../World";
import { ItemOnGroundManager } from "../../entity/impl/grounditem/ItemOnGroundManager";
import { WeaponProfiles } from "./WeaponProfile";
import { Barrows } from "./Barrows";
import {
    CRYSTAL_BOW_SHOTS_PER_STAGE,
    getNextCrystalBowItemId,
    isChargedCrystalBow,
    isEmptyCrystalBow,
} from "./ranged/CrystalBow";

export type SpecialDamageBounds = {
    minimumMultiplier?: number;
    maximumMultiplier?: number;
    minimumBonus?: number;
    maximumBonus?: number;
    cap?: number;
    reduction?: number;
};

const getPlayerCombatSpecial = (player: Player): CombatSpecial | null => {
    const accessor = (player as any)?.getCombatSpecial;
    if (typeof accessor === "function") {
        const resolved = accessor.call(player);
        if (resolved) {
            return resolved;
        }
    }
    return ((player as any)?.combatSpecial ?? null) as CombatSpecial | null;
};

/** Developer debug: a queued-attack special (granite maul) forced to hit 50. */
const isDeveloperQueuedAttackSpec = (entity: Mobile): entity is Player => {
    if (!entity.isPlayer()) {
        return false;
    }

    const player = entity.getAsPlayer();
    return (
        player.getRights?.() === PlayerRights.DEVELOPER &&
        player.isSpecialActivated() &&
        getPlayerCombatSpecial(player)?.getTraits()?.queuedAttack === true
    );
};

export class CombatFactory {
    private static readonly RANDOM = new RandomGen();
    public static readonly RECOIL_DAMAGE_ATTRIBUTE = "ring-of-recoil:damage";
    public static readonly CRYSTAL_BOW_SHOTS_ATTRIBUTE = "crystal-bow:shots-in-stage";
    public static readonly CRYSTAL_BOW_ITEM_ATTRIBUTE = "crystal-bow:tracked-item";
    /**
     * The default melee combat method.
     */
    public static readonly MELEE_COMBAT = new MeleeCombatMethod();

    /**
     * The default ranged combat method
     */
    public static readonly RANGED_COMBAT = new RangedCombatMethod();

    /**
     * The default magic combat method
     */
    public static readonly MAGIC_COMBAT = new MagicCombatMethod();

    static getMethod(attacker: Mobile) {
        if (attacker.isPlayer()) {
            const player = attacker.getAsPlayer();

            // Update ranged data before selecting the combat method.
            const resolvedAmmo = Ammunition.getFor(player);
            if (player.getCombat().getAmmunition() !== resolvedAmmo) {
                player.getCombat().setAmmunition(resolvedAmmo);
            }
            const resolvedWeapon = RangedWeapon.getFor(player);
            if (player.getCombat().getRangedWeapon() !== resolvedWeapon) {
                player.getCombat().setRangedWeapon(resolvedWeapon);
            }

            if (
                player.getCombat().getCastSpell() != null ||
                (player.getCombat().getAutocastSpell() != null && player.getEquipment().hasStaffEquipped())
            ) {
                return CombatFactory.MAGIC_COMBAT;
            }

            for (const resolver of PluginManager.getCombatMethodResolvers()) {
                const resolved = resolver.resolve(attacker);
                if (resolved) {
                    return resolved;
                }
            }

            const special = getPlayerCombatSpecial(player);
            if (player.isSpecialActivated() && special != null) {
                return special.getCombatMethod();
            }

            if (player.getCombat().getRangedWeapon() != null) {
                return CombatFactory.RANGED_COMBAT;
            }
        } else if (attacker.isNpc()) {
            for (const entry of PluginManager.getNpcCombatMethodProviders()) {
                const npc = attacker.getAsNpc();
                const npcId = npc.getId();
                const npcRealId = npc.getRealId();
                if (!entry.npcIds.has(npcId) && !entry.npcIds.has(npcRealId)) {
                    continue;
                }
                const override = entry.provider.provide(npc);
                if (override) {
                    return override;
                }
            }
            return attacker.getAsNpc().getCombatMethod();
        }

        return CombatFactory.MELEE_COMBAT;
    }

    static getHitDamage(entity: Mobile, victim: Mobile, type: CombatType, bypassProtectionPrayer = false, boundsOverride?: SpecialDamageBounds) {
        const specialTraits = CombatSpecial.activeTraitsFor(entity);
        if (specialTraits?.ignoreProtectionPrayer) {
            bypassProtectionPrayer = true;
        }
        const prayerType = resolveSpecialAttackType(specialTraits?.damageType) ?? type;
        let damage = 0;
        if (type == CombatType.MELEE) {
            damage = CombatFactory.rollSpecialDamage(entity, DamageFormulas.sourceMaxHit(entity, CombatType.MELEE), boundsOverride);
        } else if (type == CombatType.RANGED) {
            let maxHit = DamageFormulas.sourceMaxHit(entity, CombatType.RANGED);
            maxHit = PluginManager.modifyRangedMaxHit(entity, victim, maxHit);
            damage = CombatFactory.rollSpecialDamage(entity, maxHit, boundsOverride);

            // Do ranged effects with the calculated damage..
            if (entity.isPlayer()) {

                let player = entity.getAsPlayer();

                const profile = WeaponProfiles.get(player);
                const damageRange = player.isSpecialActivated() && getPlayerCombatSpecial(player)
                    ? profile?.specialDamage
                    : undefined;
                if (damageRange) {
                    damage = Math.max(damageRange.minimum, Math.min(damageRange.maximum, damage));
                }
                if (profile?.boltEffects && CombatFactory.boltEffectTriggered(entity)) {
                    let multiplier = RangedData.getSpecialEffectsMultiplier(player, victim, damage);
                    damage *= multiplier;
                }
            }
        } else if (type == CombatType.MAGIC) {
            damage = CombatFactory.rollSpecialDamage(entity, DamageFormulas.sourceMaxHit(entity, CombatType.MAGIC), boundsOverride);
        }

        if (entity.isNpc() && victim.isPlayer() && ArceuusSpells.hasWard(victim)) {
            if (entity.getAsNpc().getCurrentDefinition()?.isDemon?.()) damage = Math.floor(damage * 0.9);
        }

        // Do magic effects with the calculated damage..
        // We've got our damage. We can now create a HitDamage
        // instance.
        let hitDamage = new HitDamage(damage, damage == 0 ? HitMask.BLUE : HitMask.RED);

        /**
         * Prayers decreasing damage.
         */

        // Decrease damage if victim is using the corresponding protection prayer.
        if (!bypassProtectionPrayer) {

            // Check if victim is is using correct protection prayer
            if (PrayerHandler.isActivated(victim, PrayerHandler.getProtectingPrayer(prayerType))) {

                // Apply the damage reduction mod
                if (entity.isNpc()) {
                    hitDamage.multiplyDamage(CombatConstants.PRAYER_DAMAGE_REDUCTION_AGAINST_NPCS);
                } else {
                    hitDamage.multiplyDamage(CombatConstants.PRAYER_DAMAGE_REDUCTION_AGAINST_PLAYERS);
                }
            }
        }
        if (victim.isPlayer() && Misc.getRandom(100) <= 70) {
            if (victim.getAsPlayer().getEquipment().getItems()[Equipment.SHIELD_SLOT].getId() == 12817) {
                hitDamage.multiplyDamage(CombatConstants.ELYSIAN_DAMAGE_REDUCTION);
                victim.performGraphic(new Graphic(321, 40)); // Elysian spirit shield effect gfx
            }
        }

        if (type == CombatType.MELEE && isDeveloperQueuedAttackSpec(entity)) {
            hitDamage = new HitDamage(50, HitMask.RED);
        }

        return hitDamage;
    }

    /**
     * Applies an explicit per-style max hit to an incoming hit.
     *
     * NpcDefinitions carry a single max hit (the wiki's highest style), so a boss
     * whose styles cap differently passes the cap for the style it rolled - the
     * bounds ride as flat bonuses so the exact integer max survives
     * rollSpecialDamage's floor, and protection prayers still reduce the result
     * unless bypassProtectionPrayer is set. Damage is capped to the target's
     * current hitpoints, matching the cap PendingHit rolls with.
     */
    public static applyStyleDamage(
        hit: PendingHit,
        maxHit: number,
        options: { minHit?: number; bypassProtectionPrayer?: boolean } = {}
    ): void {
        if (!hit || !hit.isAccurate() || hit.getHits().length === 0) {
            return;
        }
        const attacker = hit.getAttacker();
        const target = hit.getTarget();
        const rolled = CombatFactory.getHitDamage(
            attacker,
            target,
            hit.getCombatType(),
            options.bypassProtectionPrayer === true,
            {
                minimumMultiplier: 0,
                maximumMultiplier: 0,
                minimumBonus: Math.max(0, options.minHit ?? 0),
                maximumBonus: Math.max(0, Math.trunc(maxHit)),
            }
        );
        hit.getHits()[0].setDamage(Math.max(0, Math.min(rolled.getDamage(), target.getHitpoints())));
        hit.updateTotalDamage();
    }

    /**
     * Rolls one hit's damage. With no active special traits this is the ordinary
     * 0..maxHit roll; with traits it honours per-hit min/max multipliers, flat
     * bonuses and a maximum cap.
     */
    private static rollSpecialDamage(entity: Mobile, maxHit: number, boundsOverride?: SpecialDamageBounds): number {
        const traits = CombatSpecial.activeTraitsFor(entity);
        if (!traits && !boundsOverride) {
            return Misc.randomInclusive(0, maxHit);
        }
        let minimum = Math.floor(
            maxHit * (boundsOverride?.minimumMultiplier ?? traits?.minimumDamageMultiplier ?? 0)
        );
        let maximum = Math.floor(
            maxHit * (boundsOverride?.maximumMultiplier ?? traits?.maximumDamageMultiplier ?? 1)
        );
        minimum += Math.trunc(boundsOverride?.minimumBonus ?? traits?.minimumDamageBonus ?? 0);
        maximum += Math.trunc(boundsOverride?.maximumBonus ?? traits?.maximumDamageBonus ?? 0);
        const cap = boundsOverride?.cap ?? traits?.maximumDamageCap;
        if (cap !== undefined) {
            maximum = Math.min(maximum, Math.trunc(cap));
            minimum = Math.min(minimum, maximum);
        }
        const reduction = boundsOverride?.reduction ?? 0;
        if (reduction > 0) {
            maximum = Math.max(0, maximum - Math.trunc(reduction));
            minimum = Math.min(minimum, maximum);
        }
        if (maximum < minimum) {
            const swap = minimum;
            minimum = maximum;
            maximum = swap;
        }
        return Misc.randomInclusive(Math.max(0, minimum), Math.max(0, maximum));
    }

    /**
     * Applies a resolved hit's damage. When the hit carries per-hitsplat reveal
     * delays (special `hitDelayTicks`), each later hitsplat is queued on its own
     * tick instead of landing all at once.
     */
    private static applyResolvedHitDamage(target: Mobile, resolvedHit: PendingHit): void {
        const hits = resolvedHit.getHits();
        const delays = resolvedHit.getHitDelays();
        if (!delays || delays.length <= 1 || delays.length !== hits.length) {
            target.getCombat().getHitQueue().addPendingDamage(hits);
            return;
        }
        const base = Math.min(...delays);
        for (let i = 0; i < hits.length; i++) {
            const extra = Math.max(0, delays[i] - base);
            if (extra <= 0) {
                target.getCombat().getHitQueue().addPendingDamage([hits[i]]);
                continue;
            }
            TaskManager.submit(new (class extends Task {
                constructor() {
                    super(extra);
                }
                execute(): void {
                    if (target.isRegistered() && target.getHitpoints() > 0) {
                        target.getCombat().getHitQueue().addPendingDamage([hits[i]]);
                    }
                    this.stop();
                }
            })());
        }
    }

    /** Enchanted-bolt activation, honouring special traits that scale/guarantee it. */
    private static boltEffectTriggered(entity: Mobile): boolean {
        const traits = CombatSpecial.activeTraitsFor(entity);
        if (traits?.guaranteedEnchantedBoltEffect === true) {
            return true;
        }
        const multiplier = traits?.enchantedBoltEffectChanceMultiplier;
        if (multiplier !== undefined && multiplier > 0) {
            return Misc.getRandom(Math.max(1, Math.round(10 / multiplier))) === 1;
        }
        return Misc.getRandom(10) === 1;
    }

    static applyExtraHitRolls(attacker: Mobile, target: Mobile, combatType: CombatType, damage: HitDamage, accurate: boolean, method: CombatMethod) {
        if (!attacker || !target || !damage) {
            return;
        }

        if (!accurate) {
            return;
        }

        // Bolt activation is data-driven: a special that guarantees the effect
        // declares `guaranteedEnchantedBoltEffect` (see boltEffectTriggered).
        if (combatType == CombatType.RANGED
            && attacker.isPlayer()
            && WeaponProfiles.get(attacker.getAsPlayer())?.boltEffects
            && CombatFactory.boltEffectTriggered(attacker)) {
            const multiplier = RangedData.getSpecialEffectsMultiplier(attacker.getAsPlayer(), target, damage.getDamage());
            if (multiplier !== 1.0) {
                damage.setDamage(Math.floor(damage.getDamage() * multiplier));
            }
        }

    }

    static validTarget(attacker: Mobile, target: Mobile) {
        if (attacker == null || target == null || attacker === target) {
            return false;
        }
        if (!target.isRegistered() || !attacker.isRegistered() || attacker.getHitpoints() <= 0
            || target.getHitpoints() <= 0 || attacker.isUntargetable() || target.isUntargetable()
            || attacker.isNeedsPlacement() || target.isNeedsPlacement()
            || attacker.isTeleportingReturn() || target.isTeleportingReturn()
            || (attacker.isPlayer() && attacker.getAsPlayer().isDyingReturn())
            || (target.isPlayer() && target.getAsPlayer().isDyingReturn())
            || (attacker.isNpc() && attacker.getAsNpc().isDyingFunction())
            || (target.isNpc() && target.getAsNpc().isDyingFunction())) {
            return false;
        }

        if (
            attacker.getPrivateArea() !== target.getPrivateArea() ||
            attacker.getLocation().getZ() !== target.getLocation().getZ() ||
            attacker.getLocation().getDistance(target.getLocation()) >= 40
        ) {
            return false;
        }

        if (attacker.isNpc() && target.isPlayer()) {
            if (attacker.getAsNpc().getOwner() != null && attacker.getAsNpc().getOwner() != target.getAsPlayer()) {
                return false;
            }
        } else if (attacker.isPlayer() && target.isNpc()) {
            if (target.getAsNpc().getOwner() != null && target.getAsNpc().getOwner() != attacker.getAsPlayer()) {
                attacker.getAsPlayer().sendMessage("This npc was not spawned for you.");
                return false;
            }
        }

        return true;
    }

    public static fullVeracs(entity: Mobile): boolean {
        return entity.isNpc() ? entity.getAsNpc().getId() == NpcIdentifiers.VERAC_THE_DEFILED
            : Barrows.hasFullSet(entity.getAsPlayer(), "veracs");
    }

    /**
    * Determines if the entity is wearing full dharoks.
    *
    * @param entity the entity to determine this for.
    * @return true if the player is wearing full dharoks.
    */
    public static fullDharoks(entity: Mobile): boolean {
        return entity.isNpc() ? entity.getAsNpc().getId() == NpcIdentifiers.DHAROK_THE_WRETCHED
            : Barrows.hasFullSet(entity.getAsPlayer(), "dharoks");
    }

    /**
    * Determines if the entity is wearing full karils.
    *
    * @param entity the entity to determine this for.
    * @return true if the player is wearing full karils.
    */
    public static fullKarils(entity: Mobile): boolean {
        return entity.isNpc() ? entity.getAsNpc().getId() == NpcIdentifiers.KARIL_THE_TAINTED
            : Barrows.hasFullSet(entity.getAsPlayer(), "karils");
    }

    /**
    * Determines if the entity is wearing full ahrims.
    *
    * @param entity the entity to determine this for.
    * @return true if the player is wearing full ahrims.
    */
    public static fullAhrims(entity: Mobile): boolean {
        return entity.isNpc() ? entity.getAsNpc().getId() == NpcIdentifiers.AHRIM_THE_BLIGHTED
            : Barrows.hasFullSet(entity.getAsPlayer(), "ahrims");
    }

    public static fullTorags(entity: Mobile): boolean {
        return entity.isNpc() ? entity.getAsNpc().getDefinition().getName() === "Torag the Corrupted"
            : Barrows.hasFullSet(entity.getAsPlayer(), "torags");
    }

    /**
     * Determines if the entity is wearing full guthans.
     *
     * @param entity the entity to determine this for.
     * @return true if the player is wearing full guthans.
     */
    public static fullGuthans(entity: Mobile): boolean {
        return entity.isNpc() ? entity.getAsNpc().getDefinition().getName() === "Guthan the Infested"
            : Barrows.hasFullSet(entity.getAsPlayer(), "guthans");
    }

    /**
     * Calculates the combat level difference for wilderness player vs. player
     * combat.
     *
     * @param combatLevel the combat level of the first person.
     * @param otherCombatLevel the combat level of the other person.
     * @return the combat level difference.
     */
    public static combatLevelDifference(combatLevel: number, otherCombatLevel: number): number {
        if (combatLevel > otherCombatLevel) {
            return (combatLevel - otherCombatLevel);
        } else if (otherCombatLevel > combatLevel) {
            return (otherCombatLevel - combatLevel);
        } else {
            return 0;
        }
    }

    public static canAttack(
        attacker: Mobile,
        method: CombatMethod,
        target: Mobile,
        skipTargetValidation: boolean = false,
        skipPermissionValidation: boolean = false
    ): CanAttackResponse {
        if (!skipPermissionValidation) {
            const permission = CombatFactory.canAttackPermission(attacker, target, skipTargetValidation, method);
            if (permission !== CanAttackResponse.CAN_ATTACK) return permission;
        }

        if (!ServerPerf.measurePhase(
            "combat.process.can_attack.method",
            () => method.canAttack(attacker, target)
        )) {
            return CanAttackResponse.COMBAT_METHOD_NOT_ALLOWED;
        }

        return CanAttackResponse.CAN_ATTACK;
    }

    /** Target/area ownership checks safe to run before pursuit; no ammo or runes are consumed. */
    public static canAttackPermission(
        attacker: Mobile,
        target: Mobile,
        skipTargetValidation: boolean = false,
        method?: CombatMethod
    ): CanAttackResponse {
        if (!skipTargetValidation && !ServerPerf.measurePhase(
            "combat.process.can_attack.valid_target",
            () => CombatFactory.validTarget(attacker, target)
        )) {
            return CanAttackResponse.INVALID_TARGET;
        }

        const attackerDuel = attacker.isPlayer() ? attacker.getAsPlayer().getDueling() : null;
        const targetDuel = target.isPlayer() ? target.getAsPlayer().getDueling() : null;
        const duelActive = attackerDuel?.inDuel() === true || targetDuel?.inDuel() === true;
        if (duelActive) {
            if (!attackerDuel || !targetDuel ||
                attackerDuel.getInteract() !== target.getAsPlayer() ||
                targetDuel.getInteract() !== attacker.getAsPlayer()) {
                return CanAttackResponse.DUEL_WRONG_OPPONENT;
            }
            if (attackerDuel.getState() !== DuelState.IN_DUEL || targetDuel.getState() !== DuelState.IN_DUEL) {
                return CanAttackResponse.DUEL_NOT_STARTED_YET;
            }
        }

        // Here we check if we are already in combat with another entity.
        // Only check if we aren't in multi.
        if (!ServerPerf.measurePhase(
            "combat.process.can_attack.multi_check",
            () => AreaManager.inMulti(attacker) && AreaManager.inMulti(target)
        )) {
            if (
                ServerPerf.measurePhase("combat.process.can_attack.attacker_busy", () =>
                    (
                        CombatFactory.isBeingAttacked(attacker) &&
                        attacker.getCombat().getAttacker() != target &&
                        attacker.getCombat().getAttacker().getHitpoints() > 0
                    ) || !attacker.getCombat().getHitQueue().isEmpty(target)
                )
            ) {
                return CanAttackResponse.ALREADY_UNDER_ATTACK;
            }

            // Here we check if we are already in combat with another entity.
            if (
                ServerPerf.measurePhase("combat.process.can_attack.target_busy", () =>
                    (CombatFactory.isBeingAttacked(target) && target.getCombat().getAttacker() != attacker) ||
                    !target.getCombat().getHitQueue().isEmpty(attacker)
                )
            ) {
                return CanAttackResponse.ALREADY_UNDER_ATTACK;
            }
        }

        // Check plugin and area attack policy.
        const areaResponse = duelActive
            ? CanAttackResponse.CAN_ATTACK
            : ServerPerf.measurePhase(
                "combat.process.can_attack.policy",
                () => CombatFactory.canAttackByPolicy(attacker, target, method)
            );
        if (areaResponse != CanAttackResponse.CAN_ATTACK) {
            return areaResponse;
        }

        if (method && !ServerPerf.measurePhase(
            "combat.process.can_attack.method_permission",
            () => method.canPursue(attacker, target)
        )) {
            return CanAttackResponse.COMBAT_METHOD_NOT_ALLOWED;
        }

        if (attacker.isPlayer()) {
            const player = attacker.getAsPlayer();
            const special = getPlayerCombatSpecial(player);
            if (player.isSpecialActivated() && special != null) {
                const queuedAttackInFlight =
                    special.getTraits()?.queuedAttack === true &&
                    player.getCombat().isSpecialAttackQueued();
                if (!queuedAttackInFlight) {
                    const drainAmount = special.getDrainAmountForWeaponId(
                        player.getEquipment().get(Equipment.WEAPON_SLOT).getId()
                    );
                    if (player.getSpecialPercentage() < drainAmount) {
                        return CanAttackResponse.NOT_ENOUGH_SPECIAL_ENERGY;
                    }
                }
            }
            if (player.getTimers().has(TimerKey.STUN)) return CanAttackResponse.STUNNED;
            if (method && player.getDueling().inDuel()) {
                const rules = player.getDueling().getRules();
                if (method.type() == CombatType.MELEE && rules[DuelRule.NO_MELEE.getButtonId()]) {
                    return CanAttackResponse.DUEL_MELEE_DISABLED;
                }
                if (method.type() == CombatType.RANGED && rules[DuelRule.NO_RANGED.getButtonId()]) {
                    return CanAttackResponse.DUEL_RANGED_DISABLED;
                }
                if (method.type() == CombatType.MAGIC && rules[DuelRule.NO_MAGIC.getButtonId()]) {
                    return CanAttackResponse.DUEL_MAGIC_DISABLED;
                }
            }
        }

        if (target.isNpc() && ServerPerf.measurePhase(
            "combat.process.can_attack.target_immunity",
            () => (target as unknown as NPC).getTimers().has(TimerKey.ATTACK_IMMUNITY)
        )) {
            return CanAttackResponse.TARGET_IS_IMMUNE;
        }
        return CanAttackResponse.CAN_ATTACK;
    }

    public static canAttackByPolicy(attacker: Mobile, target: Mobile, method?: CombatMethod): CanAttackResponse {
        if (attacker.getPrivateArea() !== target.getPrivateArea()) {
            return CanAttackResponse.CANT_ATTACK_IN_AREA;
        }
        if (attacker.isPlayer() && target.isPlayer() &&
            (Wilderness.isInSafeBuilding(attacker.getLocation()) || Wilderness.isInSafeBuilding(target.getLocation()))) {
            return CanAttackResponse.CANT_ATTACK_IN_AREA;
        }
        const pluginCanAttack = PluginManager.emitCanAttack(attacker, target, method);
        if (pluginCanAttack === true) {
            return CanAttackResponse.CAN_ATTACK;
        }
        if (pluginCanAttack === false) {
            return CanAttackResponse.CANT_ATTACK_IN_AREA;
        }
        return attacker.isPlayer() && target.isPlayer()
            ? CanAttackResponse.CANT_ATTACK_IN_AREA
            : CanAttackResponse.CAN_ATTACK;
    }

    /**
     * Ancient spells evaluate possible splash victims outside the main attack start flow.
     * Keep those secondary-target checks centralized here so magic doesn't duplicate policy checks.
     */
    public static canAttackSecondaryTarget(
        attacker: Mobile,
        primaryTarget: Mobile,
        candidate: Mobile,
        spellRadius: number
    ): boolean {
        if (!candidate || candidate === attacker || candidate === primaryTarget) {
            return false;
        }
        // Duel damage is restricted to the agreed opponent, including spell splashes.
        if ((attacker.isPlayer() && attacker.getAsPlayer().getDueling().inDuel()) ||
            (candidate.isPlayer() && candidate.getAsPlayer().getDueling().inDuel())) {
            return false;
        }
        if (candidate.getHitpoints() <= 0) {
            return false;
        }
        if (!candidate.getLocation().isWithinDistance(primaryTarget.getLocation(), spellRadius)) {
            return false;
        }
        if (!AreaManager.inMulti(candidate)) {
            return false;
        }
        if (candidate.isNpc() && !candidate.getAsNpc().getCurrentDefinition().isAttackable()) {
            return false;
        }
        if (candidate.isPlayer() && CombatFactory.canAttackByPolicy(attacker, candidate) !== CanAttackResponse.CAN_ATTACK) {
            return false;
        }
        return true;
    }

    public static addPendingHit(qHit: PendingHit) {
        const attacker = qHit.getAttacker();
        const target = qHit.getTarget();
        if (target.getHitpoints() <= 0) {
            return;
        }

        if (target.isUntargetable() || target.isNeedsPlacement()) {
            // If target is teleporting or needs placement, don't register the hit.
            return;
        }

        if (attacker.isPlayer()) {
            PluginManager.emitPlayerDealtDamage({
                player: attacker.getAsPlayer(),
                target,
                hit: qHit,
            });

            // Reward the player experience after plugins have finalized this hit.
            CombatFactory.rewardExp(attacker.getAsPlayer(), qHit);

            // Java parity: apply skull at hit-queue time, before executeHit mutates
            // attacker/retaliation state (which can otherwise suppress skulling).
            if (target.isPlayer()) {
                CombatFactory.handleSkull(attacker.getAsPlayer(), target.getAsPlayer());
            }
        }

        // Add this hit to the target's hitQueue.
        target.getCombat().getHitQueue().addPendingHit(
            qHit,
            World.getProcessCycle() + qHit.getDelay() + CombatFactory.hitProcessingDelay(qHit),
        );
    }

    /**
     * OSRS processes NPCs before players each tick, so a hit queued against an NPC lands
     * one tick after the distance table (Wiki: Hit delay). Player melee keeps its tick too:
     * the target's queue drains at the start of its own turn, which has already passed.
     */
    public static hitProcessingDelay(hit: PendingHit): number {
        const targetIsNpc = hit.getTarget()?.isNpc?.() === true;
        const meleePlayerAttack = hit.getAttacker()?.isPlayer?.() === true
            && hit.getCombatType() === CombatType.MELEE;
        return targetIsNpc || meleePlayerAttack ? 1 : 0;
    }

    public static executeHit(qHit: PendingHit) {
        if (!qHit) {
            return;
        }
        const attacker = qHit.getAttacker();
        const target = qHit.getTarget();
        if (!attacker || !target || typeof target.getCombat !== "function") {
            return;
        }

        // If target/attacker is dead, don't continue.
        if (target.getHitpoints() <= 0 || attacker.getHitpoints() <= 0) {
            return;
        }

        // If target is teleporting or needs placement, don't continue to add the hit.
        if (target.isUntargetable() || target.isNeedsPlacement()) {
            return;
        }

        // Safe buildings take effect immediately, including projectiles already in flight.
        if (attacker.isPlayer() && target.isPlayer() &&
            (Wilderness.isInSafeBuilding(attacker.getLocation()) || Wilderness.isInSafeBuilding(target.getLocation()))) {
            return;
        }

        // Before target takes damage, manipulate the hit to handle last-second effects.
        let resolvedHit = target.manipulateHit(qHit);
        if (!resolvedHit) {
            return;
        }

        const method = resolvedHit.getCombatMethod();
        const combatType = resolvedHit.getCombatType();
        const damage = resolvedHit.getTotalDamage();

        // Melee blocks play when the attack is launched; projectiles block on a non-fatal impact.
        if (
            combatType !== CombatType.MELEE &&
            target.getBlockAnim() >= 0 &&
            target.getHitpoints() >
                target.getCombat().getHitQueue().getQueuedDamage() + damage
        ) {
            target.performAnimation(new Animation(target.getBlockAnim()));
        }

        // Target-side player effects.
        if (target.isPlayer()) {
            const playerTarget = target.getAsPlayer();
            if (resolvedHit.isAccurate() && damage > 0) {
                Sounds.sendSound(playerTarget, Sound.PLAYER_GETTING_HIT);
            } else {
                Sounds.sendSound(playerTarget, Sound.DEFENCE_BLOCK);
            }

            // Close interfaces while being hit (except developer rights).
            if (playerTarget.getRights() != PlayerRights.DEVELOPER && playerTarget.busy()) {
                playerTarget.getPacketSender().sendInterfaceRemoval();
            }

            // Prayer effects.
            if (resolvedHit.isAccurate()) {
                if (PrayerHandler.isActivated(playerTarget, PrayerHandler.REDEMPTION)) {
                    CombatFactory.handleRedemption(attacker, playerTarget, damage);
                }
                if (PrayerHandler.isActivated(attacker, PrayerHandler.SMITE)) {
                    CombatFactory.handleSmite(attacker, playerTarget, damage);
                }
            }
        }

        // Don't apply magic splash damage from player casts.
        const magicSplash = combatType == CombatType.MAGIC && !resolvedHit.isAccurate();
        if (!(magicSplash && attacker.isPlayer())) {
            CombatFactory.applyResolvedHitDamage(target, resolvedHit);
        }

        // Make sure to let the combat method know we finished the attack.
        if (resolvedHit.getHandleAfterHitEffects() && method != null) {
            method.handleAfterHitEffects(resolvedHit);
        }

        PluginManager.emitCombatHitResolved({ attacker, target, hit: resolvedHit });

        // Attacker-side effects.
        if (attacker.isPlayer()) {
            const playerAttacker = attacker.getAsPlayer();

            // Apply poison using OSRS-style odds and severity.
            if (damage > 0) {
                let poisonType: PoisonType | undefined;
                let rangedPoison = false;
                let applyPoison = false;
                const thrownRangedWeapon =
                    playerAttacker.getWeapon() == WeaponInterfaces.DART ||
                    playerAttacker.getWeapon() == WeaponInterfaces.KNIFE ||
                    playerAttacker.getWeapon() == WeaponInterfaces.THROWNAXE ||
                    playerAttacker.getWeapon() == WeaponInterfaces.JAVELIN;

                if (combatType == CombatType.MELEE) {
                    applyPoison = Misc.getRandom(3) === 0;
                    poisonType = CombatPoisonData.getPoisonType(
                        playerAttacker.getEquipment().get(Equipment.WEAPON_SLOT)
                    );
                } else if (combatType == CombatType.RANGED) {
                    applyPoison = Misc.getRandom(7) === 0;
                    rangedPoison = true;
                    poisonType = CombatPoisonData.getPoisonType(
                        playerAttacker.getEquipment().get(
                            thrownRangedWeapon ? Equipment.WEAPON_SLOT : Equipment.AMMUNITION_SLOT
                        )
                    );
                }

                if (applyPoison && poisonType) {
                    const poisonSeverity = rangedPoison
                        ? CombatPoisonData.getRangedSeverity(poisonType)
                        : CombatPoisonData.getMeleeSeverity(poisonType);
                    CombatFactory.poisonEntity(
                        target,
                        poisonSeverity,
                        poisonType === PoisonType.VENOM ? 2 : 1
                    );
                }
            }

        } else if (attacker.isNpc()) {
            const definition = attacker.getAsNpc().getCurrentDefinition();
            const venomous = definition.isVenomous();
            if ((definition.isPoisonous() || venomous) && Misc.getRandom(10) <= 5) {
                // Venom stores its starting damage rather than a severity, and
                // escalates from there - see CombatPoisonData.getMeleeSeverity.
                CombatFactory.poisonEntity(target, venomous ? 6 : 30, venomous ? 2 : 1);
            }
        }

        // Handle ring of recoil and vengeance for target.
        if (damage > 0) {
            if (
                target.isPlayer() &&
                target.getAsPlayer().getEquipment().get(Equipment.RING_SLOT).getId() == ItemIdentifiers.RING_OF_RECOIL
            ) {
                CombatFactory.handleRecoil(target.getAsPlayer(), attacker, damage);
            }
            if (target.hasVengeanceReturn()) {
                CombatFactory.handleVengeance(target, attacker, damage);
            }
        }

        // Mark under-attack before retaliation scheduling so retaliatory attacks
        // can correctly detect "already attacked by this target" and avoid
        // incorrectly applying skulls to the defender.
        target.getCombat().setUnderAttack(attacker);
        CombatFactory.handleRetaliation(attacker, target);
        target.getCombat().addDamage(attacker, damage);

        if (target.isPlayerBot()) {
            (target as any).getCombatInteraction?.()?.takenDamage?.(damage, attacker);
        }
    }

    public static rewardExp(player: Player, hit: PendingHit) {
        const hitDamage = Number.isFinite(hit.getTotalDamage()) ? hit.getTotalDamage() : 0;
        const hitSkills = hit.getSkills();
        // Defensive autocast should split hit XP between Magic and Defence.
        // Non-defensive magic keeps legacy magic-only hit XP behavior.
        const defensiveMagicSplit =
            hit.getCombatType() === CombatType.MAGIC &&
            hitSkills.length > 1 &&
            hitSkills.includes(Skill.MAGIC.getIndex()) &&
            hitSkills.includes(Skill.DEFENCE.getIndex());

        // OSRS pays 4 XP per damage to a melee or ranged style, and the other
        // hit skills are fixed fractions of that same 4 XP: magic 2 (4/2),
        // hitpoints 1.33 (4/3), defensive-autocast magic 1.33 (4/3) and
        // defensive-autocast defence 1 (4/4). Multiply by the base before
        // dividing so low hits are not floored away.
        // Some NPCs give less (the Gemstone Crab 87.5%: 3.5 per damage).
        const target = hit.getTarget?.();
        const OSRS_DAMAGE_XP = 4 * (target?.isNpc?.() ? target.getAsNpc().getCombatXpMultiplier?.() ?? 1 : 1);
        // Add magic exp, even if total damage is 0.
        // Since spells have a base exp reward
        if (hit.getCombatType() === CombatType.MAGIC) {
            if (player.getCombat().getPreviousCast() != null) {
                if (hit.isAccurate()) {
                    if (!defensiveMagicSplit) {
                        player.getSkillManager().addExperience(
                            Skill.MAGIC,
                            Math.floor((hitDamage * OSRS_DAMAGE_XP) / 2)/* + player.getCombat().getPreviousCast().baseExperience() */,
                            true
                        );
                    }
                } else {
                    // Splash should only give 52 exp..
                    player.getSkillManager().addExperience(Skill.MAGIC, 52, false);
                }
            }
        }

        // Don't add any exp to other skills if total damage is 0.
        if (hitDamage <= 0) {
            return;
        }

        // Add hp xp (1.33/damage)
        player.getSkillManager().addExperience(Skill.HITPOINTS, Math.floor((hitDamage * OSRS_DAMAGE_XP) / 3), true);

        // Magic xp was already added
        if (hit.getCombatType() === CombatType.MAGIC) {
            if (!defensiveMagicSplit) {
                return;
            }
            // Defensive casting is not an even split: 1.33 magic / 1.0 defence.
            player.getSkillManager().addExperience(Skill.MAGIC, Math.floor((hitDamage * OSRS_DAMAGE_XP) / 3), true);
            player.getSkillManager().addExperience(Skill.DEFENCE, hitDamage, true);
            return;
        }

        // Add all other skills xp (4/damage, split across the styles)
        let exp = hitSkills;
        for (let i of exp) {
            let skill = Skill.values()[i];
            if (!skill) {
                continue;
            }
            player.getSkillManager().addExperience(skill, Math.floor((hitDamage * OSRS_DAMAGE_XP) / exp.length), true);
        }
    }

    public static isAttacking(character: Mobile): boolean {
        return character.getCombat().getTarget() != null;
    }

    public static isBeingAttacked(character: Mobile): boolean {
        return character.getCombat().getAttacker() != null;
    }

    public static inCombat(character: Mobile): boolean {
        return CombatFactory.isAttacking(character) || CombatFactory.isBeingAttacked(character);
    }

    public static poisonEntity(entity: Mobile, poisonSeverity: number, poisonOrbType: number = 1) {
        if (poisonSeverity <= 0) {
            return;
        }

        // Venom can't be re-applied, restacked, or downgraded back to regular
        // poison once active - it only ends via a cure. Matches OSRS.
        if (entity.isVenomed()) {
            return;
        }

        const isVenom = poisonOrbType === 2;

        // If the entity is a player, we check for poison immunity. If they have
        // no immunity then we send them a message telling them that they are
        // poisoned.
        const alreadyPoisoned = entity.isPoisoned();
        if (entity.isPlayer()) {
            let player = (entity as Player);
            if (!player.getCombat().getPoisonImmunityTimer().finished()) {
                return;
            }
            if (!alreadyPoisoned) {
                player.sendMessage("You have been poisoned!");
            }
            player.getPacketSender().sendPoisonType(poisonOrbType);
        }

        entity.setVenomed(isVenom);
        // Venom overrides any existing (weaker) poison outright and starts its
        // own escalating curve; regular poison keeps the OSRS re-poison rule of
        // taking the stronger of the current and new severity.
        entity.setPoisonDamage(isVenom ? poisonSeverity : Math.max(entity.getPoisonDamage(), poisonSeverity));
        if (!alreadyPoisoned) {
            TaskManager.submit(new CombatPoisonEffect(entity));
        }
    }

    public static disableProtectionPrayers(player: Player) {
        // Player has already been prayer-disabled
        if (!player.getCombat().getPrayerBlockTimer().finished()) {
            return;
        }
        player.getCombat().getPrayerBlockTimer().start(200);
        PrayerHandler.resetPrayers(player, PrayerHandler.PROTECTION_PRAYERS);
        player.sendMessage("You have been disabled and can no longer use protection prayers.");
    }

    public static handleRecoil(player: Player, attacker: Mobile, damage: number) {
        if (damage == 0) {
            return;
        }
        const RECOIL_DMG_MULTIPLIER = 0.1;
        let returnDmg = Math.floor(Math.random() * 3) + 1 === 2 ? 0 : (damage * RECOIL_DMG_MULTIPLIER) + 1;

        // Increase recoil damage for a player.
        const recoilDamage = Number(player.getAttribute(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE) ?? 0) + returnDmg;
        player.setAttribute(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, recoilDamage);

        // Deal damage back to attacker
        attacker.getCombat().getHitQueue().addPendingDamage([new HitDamage(returnDmg, HitMask.RED)]);

        // Degrading ring of recoil for a player.
        if (recoilDamage >= 40) {
            player.getEquipment().set(Equipment.RING_SLOT, new Item(-1));
            player.getEquipment().refreshItems();
            player.sendMessage("Your ring of recoil has degraded.");
            player.setAttribute(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, 0);
        }
    }

    public static handleVengeance(character: Mobile, attacker: Mobile, damage: number) {
        if (damage <= 0) {
            return;
        }
        const returnDmg = Math.max(1, Math.floor(damage * 0.75));
        attacker.getCombat().getHitQueue().addPendingDamage([new HitDamage(returnDmg, HitMask.RED)]);
        character.forceChat("Taste Vengeance!");
        character.setHasVengeance(false);
    }

    /**
    
    Checks if a player should be skulled or not.
    
    @param attacker
    
    @param target
    */
    public static handleSkull(attacker: Player, target: Player) {
        if (attacker.isSkulled()) {
            return;
        }

        const attackerInWilderness = Wilderness.isIn(attacker);
        const targetInWilderness = Wilderness.isIn(target);
        if (!attackerInWilderness || !targetInWilderness) {
            return;
        }

        // Player bots should behave as players so we don't check them here...

        // We've probably already been skulled by this player.
        const targetHasDamagedAttacker = target.getCombat().damageMapContains(attacker);
        const attackerHasDamagedTarget = attacker.getCombat().damageMapContains(target);
        if (targetHasDamagedAttacker || attackerHasDamagedTarget) {
            return;
        }

        if (
            target.getCombat().getAttacker() != null &&
            target.getCombat().getAttacker() == attacker
        ) {
            return;
        }

        if (
            attacker.getCombat().getAttacker() != null &&
            attacker.getCombat().getAttacker() == target
        ) {
            return;
        }

        // Wiki: a white skull lasts 30 minutes after attacking a player.
        CombatFactory.skull(attacker, SkullType.WHITE_SKULL, CombatFactory.PVP_SKULL_SECONDS);
    }

    public static readonly PVP_SKULL_SECONDS = 30 * 60;

    static skull(player: Player, type: SkullType, seconds: number) {
        player.setSkullType(type);
        player.setSkullTimer(Misc.getTicks(seconds));
        player.getUpdateFlag().flag(Flag.APPEARANCE);
        if (type == SkullType.RED_SKULL) {
            player.sendMessage(
                "@bla@You have received a @red@red skull@bla@! You can no longer use the Protect item prayer!");
            PrayerHandler.deactivatePrayer(player, PrayerHandler.PROTECT_ITEM);
        } else if (type == SkullType.WHITE_SKULL) {
            player.sendMessage("You've been skulled!");
        }
    }

    static stun(character: Mobile, seconds: number, force: boolean) {
        // OSRS grants a 1-tick grace period after a stun wears off during
        // which the target can't be re-stunned - always enforced (unlike
        // the "already stunned" guard below, `force` never bypasses this).
        if (character.getTimers().has(TimerKey.STUN_IMMUNITY)) {
            return;
        }
        if (!force) {
            if (character.getTimers().has(TimerKey.STUN)) {
                return;
            }
        }

        const ticks = Misc.getTicks(seconds);
        character.getTimers().registers(TimerKey.STUN, ticks);
        character.getTimers().registers(TimerKey.STUN_IMMUNITY, ticks + 1);
        character.getCombat().reset();
        character.getMovementQueue().reset();
        character.performGraphic(new Graphic(348, GraphicHeight.HIGH));

        if (character.isPlayer()) {
            character.getAsPlayer().sendMessage("You've been stunned!");
        }
    }

    static handleRetaliation(attacker: Mobile, target: Mobile) {
        const currentTarget = target.getCombat().getTarget();
        const playerIsBusy = () => target.isPlayer() && (
            target.getMovementQueue().size() > 0 ||
            target.getMovementQueue().isMovings() ||
            TaskManager.hasActiveTask(target.getIndex(), "MovementTask") ||
            TaskManager.wasTaskActiveThisCycle(target.getIndex(), "MovementTask")
        );
        const hasActiveDifferentTarget =
            currentTarget != null &&
            currentTarget !== attacker &&
            currentTarget.getHitpoints() > 0 &&
            (typeof currentTarget.isRegistered !== "function" || currentTarget.isRegistered());

        // In multi-combat, an NPC may change to a player who has just attacked it.
        // A single NPC still has one active target and attack sequence at a time.
        const npcCanRetargetInMulti =
            target.isNpc() &&
            attacker.isPlayer() &&
            AreaManager.inMulti(attacker) &&
            AreaManager.inMulti(target);

        if (!hasActiveDifferentTarget || npcCanRetargetInMulti) {
            let auto_ret = false;
            if (target.isPlayer()) {
                auto_ret =
                    target.getAsPlayer().autoRetaliateReturn() &&
                    !playerIsBusy();
            } else if (target.isNpc()) {
                auto_ret = target.hasFlag?.("combat:no-retaliate") !== true
                    && target.getAsNpc().getMovementCoordinator().getCoordinateState() == CoordinateState.HOME;
            }

            if (!auto_ret) {
                return;
            }

            if (target.isNpc()) {
                target.getMovementQueue().reset();
            }
            // OSRS flinch: whoever was not already mid-fight waits half an attack
            // speed before swinging back. LostCity applies this to players too
            // (playerhit_n_retaliate / pvp_retaliate), not just NPCs
            // (npc_default_retaliate) - restricting it to NPCs let players counter
            // on the very next tick regardless of weapon speed.
            if (
                currentTarget == null ||
                currentTarget.getHitpoints() <= 0 ||
                !currentTarget.isRegistered()
            ) {
                const attackSpeed = Math.max(
                    1,
                    CombatFactory.getMethod(target).attackSpeed(target) | 0,
                );
                target.getCombat().extendAttackDelay(Math.floor(attackSpeed / 2));
            }
            TaskManager.submit(new CombatFactoryTask(1, target, false, () => {
                if (target.isPlayer() &&
                    (!target.getAsPlayer().autoRetaliateReturn() || playerIsBusy())) {
                    return;
                }
                target.getCombat().attack(attacker, true);
            }));
        }
    }

    static freeze(character: Mobile, seconds: number) {
        if (character.getTimers().has(TimerKey.FREEZE) || character.getTimers().has(TimerKey.FREEZE_IMMUNITY)) {
            return;
        }

        if (character.getSize() > 2) {
            return;
        }

        const ticks = Misc.getTicks(seconds);
        character.getTimers().registers(TimerKey.FREEZE, ticks);
        character.getTimers().registers(TimerKey.FREEZE_IMMUNITY, ticks + Misc.getTicks(3));
        character.getMovementQueue().reset();

        if (character.isPlayer()) {
            character.getAsPlayer().sendMessage("You have been frozen!");
            character.getAsPlayer().getPacketSender().sendEffectTimer(seconds, EffectTimer.FREEZE);
        }
    }

    private static handleRedemption(attacker: Mobile, victim: Player, damage: number) {
        if ((victim.getHitpoints() - damage) <= (victim.getSkillManager().getMaxLevel(Skill.HITPOINTS) / 10)) {
            const amountToHeal = (victim.getSkillManager().getMaxLevel(Skill.PRAYER) * .25);
            victim.performGraphic(new Graphic(436));
            victim.getSkillManager().setCurrentLevels(Skill.PRAYER, 0);
            victim.getSkillManager().setCurrentLevels(Skill.HITPOINTS, victim.getHitpoints() + amountToHeal);
            victim.sendMessage("You've run out of prayer points!");
            PrayerHandler.deactivatePrayers(victim);
        }
    }

    private static handleSmite(attacker: Mobile, victim: Player, damage: number) {
        victim.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, (damage / 4), 0);
    }

    static handleRetribution(killed: Player, killer: Player) {
        killed.performGraphic(new Graphic(437));
        if (killer.getLocation().isWithinDistance(killer.getLocation(), CombatConstants.RETRIBUTION_RADIUS)) {
            killer.getCombat().getHitQueue().addPendingDamage([
                new HitDamage(Misc.getRandom(CombatConstants.MAXIMUM_RETRIBUTION_DAMAGE), HitMask.RED)]);
        }
    }

    /**
     * @param skipReset the caller owns ending combat (post-attack renewal). The
     *   player is still told why they cannot fire - going silent here is how a
     *   fight ends with no explanation after the last arrow leaves the bow.
     */
    public static checkAmmo(player: Player, amountRequired: number, skipReset = false): boolean {
        const rangedWeapon = player.getCombat().getRangedWeapon();
        const ammoData = player.getCombat().getAmmunition();
        const reject = (message?: string) => {
            if (message) player.sendMessage(message);
            if (!skipReset) player.getCombat().reset();
            return false;
        };

        if (rangedWeapon == null) {
            return reject();
        }

        const pluginAmmoCheck = PluginManager.checkRangedAmmo(player, amountRequired, false);
        if (pluginAmmoCheck != null) {
            return pluginAmmoCheck;
        }

        if (rangedWeapon === RangedWeapon.CRYSTAL_BOW) {
            const weaponId = player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
            if (isEmptyCrystalBow(weaponId)) {
                return reject("Your crystal bow has no charges left.");
            }
            return true;
        }

        if (ammoData == null) {
            return reject("You don't have any ammunition to fire.");
        }

        if (CombatFactory.usesWeaponSlotAmmo(rangedWeapon)) {
            const weaponSlotItem = player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
            if (weaponSlotItem.getId() == -1 || weaponSlotItem.getAmount() < amountRequired) {
                return reject("You don't have the required amount of ammunition to fire that.");
            }
            return true;
        }

        let ammoSlotItem = player.getEquipment().getItems()[Equipment.AMMUNITION_SLOT];
        if (ammoSlotItem.getId() == -1 || ammoSlotItem.getAmount() < amountRequired) {
            return reject("You don't have the required amount of ammunition to fire that.");
        }

        let properReq = false;

        // BAD LOOP
        for (let d of rangedWeapon.getAmmunitionData()) {
            if (d == ammoData) {
                if (d.getItemId() == ammoSlotItem.getId()) {
                    properReq = true;
                    break;
                }
            }
        }

        if (!properReq) {
            let ammoName = ammoSlotItem.getDefinition().getName(),
                weaponName = player.getEquipment().getItems()[Equipment.WEAPON_SLOT].getDefinition().getName(),
                add = !ammoName.endsWith("s") && !ammoName.endsWith("(e)") ? "s" : "";
            return reject("You can not use " + ammoName + "" + add + " with "
                + Misc.anOrA(weaponName) + " " + weaponName + ".");
        }

        return true;
    }

    /** Fired ammunition has a 20% chance to break on impact; the rest lands on the floor. */
    private static readonly AMMO_BREAK_CHANCE = 20;

    /**
     * @param delayTicks the shot's flight time in ticks. The outcome is rolled now but the
     *   count and the floor drop only apply when the projectile lands, so the quiver matches
     *   the hitsplat instead of emptying at the bowstring.
     */
    public static decrementAmmo(player: Player, pos: Location, amount: number, delayTicks = 0) {
        // Get the ranged weapon data
        const rangedWeapon = player.getCombat().getRangedWeapon();

        // Plugin-owned ammunition (toxic blowpipe scales, the Gauntlet's bows) consumes itself.
        if (PluginManager.decrementRangedAmmo(player, pos, amount)) {
            return;
        }

        if (
            rangedWeapon === RangedWeapon.WEBWEAVER_BOW ||
            rangedWeapon === RangedWeapon.CRAWS_BOW ||
            rangedWeapon === RangedWeapon.TONALZTICS_OF_RALOS
        ) {
            // TODO: consume a revenant ether / charge; charge storage is not modelled yet.
            return;
        }

        if (rangedWeapon === RangedWeapon.CRYSTAL_BOW) {
            const weaponItem = player.getEquipment().get(Equipment.WEAPON_SLOT);
            const weaponId = weaponItem?.getId?.() ?? -1;
            if (!isChargedCrystalBow(weaponId)) {
                return;
            }
            let shotsInStage = player.getAttribute(CombatFactory.CRYSTAL_BOW_ITEM_ATTRIBUTE) === weaponId
                ? Number(player.getAttribute(CombatFactory.CRYSTAL_BOW_SHOTS_ATTRIBUTE) ?? 0)
                : 0;
            let currentWeaponId = weaponId;
            for (let shot = 0; shot < amount; shot++) {
                shotsInStage += 1;
                if (shotsInStage < CRYSTAL_BOW_SHOTS_PER_STAGE) {
                    continue;
                }
                shotsInStage = 0;
                const nextWeaponId = getNextCrystalBowItemId(currentWeaponId);
                if (nextWeaponId == null || nextWeaponId === currentWeaponId) {
                    continue;
                }
                currentWeaponId = nextWeaponId;
                weaponItem.setId(nextWeaponId);
            }

            player.setAttribute(CombatFactory.CRYSTAL_BOW_ITEM_ATTRIBUTE, currentWeaponId);
            player.setAttribute(CombatFactory.CRYSTAL_BOW_SHOTS_ATTRIBUTE, shotsInStage);
            player.getEquipment().refreshItems();
            BonusManager.update(player);
            player.getUpdateFlag().flag(Flag.APPEARANCE);

            if (isEmptyCrystalBow(currentWeaponId)) {
                player.sendMessage("Your crystal bow has run out of charges.");
            }
            return;
        }

        // Determine which slot we are decrementing ammo from.
        // Thrown weapons consume ammunition from the weapon slot.
        let slot = Equipment.AMMUNITION_SLOT;
        if (CombatFactory.usesWeaponSlotAmmo(rangedWeapon)) {
            slot = Equipment.WEAPON_SLOT;
        }
        const ammoItem = player.getEquipment().get(slot);

        // Per shot: 20% break, (80 - recovery)% land on the floor where the target stood,
        // the rest is recovered by a plugin (Ava's devices).
        const recovery = PluginManager.rangedAmmoRecovery(player);
        const dropChance = 80 - recovery;
        let lost = 0;
        let dropped = 0;
        for (let shot = 0; shot < amount; shot++) {
            const roll = Misc.getRandom(99); // 0..99
            if (roll < CombatFactory.AMMO_BREAK_CHANCE) {
                lost++;
            } else if (roll < CombatFactory.AMMO_BREAK_CHANCE + dropChance) {
                dropped++;
            }
            // Otherwise the device recovered it before it hit the floor.
        }

        const apply = () => {
            // A swap mid-flight moved this stack out of the slot; don't touch the new one.
            if (player.getEquipment().get(slot) !== ammoItem) {
                return;
            }

            if (dropped > 0 && pos) {
                ItemOnGroundManager.registerLocation(player, new Item(ammoItem.getId(), dropped), pos);
            }

            const consumed = lost + dropped;
            if (consumed > 0) {
                ammoItem.decrementAmountBy(consumed);
            }

            // If we are at 0 ammo remove the item from the equipment completely.
            if (ammoItem.getAmount() == 0) {
                player.sendMessage("You have run out of ammunition!");
                player.getEquipment().set(slot, new Item(-1));

                if (slot == Equipment.WEAPON_SLOT) {
                    WeaponInterfaceManager.assign(player);
                    player.getUpdateFlag().flag(Flag.APPEARANCE);
                }
            }

            // Refresh the equipment interface.
            player.getEquipment().refreshItems();
        };

        if (delayTicks > 0) {
            TaskManager.submit(new (class extends Task {
                constructor() {
                    super(delayTicks);
                }
                execute(): void {
                    apply();
                    this.stop();
                }
            })());
        } else {
            apply();
        }
    }

    private static usesWeaponSlotAmmo(rangedWeapon: RangedWeapon): boolean {
        if (!rangedWeapon) {
            return false;
        }

        const ammunitionData = rangedWeapon.getAmmunitionData();
        const weaponIds = rangedWeapon.getWeaponIds();
        if (!Array.isArray(ammunitionData) || ammunitionData.length !== 1 || !Array.isArray(weaponIds)) {
            return false;
        }

        const baseThrownItemId = ammunitionData[0]?.getItemId?.();
        return Number.isInteger(baseThrownItemId) && weaponIds.includes(baseThrownItemId);
    }

}


export enum CanAttackResponse {
    INVALID_TARGET,
    ALREADY_UNDER_ATTACK,
    CANT_ATTACK_IN_AREA,
    COMBAT_METHOD_NOT_ALLOWED,
    LEVEL_DIFFERENCE_TOO_GREAT,
    NOT_ENOUGH_SPECIAL_ENERGY,
    STUNNED,
    DUEL_NOT_STARTED_YET,
    DUEL_MELEE_DISABLED,
    DUEL_RANGED_DISABLED,
    DUEL_MAGIC_DISABLED,
    DUEL_WRONG_OPPONENT,
    TARGET_IS_IMMUNE,
    CAN_ATTACK,
}


class CombatFactoryTask extends Task{
    constructor(n1: number, target: Mobile, bool: boolean, private readonly execFunc: Function){
        super(n1, target, bool)
    }

    execute(): void {
        this.execFunc();
        this.stop();
    }
    
}
