import { CombatPosition } from "./CombatPosition";
import { ItemAliases } from "../../model/ItemAliases";
import { Sound } from "../../Sound";
import { Sounds } from "../../Sounds";
import { PrayerHandler } from "../PrayerHandler";
import { Dueling, DuelRule, DuelState } from "../Duelling";
import { WeaponInterfaces } from "./WeaponInterfaces";
import { WeaponInterfaceManager } from "./WeaponInterfaceManager";
import { AccuracyFormulasDpsCalc } from "./formula/AccuracyFormulasDpsCalc";
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
import { Ammunition, RangedWeapon } from "./ranged/RangedData";
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
import { applyIncomingDamageModifiers } from "./EquipmentEffects";
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
    /** Non-zero while a PendingHit is rolling: its defences belong to the impact tick. */
    private static hitRollDepth = 0;
    public static readonly RECOIL_DAMAGE_ATTRIBUTE = "ring-of-recoil:damage";
    public static readonly RECOIL_IMMUNE_ATTRIBUTE = "combat:recoil-immune";
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

            // An explicit spell click owns the action even if a weapon special is armed.
            if (player.getCombat().getCastSpell() != null) {
                return CombatFactory.MAGIC_COMBAT;
            }

            // A weapon's own resolver knows its special method (the Toxic blowpipe's
            // real method, including its drain and heal), so it comes before the
            // registered special's generic fallback method.
            for (const resolver of PluginManager.getCombatMethodResolvers()) {
                const resolved = resolver.resolve(attacker);
                if (resolved) {
                    return resolved;
                }
            }

            // An activated special owns this swing even while a spell is autocast:
            // OSRS lets the staff's special (Immolate/Invocate) override autocast.
            const special = getPlayerCombatSpecial(player);
            if (player.isSpecialActivated() && special != null) {
                return special.getCombatMethod();
            }

            if (player.getCombat().getAutocastSpell() != null && player.getEquipment().hasStaffEquipped()) {
                return CombatFactory.MAGIC_COMBAT;
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

    /**
     * Rolls a hit and, unless defences are deferred, applies this victim's defensive
     * reactions immediately. A PendingHit defers them to impact with `duringHitRoll`.
     */
    /** Runs a hit's rolls with defensive reactions deferred to the impact tick. */
    public static duringHitRoll<T>(action: () => T): T {
        CombatFactory.hitRollDepth++;
        try {
            return action();
        } finally {
            CombatFactory.hitRollDepth--;
        }
    }

    static getHitDamage(entity: Mobile, victim: Mobile, type: CombatType, bypassProtectionPrayer = false, boundsOverride?: SpecialDamageBounds, applySpecialTraits = true, applyDefences?: boolean) {
        const deferDefences = applyDefences === undefined
            ? CombatFactory.hitRollDepth > 0
            : applyDefences === false;
        const rolled = CombatFactory.rollHitDamage(entity, victim, type, bypassProtectionPrayer, boundsOverride, applySpecialTraits, !deferDefences);
        return deferDefences ? rolled : CombatFactory.applyIncomingHitDamage(entity, victim, type, rolled);
    }

    /**
     * Rolls damage only. Protection prayers are included when `applyProtectionPrayer`
     * is true; a PendingHit passes false and reads the prayer again when it lands.
     */
    public static rollHitDamage(entity: Mobile, victim: Mobile, type: CombatType, bypassProtectionPrayer = false, boundsOverride?: SpecialDamageBounds, applySpecialTraits = true, applyProtectionPrayer = true): HitDamage {
        const specialTraits = applySpecialTraits ? CombatSpecial.activeTraitsFor(entity) : null;
        if (specialTraits?.ignoreProtectionPrayer) {
            bypassProtectionPrayer = true;
        }
        const prayerType = resolveSpecialAttackType(specialTraits?.damageType) ?? type;
        let maxHit = 0;
        let minimumFloor = 0;
        if (type == CombatType.MELEE) {
            maxHit = DamageFormulas.sourceMaxHit(entity, CombatType.MELEE);
        } else if (type == CombatType.RANGED) {
            maxHit = PluginManager.modifyRangedMaxHit(entity, victim, DamageFormulas.sourceMaxHit(entity, CombatType.RANGED));
        } else if (type == CombatType.MAGIC) {
            const bounds = DamageFormulas.sourceHitBounds(entity, CombatType.MAGIC, victim);
            maxHit = bounds.maximum;
            minimumFloor = bounds.minimum;
        }
        const rolls = type == CombatType.MELEE || type == CombatType.RANGED || type == CombatType.MAGIC;
        const range = rolls
            ? CombatFactory.specialDamageRange(entity, maxHit, boundsOverride, applySpecialTraits, minimumFloor)
            : { minimum: 0, maximum: 0 };
        let damage = rolls ? CombatFactory.rollSpecialDamage(entity, maxHit, boundsOverride, applySpecialTraits, minimumFloor) : 0;

        // The roll itself, before any defence (protection prayers, shields, incoming-damage
        // modifiers) reduces it: plugins may change `damage` against the roll's own range.
        const rolled = { attacker: entity, target: victim, combatType: type, damage, minimum: range.minimum, maximum: range.maximum };
        PluginManager.emitCustomEvent("combat:hit-rolled", rolled);
        if (rolled.damage !== damage && Number.isFinite(rolled.damage)) damage = Math.max(0, Math.floor(rolled.damage));

        // Wiki (Ward of Arceuus): demons hit 10% less, that 10% rounded down first.
        if (entity.isNpc() && victim.isPlayer() && ArceuusSpells.hasWard(victim)) {
            if (entity.getAsNpc().getCurrentDefinition()?.isDemon?.()) damage -= Math.floor(damage / 10);
        }

        // Do magic effects with the calculated damage..
        // We've got our damage. We can now create a HitDamage
        // instance.
        let hitDamage = new HitDamage(damage, damage == 0 ? HitMask.BLUE : HitMask.RED);

        /**
         * Prayers decreasing damage.
         */

        // Decrease damage if victim is using the corresponding protection prayer.
        // PendingHit defers this to the impact tick so a last-tick prayer flick works.
        if (applyProtectionPrayer && !bypassProtectionPrayer) {

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
        return hitDamage;
    }

    /** Reacts once to the selected damage roll, before any per-hit multiplier and HP cap. */
    public static applyIncomingHitDamage(entity: Mobile, victim: Mobile, type: CombatType, hitDamage: HitDamage): HitDamage {
        // The Elysian spirit shield cuts damage by 25% 70% of the time (Wiki).
        if (victim.isPlayer() && Math.random() < CombatConstants.ELYSIAN_ACTIVATION_CHANCE) {
            if (victim.getAsPlayer().getEquipment().getItems()[Equipment.SHIELD_SLOT].getId() == ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD) {
                hitDamage.multiplyDamage(CombatConstants.ELYSIAN_DAMAGE_REDUCTION);
                victim.performGraphic(new Graphic(321, 40)); // Elysian spirit shield effect gfx
            }
        }

        // Plugin-owned reactions to a landed hit (crystal armour charges, Justiciar reduction).
        if (victim.isPlayer() && hitDamage.getDamage() > 0) {
            const meleeAttackBonusIndex = type == CombatType.MELEE && entity.isPlayer()
                ? entity.getAsPlayer().getFightType().getBonusType()
                : undefined;
            applyIncomingDamageModifiers(victim, hitDamage, { type, attacker: entity, meleeAttackBonusIndex });
        }

        if (type == CombatType.MELEE && isDeveloperQueuedAttackSpec(entity)) {
            hitDamage = new HitDamage(50, HitMask.RED);
        }

        return hitDamage;
    }

    /**
     * Applies the victim's defensive reactions when a pre-rolled hit actually lands.
     * Protection prayers are read now (a last-tick flick counts) and Elysian / incoming
     * damage modifiers react now rather than when the attack was launched. The roll was
     * already capped to the target's HP at roll time, so a heal after the roll can make
     * the hit non-lethal.
     */
    public static applyHitTimeDefences(hit: PendingHit): void {
        if (!hit || typeof hit.getHits !== "function") {
            return;
        }
        const hits = hit.getHits();
        if (!Array.isArray(hits) || hits.length === 0) {
            return;
        }
        const attacker = hit.getAttacker();
        const victim = hit.getTarget();
        if (!attacker || !victim) {
            return;
        }

        const protectionApplied = typeof hit.hasAppliedImpactProtection === "function"
            && hit.hasAppliedImpactProtection();
        if (!protectionApplied) {
            const bypassProtection = typeof hit.bypassesProtectionPrayer === "function"
                && hit.bypassesProtectionPrayer();
            const protectionType = typeof hit.getProtectionType === "function"
                ? hit.getProtectionType()
                : hit.getCombatType();
            if (!bypassProtection && protectionType !== undefined) {
                const prayer = PrayerHandler.getProtectingPrayer(protectionType);
                if (PrayerHandler.isActivated(victim, prayer)) {
                    const reduction = attacker.isNpc()
                        ? CombatConstants.PRAYER_DAMAGE_REDUCTION_AGAINST_NPCS
                        : CombatConstants.PRAYER_DAMAGE_REDUCTION_AGAINST_PLAYERS;
                    for (const damage of hits) damage.multiplyDamage(reduction);
                }
            }
            if (typeof hit.markImpactProtectionApplied === "function") {
                hit.markImpactProtectionApplied();
            }
        }

        const incomingApplied = typeof hit.hasAppliedImpactIncoming === "function"
            && hit.hasAppliedImpactIncoming();
        const deferred = typeof hit.defersIncomingDamage === "function" && hit.defersIncomingDamage();
        if (!incomingApplied && !deferred) {
            CombatFactory.applyImpactIncomingDamage(hit, hits, attacker, victim);
            if (typeof hit.markImpactIncomingApplied === "function") {
                hit.markImpactIncomingApplied();
            }
        }
        hit.updateTotalDamage();
    }

    /**
     * A scripted producer (Mad Angel's blows) fills the same hit in `manipulateHit`, after
     * the protection pass. Apply Elysian/equipment then, while an absorber such as
     * Nightmare Zone has already seen the protected hit and must not react again.
     */
    public static applyDeferredImpactIncoming(hit: PendingHit): void {
        if (!hit || typeof hit.getHits !== "function") {
            return;
        }
        const hits = hit.getHits();
        if (!Array.isArray(hits) || hits.length === 0) {
            return;
        }
        if (typeof hit.defersIncomingDamage !== "function" || !hit.defersIncomingDamage()) {
            return;
        }
        if (typeof hit.hasAppliedImpactIncoming === "function" && hit.hasAppliedImpactIncoming()) {
            return;
        }
        const attacker = hit.getAttacker();
        const victim = hit.getTarget();
        if (!attacker || !victim) {
            return;
        }
        CombatFactory.applyImpactIncomingDamage(hit, hits, attacker, victim);
        if (typeof hit.markImpactIncomingApplied === "function") {
            hit.markImpactIncomingApplied();
        }
        if (typeof hit.completeDeferredIncomingDamage === "function") {
            hit.completeDeferredIncomingDamage();
        }
        hit.updateTotalDamage();
    }

    /** Elysian first, then plugin-owned additive/flat equipment reductions. A miss reacts to nothing. */
    private static applyImpactIncomingDamage(hit: PendingHit, hits: HitDamage[], attacker: Mobile, victim: Mobile): void {
        for (let i = 0; i < hits.length; i++) {
            if (hits[i].getDamage() <= 0) continue;
            const resolved = CombatFactory.applyIncomingHitDamage(attacker, victim, hit.getCombatType(), hits[i]);
            if (resolved !== hits[i]) hits[i] = resolved;
        }
    }

    /** Drops a dead entity's per-cycle accuracy cache so a respawn starts from fresh levels. */
    public static clearHitRollCache(entity: Mobile): void {
        AccuracyFormulasDpsCalc.clearRollCache(entity);
    }

    /**
     * Applies an explicit per-style max hit to an incoming hit.
     *
     * NpcDefinitions carry a single max hit (the wiki's highest style), so a boss
     * whose styles cap differently passes the cap for the style it rolled - the
     * bounds ride as flat bonuses so the exact integer max survives
     * rollSpecialDamage's floor. Protection prayers still reduce the result at
     * impact unless bypassProtectionPrayer is set. Damage is capped to the
     * target's current hitpoints, matching the cap PendingHit rolls with.
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
        const bypass = options.bypassProtectionPrayer === true;
        if (bypass) hit.markProtectionBypassed();
        const rolled = CombatFactory.getHitDamage(
            attacker,
            target,
            hit.getCombatType(),
            bypass,
            {
                minimumMultiplier: 0,
                maximumMultiplier: 0,
                minimumBonus: Math.max(0, options.minHit ?? 0),
                maximumBonus: Math.max(0, Math.trunc(maxHit)),
            },
            true,
            false
        );
        hit.getHits()[0].setDamage(Math.max(0, Math.min(rolled.getDamage(), target.getHitpoints())));
        hit.updateTotalDamage();
    }

    /** Rolls one hit's damage from its range (specialDamageRange). */
    private static rollSpecialDamage(entity: Mobile, maxHit: number, boundsOverride?: SpecialDamageBounds, applySpecialTraits = true, minimumFloor = 0): number {
        const range = CombatFactory.specialDamageRange(entity, maxHit, boundsOverride, applySpecialTraits, minimumFloor);
        return Misc.randomInclusive(range.minimum, range.maximum);
    }

    /**
     * The range one hit's damage is rolled from. With no active special traits this is the ordinary
     * 0..maxHit roll; with traits it honours per-hit min/max multipliers, flat
     * bonuses and a maximum cap.
     */
    private static specialDamageRange(entity: Mobile, maxHit: number, boundsOverride?: SpecialDamageBounds, applySpecialTraits = true, minimumFloor = 0): { minimum: number; maximum: number } {
        const traits = applySpecialTraits ? CombatSpecial.activeTraitsFor(entity) : null;
        if (!traits && !boundsOverride) {
            return { minimum: Math.min(maxHit, Math.max(0, minimumFloor)), maximum: maxHit };
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
        minimum = Math.max(minimum, Math.min(maximum, Math.max(0, minimumFloor)));
        return { minimum: Math.max(0, minimum), maximum: Math.max(0, maximum) };
    }

    /**
     * Applies a resolved hit's damage. When the hit carries per-hitsplat reveal
     * delays (special `hitDelayTicks`), each later hitsplat is queued on its own
     * tick instead of landing all at once.
     */
    private static applyResolvedHitDamage(target: Mobile, resolvedHit: PendingHit): void {
        const hits = resolvedHit.getHits();
        for (const hit of hits) if (hit.getSource() == null) hit.setSource(resolvedHit.getAttacker());
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

        const attackerLocation = CombatPosition.location(attacker, target);
        const targetLocation = CombatPosition.location(target, attacker);
        if (
            CombatPosition.area(attacker, target) !== CombatPosition.area(target, attacker) ||
            attackerLocation.getZ() !== targetLocation.getZ() ||
            attackerLocation.getDistance(targetLocation) >= 40
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

    /** Multi-combat rules apply: both stand in multi, or either is an NPC that is always multi. */
    public static multiCombatBetween(attacker: Mobile, target: Mobile): boolean {
        const alwaysMulti = (mobile: Mobile) => mobile.isNpc() && mobile.getAsNpc().isMultiCombat();
        return alwaysMulti(attacker) || alwaysMulti(target) || (AreaManager.inMulti(attacker) && AreaManager.inMulti(target));
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
            () => CombatFactory.multiCombatBetween(attacker, target)
        )) {
            // An always-multi NPC (a boss's summoned minion) never ties up the one it fights: a
            // player a hellhound is biting may still attack its master in a singles lair.
            const lockedBy = (mobile: Mobile) => {
                const by = mobile.getCombat().getAttacker();
                return by != null && !(by.isNpc() && by.getAsNpc().isMultiCombat());
            };
            if (
                ServerPerf.measurePhase("combat.process.can_attack.attacker_busy", () =>
                    (
                        CombatFactory.isBeingAttacked(attacker) &&
                        attacker.getCombat().getAttacker() != target &&
                        attacker.getCombat().getAttacker().getHitpoints() > 0 &&
                        lockedBy(attacker)
                    ) || !attacker.getCombat().getHitQueue().isEmpty(target)
                )
            ) {
                return CanAttackResponse.ALREADY_UNDER_ATTACK;
            }

            // Here we check if we are already in combat with another entity.
            if (
                ServerPerf.measurePhase("combat.process.can_attack.target_busy", () =>
                    (CombatFactory.isBeingAttacked(target) && target.getCombat().getAttacker() != attacker && lockedBy(target)) ||
                    !target.getCombat().getHitQueue().isEmpty(attacker)
                )
            ) {
                return CanAttackResponse.TARGET_IN_COMBAT;
            }
        }

        // Check plugin and area attack policy.
        const areaResponse = duelActive
            ? (PluginManager.emitCanAttack(attacker, target, method) === false
                ? CanAttackResponse.CANT_ATTACK_IN_AREA : CanAttackResponse.CAN_ATTACK)
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
                    if (!CombatSpecial.affordable(player, special, drainAmount)) {
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
        if (CombatPosition.area(attacker, target) !== CombatPosition.area(target, attacker)) {
            return CanAttackResponse.CANT_ATTACK_IN_AREA;
        }
        // Across a boat's deck only content decides (sailing allows ranged and magic at sea
        // creatures): with no plugin saying yes, a deck and the shore can't fight.
        if (CombatPosition.acrossDeck(attacker, target)) {
            return PluginManager.emitCanAttack(attacker, target, method) === true
                ? CanAttackResponse.CAN_ATTACK
                : CanAttackResponse.CANT_ATTACK_IN_AREA;
        }
        if (attacker.isPlayer() && target.isPlayer() &&
            (Wilderness.isInSafeBuilding(attacker.getLocation()) || Wilderness.isInSafeBuilding(target.getLocation()))) {
            return CanAttackResponse.CANT_ATTACK_IN_AREA;
        }
        const attackerArea = attacker.getArea();
        const targetArea = target.getArea();
        const attackerCanAttack = attackerArea ? PluginManager.callArea(attackerArea, "canAttack", attacker, target, method) : null;
        if (attackerCanAttack === false) return CanAttackResponse.CANT_ATTACK_IN_AREA;
        const targetCanAttack = targetArea && targetArea !== attackerArea
            ? PluginManager.callArea(targetArea, "canAttack", attacker, target, method) : null;
        if (targetCanAttack === false) return CanAttackResponse.CANT_ATTACK_IN_AREA;
        const areaCanAttack = attackerCanAttack ?? targetCanAttack;
        const globalCanAttack = PluginManager.emitCanAttack(attacker, target, method);
        if (globalCanAttack === false) return CanAttackResponse.CANT_ATTACK_IN_AREA;
        const pluginCanAttack = areaCanAttack ?? globalCanAttack;
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
     * Area attacks evaluate secondary targets outside the main attack start flow.
     * Keep their permission checks centralized without consuming resources again.
     */
    public static canAttackSecondaryTarget(
        attacker: Mobile,
        primaryTarget: Mobile,
        candidate: Mobile,
        /** Max distance from the primary target; omit when the caller already shaped the area. */
        spellRadius?: number
    ): boolean {
        if (!candidate || candidate === attacker || candidate === primaryTarget) {
            return false;
        }
        // Registered/untargetable/needsPlacement/dying guards, so a splash can
        // never land on a corpse or an actor that has left the area.
        if (!CombatFactory.validTarget(attacker, candidate)) {
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
        if (spellRadius !== undefined && !candidate.getLocation().isWithinDistance(primaryTarget.getLocation(), spellRadius)) {
            return false;
        }
        if (!AreaManager.inMulti(candidate)) {
            return false;
        }
        if (candidate.isNpc() && !candidate.getAsNpc().getCurrentDefinition().isAttackable()) {
            return false;
        }
        if (candidate.isNpc() && candidate.getTimers().has(TimerKey.ATTACK_IMMUNITY)) {
            return false;
        }
        if (CombatFactory.canAttackByPolicy(attacker, candidate) !== CanAttackResponse.CAN_ATTACK) {
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
        }

        qHit.capDamageToBudget();

        if (attacker.isPlayer()) {
            // Reward the player experience after plugins have finalized this hit.
            if (qHit.rewardsExperience()) CombatFactory.rewardExp(attacker.getAsPlayer(), qHit);

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
     * one tick after the distance table (Wiki: Hit delay). Against a player, PID decides
     * (Wiki: "In the case of PvP, PID will be the determining factor"): the target's queue
     * drains at the start of its own turn, so a hit from a player processed before it lands
     * this tick, and one from a player processed after it lands on the next.
     */
    public static hitProcessingDelay(hit: PendingHit): number {
        return hit.getTarget()?.isNpc?.() === true ? 1 : 0;
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

        // Defensive reactions are read on the impact tick, not when the attack was rolled,
        // and before target-side consumers such as Nightmare Zone absorption spend the hit.
        CombatFactory.applyHitTimeDefences(qHit);

        // Before target takes damage, manipulate the hit to handle last-second effects.
        let resolvedHit = target.manipulateHit(qHit);
        if (!resolvedHit) {
            return;
        }
        // A replacement producer (Scurrius' landing bolt) returns a fresh hit; defend that
        // one too, because the placeholder's defences belong to the discarded hit.
        if (resolvedHit !== qHit) {
            CombatFactory.applyHitTimeDefences(resolvedHit);
        }
        // An in-place scripted producer (Mad Angel's blows) filled this hit after its
        // protection pass; resolve the deferred equipment reactions now.
        CombatFactory.applyDeferredImpactIncoming(resolvedHit);

        const method = resolvedHit.getCombatMethod();
        const combatType = resolvedHit.getCombatType();
        const damage = resolvedHit.getTotalDamage();

        // Melee blocks play when the attack is launched; projectiles block on a non-fatal impact.
        if (
            combatType !== CombatType.MELEE &&
            target.getBlockAnim() >= 0 &&
            method?.playsBlockAnimation?.() !== false &&
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
            // Redemption checks after the damage lands (HitQueue -> handleRedemption).
            // Smite follows the damage dealt, so guaranteed damage on a failed roll (Hammer Blow) drains too.
            if (damage > 0 && PrayerHandler.isActivated(attacker, PrayerHandler.SMITE)) {
                CombatFactory.handleSmite(attacker, playerTarget, damage);
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
                const poison = {
                    attacker,
                    target,
                    // Severity, not the first hit: see CombatPoisonEffect.damageFromSeverity.
                    severity: venomous ? 6 : 30,
                    venomous,
                    handled: false,
                };
                PluginManager.emitCustomEvent("combat:npc-poison", poison);
                if (!poison.handled && poison.severity > 0) {
                    CombatFactory.poisonEntity(target, poison.severity, poison.venomous ? 2 : 1);
                }
            }
        }

        // Handle ring of recoil and vengeance for target.
        if (damage > 0) {
            if (target.isPlayer() && CombatFactory.wearingRecoilRing(target.getAsPlayer())) {
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
            hitSkills.includes(Skill.DEFENCE.getIndex()) &&
            hit.getCombatMethod()?.splitsDefensiveMagicExperience() !== false;

        // OSRS pays 4 XP per damage to a melee or ranged style, and the other
        // hit skills are fixed fractions of that same 4 XP: magic 2 (4/2),
        // hitpoints 1.33 (4/3), defensive-autocast magic 1.33 (4/3) and
        // defensive-autocast defence 1 (4/4). addExperience keeps the tenths
        // (1 damage is 1.3 hitpoints XP), so nothing is floored here.
        // Some NPCs give less (the Gemstone Crab 87.5%: 3.5 per damage).
        const target = hit.getTarget?.();
        const OSRS_DAMAGE_XP = 4 * (target?.isNpc?.() ? target.getAsNpc().getCombatXpMultiplier?.() ?? 1 : 1);
        // A spell's base XP is paid once per cast by MagicCombatMethod.hits (a splash
        // gets only that), so each target's hit adds just its per-damage Magic XP.
        if (hit.getCombatType() === CombatType.MAGIC) {
            // The hit is queued before MagicCombatMethod.finished() moves the
            // active cast into previousCast, so the first cast of a session
            // must read castSpell or it would award no Magic XP at all.
            if ((player.getCombat().getCastSpell() ?? player.getCombat().getPreviousCast()) != null) {
                if (hit.isAccurate() && !defensiveMagicSplit) {
                    player.getSkillManager().addExperience(Skill.MAGIC, (hitDamage * OSRS_DAMAGE_XP) / 2, true);
                }
            }
        }

        // Don't add any exp to other skills if total damage is 0.
        if (hitDamage <= 0) {
            return;
        }

        // Add hp xp (1.33/damage)
        player.getSkillManager().addExperience(Skill.HITPOINTS, (hitDamage * OSRS_DAMAGE_XP) / 3, true);

        // Magic xp was already added
        if (hit.getCombatType() === CombatType.MAGIC) {
            if (!defensiveMagicSplit) {
                return;
            }
            // Defensive casting is not an even split: 1.33 magic / 1.0 defence.
            player.getSkillManager().addExperience(Skill.MAGIC, (hitDamage * OSRS_DAMAGE_XP) / 3, true);
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
            player.getSkillManager().addExperience(skill, (hitDamage * OSRS_DAMAGE_XP) / exp.length, true);
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

        let isVenom = poisonOrbType === 2;
        if (entity.isNpc()) {
            const definition = entity.getAsNpc().getCurrentDefinition();
            if (isVenom && definition.isVenomImmune()) {
                isVenom = false;
                // Venom stores damage; ordinary poison stores five severity
                // points per starting damage. Keep the converted poison's hit.
                poisonSeverity *= 5;
            }
            if (!isVenom && definition.isPoisonImmune()) {
                return;
            }
        }

        // If the entity is a player, we check for poison immunity. If they have
        // no immunity then we send them a message telling them that they are
        // poisoned.
        const alreadyPoisoned = entity.isPoisoned();
        if (entity.isPlayer()) {
            let player = (entity as Player);
            const protection = player.getCombat().getPoisonClock();
            if (isVenom ? protection.isVenomImmune() : !protection.finished()) {
                return;
            }
            // Content may make the player immune outright (a league relic): the same question
            // for every status the server applies.
            const status = { target: player, kind: isVenom ? "venom" : "poison", allow: true };
            PluginManager.emitCustomEvent("combat:status-apply", status);
            if (status.allow === false) {
                return;
            }
            // An accepted venom replaces the ordinary negative poison counter.
            if (isVenom) protection.clearCounter();
            if (!alreadyPoisoned) {
                player.sendMessage("You have been poisoned!");
            }
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
        // OSRS: the dragon scimitar's Sever blocks protection prayers for 8
        // ticks (4.8s). The shared timer counts whole seconds, so use 5.
        player.getCombat().getPrayerBlockTimer().start(5);
        PrayerHandler.resetPrayers(player, PrayerHandler.PROTECTION_PRAYERS);
        player.sendMessage("You have been disabled and can no longer use protection prayers.");
    }

    /** Damage a ring of recoil holds before it shatters (Wiki: Ring of recoil). */
    public static readonly RECOIL_RING_CHARGES = 40;

    /** A ring of recoil; a charged ring of suffering recoils from the RingOfSuffering plugin. */
    public static wearingRecoilRing(player: Player): boolean {
        return player.getEquipment().get(Equipment.RING_SLOT).getId() === ItemIdentifiers.RING_OF_RECOIL;
    }

    /** 10% + 1 of the damage taken, rounded down (Wiki: Ring of recoil). */
    public static recoilDamage(damage: number): number {
        return damage > 0 ? Math.floor(damage / 10) + 1 : 0;
    }

    /** Content may disable ring recoil without suppressing other reflected damage. */
    public static canReceiveRecoil(target: Mobile): boolean {
        return target.getAttribute?.(CombatFactory.RECOIL_IMMUNE_ATTRIBUTE) !== true;
    }

    /**
     * Rebounds ring of recoil damage to the attacker. The ring's 40 charges are
     * tracked per player and its last recoil deals only what is left.
     */
    public static handleRecoil(player: Player, attacker: Mobile, damage: number) {
        if (!CombatFactory.canReceiveRecoil(attacker)) return;
        let returnDmg = CombatFactory.recoilDamage(damage);
        if (returnDmg <= 0) {
            return;
        }
        const used = Math.max(0, Number(player.getAttribute(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE) ?? 0) || 0);
        returnDmg = Math.min(returnDmg, Math.max(0, CombatFactory.RECOIL_RING_CHARGES - used));
        if (returnDmg <= 0) {
            return;
        }
        attacker.getCombat().getHitQueue().addPendingDamage([new HitDamage(returnDmg, HitMask.RED).markReflected().setSource(player)]);

        if (used + returnDmg >= CombatFactory.RECOIL_RING_CHARGES) {
            player.getEquipment().set(Equipment.RING_SLOT, new Item(-1));
            player.getEquipment().refreshItems();
            player.sendMessage("<col=7f007f>Your Ring of Recoil has shattered.</col>");
            player.setAttribute(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, 0);
        } else {
            player.setAttribute(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, used + returnDmg);
        }
    }

    public static handleVengeance(character: Mobile, attacker: Mobile, damage: number) {
        if (damage <= 0) {
            return;
        }
        const returnDmg = Math.max(1, Math.floor(damage * 0.75));
        attacker.getCombat().getHitQueue().addPendingDamage([new HitDamage(returnDmg, HitMask.RED).markReflected().setSource(character)]);
        character.forceChat("Taste Vengeance!");
        character.setHasVengeance(false);
    }

    /**
    
    Checks if a player should be skulled or not.
    
    @param attacker
    
    @param target
    */
    public static handleSkull(attacker: Player, target: Player) {
        const attackerInWilderness = Wilderness.isIn(attacker);
        const targetInWilderness = Wilderness.isIn(target);
        if (!attackerInWilderness || !targetInWilderness) {
            return;
        }

        // Wiki (Skull (status)): attacking a player while skulled restarts the 30 minutes, so
        // the skull "cannot disappear during PvP combat". The skull keeps its colour.
        if (attacker.isSkulled()) {
            CombatFactory.extendSkull(attacker, CombatFactory.PVP_SKULL_SECONDS);
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
    /** Wiki: an amulet of avarice skull lasts 20 minutes after it comes off; a cape of skulls 20 from putting it on. */
    public static readonly ITEM_SKULL_SECONDS = 20 * 60;

    /** Keeps a skull (and its colour) for at least `seconds` more, without the skulled message. */
    static extendSkull(player: Player, seconds: number) {
        player.setSkullTimer(Math.max(player.getSkullTimer(), Misc.getTicks(seconds)));
    }

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
        CombatFactory.stunTicks(character, Misc.getTicks(seconds), force);
    }

    /**
     * A stun of a whole number of ticks (seconds don't divide into ticks exactly: 5.4 s is 9.000…02).
     * `graphic` replaces the default stun graphic (null for none); `message: false` leaves the
     * "You've been stunned!" message to the caller, for stuns whose message comes later.
     */
    static stunTicks(
        character: Mobile,
        ticks: number,
        force: boolean,
        options: { graphic?: Graphic | null; message?: boolean } = {}
    ) {
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

        character.getTimers().registers(TimerKey.STUN, ticks);
        character.getTimers().registers(TimerKey.STUN_IMMUNITY, ticks + 1);
        character.getCombat().reset();
        character.getMovementQueue().reset();
        const graphic = options.graphic === undefined ? new Graphic(348, GraphicHeight.HIGH) : options.graphic;
        if (graphic) character.performGraphic(graphic);

        if (character.isPlayer() && options.message !== false) {
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
                // combat:no-retaliate: a player mid-action that ignores hits (chopping an Ent trunk).
                auto_ret =
                    target.getAsPlayer().autoRetaliateReturn() &&
                    !playerIsBusy() &&
                    target.hasFlag?.("combat:no-retaliate") !== true;
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
                    (!target.getAsPlayer().autoRetaliateReturn() || playerIsBusy()
                        || target.hasFlag?.("combat:no-retaliate") === true)) {
                    return;
                }
                target.getCombat().attack(attacker, true);
            }));
        }
    }

    /** `message` is what a frozen player is told (some bosses send their own, coloured). */
    static freeze(character: Mobile, seconds: number, message: string = "You have been frozen!", source: Mobile | null = null) {
        CombatFactory.freezeTicks(character, Misc.getTicks(seconds), message, source);
    }

    /**
     * `source` is who froze them and `kind` names the freeze ("ice", "bind") for the
     * `combat:frozen` listeners, which own the rules that depend on either. A null `message`
     * sends nothing here.
     */
    static freezeTicks(character: Mobile, ticks: number, message: string | null = "You have been frozen!", source: Mobile | null = null, kind: string | null = null) {
        if (character.getTimers().has(TimerKey.FREEZE) || character.getTimers().has(TimerKey.FREEZE_IMMUNITY)) {
            return;
        }

        // Large NPCs shrug freezes off, unless one opts in (Callisto and Artio can be frozen).
        if (character.getSize() > 2 && !character.hasFlag("combat:freezable")) {
            return;
        }

        const freeze = { target: character, source, ticks, kind };
        PluginManager.emitCustomEvent("combat:freeze-duration", freeze);
        ticks = Math.max(1, Math.floor(freeze.ticks));
        character.getTimers().registers(TimerKey.FREEZE, ticks);
        character.getTimers().registers(TimerKey.FREEZE_IMMUNITY, ticks + Misc.getTicks(3));
        character.getMovementQueue().reset();

        if (character.isPlayer()) {
            if (message != null) {
                character.getAsPlayer().sendMessage(message);
            }
            character.getAsPlayer().getPacketSender().sendEffectTimer(Misc.getSeconds(ticks), EffectTimer.FREEZE);
        }
        PluginManager.emitCustomEvent("combat:frozen", { target: character, source, ticks, kind });
    }

    /**
     * Redemption, run after a hit has been applied: a living player under 10% of
     * their Hitpoints (9 or below at 99) has their prayer drained to 0 and heals
     * a quarter of their base Prayer level, rounded down. It fires on any hit,
     * including 0s, but can't save a player from a lethal one (Wiki: Redemption).
     */
    public static handleRedemption(victim: Mobile) {
        if (!victim.isPlayer()) {
            return;
        }
        const player = victim.getAsPlayer();
        const hitpoints = player.getHitpoints();
        if (hitpoints <= 0 || !PrayerHandler.isActivated(player, PrayerHandler.REDEMPTION)) {
            return;
        }
        const skills = player.getSkillManager();
        if (hitpoints * 10 >= skills.getMaxLevel(Skill.HITPOINTS)) {
            return;
        }
        player.performGraphic(new Graphic(436));
        skills.setCurrentLevels(Skill.PRAYER, 0);
        skills.setCurrentLevels(Skill.HITPOINTS, hitpoints + Math.floor(skills.getMaxLevel(Skill.PRAYER) / 4));
        player.sendMessage("You have run out of Prayer points!");
        PrayerHandler.deactivatePrayers(player);
    }

    /** Smite drains a quarter of the damage dealt from the target's Prayer, rounded down (Wiki: Smite). */
    public static handleSmite(attacker: Mobile, victim: Player, damage: number) {
        const drain = Math.floor(damage / 4);
        if (drain > 0) {
            victim.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, drain, 0);
        }
    }

    /**
     * Retribution: on death, hits the killer if they're next to the dying player
     * for up to a quarter of the dying player's base Prayer level (Wiki: Retribution).
     */
    static handleRetribution(killed: Player, killer: Player) {
        killed.performGraphic(new Graphic(437));
        if (killer.getLocation().isWithinDistance(killed.getLocation(), CombatConstants.RETRIBUTION_RADIUS)) {
            const maxHit = Math.floor(killed.getSkillManager().getMaxLevel(Skill.PRAYER) / 4);
            killer.getCombat().getHitQueue().addPendingDamage([
                new HitDamage(Misc.randomInclusive(0, maxHit), HitMask.RED).markReflected().setSource(killed)]);
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
                if (Ammunition.getForItem(ammoSlotItem.getId()) === d) {
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

    /** Percentage (0-100) of the ammunition this player fires that is recovered, e.g. by an Ava's device. */
    public static ammoRecovery(player: Player): number {
        return PluginManager.rangedAmmoRecovery(player);
    }

    /**
     * @param delayTicks the shot's flight time in ticks. The outcome is rolled now but the
     *   count and the floor drop only apply when the projectile lands, so the quiver matches
     *   the hitsplat instead of emptying at the bowstring.
     */
    public static decrementAmmo(player: Player, pos: Location, amount: number, delayTicks = 0) {
        // Get the ranged weapon data
        const rangedWeapon = player.getCombat().getRangedWeapon();

        // Plugins may save the shot's ammunition or weapon charge outright (a league perk), as
        // `magic:rune-saving` does a spell's runes; plugin-owned ammunition included.
        const ammoSaving = { player, weaponId: player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() ?? -1, saved: false };
        PluginManager.emitCustomEvent("combat:ammo-saving", ammoSaving);
        if (ammoSaving.saved) {
            return;
        }

        // Plugin-owned ammunition (toxic blowpipe scales, the Gauntlet's bows) consumes itself.
        if (PluginManager.decrementRangedAmmo(player, pos, amount, delayTicks)) {
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
                // Content may spare the charge (a league relic): the question every charged weapon asks.
                const consume = { player, itemId: currentWeaponId, skip: false };
                PluginManager.emitCustomEvent("combat:consume-charge", consume);
                if (consume.skip) {
                    continue;
                }
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
        // Content may keep some shots out of the roll altogether (a league relic): `saved` of
        // `amount` are neither broken nor dropped. The device's recovery applies to the rest.
        const saving = { player, itemId: ammoItem.getId(), amount, saved: 0 };
        PluginManager.emitCustomEvent("ranged:ammo-saving", saving);
        const rolled = amount - Math.min(amount, Math.max(0, saving.saved | 0));
        const recovery = CombatFactory.ammoRecovery(player);
        const dropChance = 80 - recovery;
        let lost = 0;
        let dropped = 0;
        for (let shot = 0; shot < rolled; shot++) {
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
    /** Single combat: someone else is fighting the target. */
    TARGET_IN_COMBAT,
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
