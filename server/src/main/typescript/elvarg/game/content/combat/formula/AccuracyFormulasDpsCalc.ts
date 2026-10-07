import { PrayerHandler } from "../../../content/PrayerHandler";
import { CombatType } from "../CombatType";
import { FightStyle } from '../FightStyle';
import { Misc } from "../../../../util/Misc";
import { Mobile } from "../../../entity/impl/Mobile";
import { BonusManager } from "../../../model/equipment/BonusManager";
import { Skill } from "../../../model/Skill";
import { applyCombatEffectiveLevelModifiers, applyMeleeAttackAccuracyModifiers, applyRangedAttackAccuracyModifiers, applyMagicAttackAccuracyModifiers, applyMeleeDefenseModifiers, applyRangedDefenseModifiers, applyMagicDefenseModifiers } from "../EquipmentEffects";
import type { Player } from '../../../entity/impl/player/Player';
import { World } from "../../../World";
import { PluginManager } from "../../../../plugins/PluginManager";
import { CombatSpecial } from "../CombatSpecial";
import { resolveSpecialAttackType, WeaponSpecialTraits } from "../WeaponSpecialTraits";

type RollCacheEntry = {
    cycle: number;
    defenceLevel: number;
    effectiveAttackLevel?: number;
    effectiveDefenseLevel?: number;
    effectiveRangedAttack?: number;
    effectiveMagicLevel?: number;
    attackMeleeRoll?: number;
    attackRangedRoll?: number;
    attackMagicRoll?: number;
    defenseRangedRoll?: number;
    defenseMagicRoll?: number;
    defenseMeleeRolls?: Map<number, number>;
};

const getPlayerCombatSpecial = (player: Player): any | null => {
    const accessor = (player as any)?.getCombatSpecial;
    if (typeof accessor === "function") {
        const resolved = accessor.call(player);
        if (resolved) {
            return resolved;
        }
    }
    return (player as any)?.combatSpecial ?? null;
};

export class AccuracyFormulasDpsCalc {
    private static readonly rollCache = new WeakMap<Mobile, RollCacheEntry>();

    private static scaleRatio(value: number, numerator: number, denominator: number): number {
        return Math.floor((value * numerator) / denominator);
    }

    private static scalePercent(value: number, percent: number): number {
        return AccuracyFormulasDpsCalc.scaleRatio(value, percent, 100);
    }

    private static scaleSpecial(value: number, multiplier: number): number {
        return AccuracyFormulasDpsCalc.scaleRatio(value, Math.round(multiplier * 1000), 1000);
    }

    private static getRollCache(entity: Mobile): RollCacheEntry {
        const cycle = World.getProcessCycle();
        const defenceLevel = entity.isNpc() ? entity.getAsNpc().getDefenceLevel()
            : entity.getAsPlayer().getSkillManager().getCurrentLevel(Skill.DEFENCE);
        const cached = this.rollCache.get(entity);
        if (cached && cached.cycle === cycle && cached.defenceLevel === defenceLevel) {
            return cached;
        }
        const next: RollCacheEntry = { cycle, defenceLevel, defenseMeleeRolls: new Map<number, number>() };
        this.rollCache.set(entity, next);
        return next;
    }

    static randomFloat() {
        return Math.random();
    }

    private static randomInclusive(max: number): number {
        return Misc.randomInclusive(0, Math.max(0, Math.floor(max)));
    }

    /**
     * NPC defence bonuses live at stats[10..14], in the same order as the
     * BonusManager.DEFENCE_* indices. NpcDefinitionLoader has always loaded them,
     * but every defence roll used to hard-code 0 for NPCs - so armoured monsters
     * defended as if naked. LostCity applies npc_combat_defencebonus the same way.
     */
    private static defenceBonus(entity: Mobile, bonusIndex: number): number {
        if (entity.isNpc()) {
            return entity.getAsNpc().getCurrentDefinition().getStats()[10 + bonusIndex] ?? 0;
        }
        return entity.getAsPlayer().getBonusManager().getDefenceBonus()[bonusIndex] ?? 0;
    }

    /**
     * NPC accuracy bonuses: stats[5] melee, [7] magic, [9] ranged. See
     * NpcDefinition.DEFAULT_STATS for the full slot layout. These were hard-coded
     * to 0 until monsters-complete.json carried attack bonuses, which made every
     * NPC attack roll a bare `effective x 64`.
     */
    private static npcAttackBonus(entity: Mobile, slot: number): number {
        return entity.getAsNpc().getCurrentDefinition().getStats()[slot] ?? 0;
    }

    private static meleeAttackPrayerPercent(player: Player): number {
        if (PrayerHandler.isActivated(player, PrayerHandler.CLARITY_OF_THOUGHT)) {
            return 105;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.IMPROVED_REFLEXES)) {
            return 110;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.INCREDIBLE_REFLEXES)) {
            return 115;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.CHIVALRY)) {
            return 115;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.PIETY)) {
            return 120;
        }
        return 100;
    }

    /**
     * Invisible Defence levels from the selected stance: Defensive and Longrange +3,
     * Controlled +1. Autocasting gives no invisible bonuses (Wiki: Combat Options).
     */
    private static defenceStanceBonus(player: Player): number {
        if (player.getCombat().getAutocastSpell() != null) {
            return 0;
        }
        const fightStyle = player.getFightType().getStyle();
        if (fightStyle == FightStyle.DEFENSIVE) return 3;
        if (fightStyle == FightStyle.CONTROLLED) return 1;
        return 0;
    }

    /** A powered staff's Accurate style: a magic attack style, not a staff's melee bash. */
    private static usingPoweredStaffAccurate(player: Player): boolean {
        const fightType = player.getFightType();
        return fightType.getBonusType() === BonusManager.ATTACK_MAGIC
            && fightType.getStyle() == FightStyle.ACCURATE;
    }

    private static defencePrayerPercent(player: Player): number {
        if (PrayerHandler.isActivated(player, PrayerHandler.THICK_SKIN)) {
            return 105;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.ROCK_SKIN)) {
            return 110;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.STEEL_SKIN)) {
            return 115;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.CHIVALRY)) {
            return 120;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.PIETY)) {
            return 125;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.RIGOUR)) {
            return 125;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.AUGURY)) {
            return 125;
        }
        return 100;
    }

    private static rangedAttackPrayerPercent(player: Player): number {
        if (PrayerHandler.isActivated(player, PrayerHandler.SHARP_EYE)) {
            return 105;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.HAWK_EYE)) {
            return 110;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.EAGLE_EYE)) {
            return 115;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.RIGOUR)) {
            return 120;
        }
        return 100;
    }

    private static magicAttackPrayerPercent(player: Player): number {
        if (PrayerHandler.isActivated(player, PrayerHandler.MYSTIC_WILL)) {
            return 105;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.MYSTIC_LORE)) {
            return 110;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.MYSTIC_MIGHT)) {
            return 115;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.AUGURY)) {
            return 125;
        }
        return 100;
    }

    /**
     * Applies a special's accuracy traits to a completed attack roll. Falls back
     * to the legacy per-weapon `accuracyMultiplier` when no traits are declared,
     * so existing specials are unaffected.
     */
    private static applyAccuracyTraits(
        attRoll: number,
        entity: Mobile,
        combatType: CombatType,
        traits: WeaponSpecialTraits | null
    ): number {
        if (!entity.isPlayer()) {
            return attRoll;
        }
        const player = entity.getAsPlayer();
        const special = getPlayerCombatSpecial(player);
        if (special == null || !player.isSpecialActivated()) {
            return attRoll;
        }
        if (traits == null && special.getCombatMethod().type() !== combatType) {
            return attRoll;
        }
        const stages = traits?.accuracyMultiplierStages;
        if (stages && stages.length > 0) {
            return stages.reduce((roll, multiplier) => Math.floor(roll * multiplier), attRoll);
        }
        const multiplier = traits?.accuracyMultiplier ?? special.getAccuracyMultiplier();
        return AccuracyFormulasDpsCalc.scaleSpecial(attRoll, multiplier);
    }

    /**
     * Resolves the attacker and target rolls for an attack, honouring special traits.
     *
     * `defenceType` is the per-method override used by attacks that roll one
     * style's accuracy against another style's defence (Kree'arra's ranged
     * magic); special traits still win over it when declared.
     */
    public static specialRolls(
        entity: any,
        enemy: any,
        style: any,
        defenceType?: CombatType
    ): { attack: number; defence: number } | null {
        const traits: WeaponSpecialTraits | null = CombatSpecial.activeTraitsFor(entity);
        const attackStyle = resolveSpecialAttackType(traits?.rollAttackType) ?? style;
        const defenceStyle = resolveSpecialAttackType(traits?.defenceRollAttackType) ?? defenceType ?? attackStyle;

        let attRoll: number;
        if (attackStyle === CombatType.MELEE) {
            attRoll = AccuracyFormulasDpsCalc.attackMeleeRoll(entity);
        } else if (attackStyle === CombatType.RANGED) {
            attRoll = AccuracyFormulasDpsCalc.attackRangedRoll(entity);
            attRoll = PluginManager.modifyRangedAttackRoll(entity, enemy, attRoll);
        } else if (attackStyle === CombatType.MAGIC) {
            attRoll = AccuracyFormulasDpsCalc.attackMagicRoll(entity);
        } else {
            return null;
        }

        let defRoll: number;
        if (defenceStyle === CombatType.MELEE) {
            const meleeIndex = traits?.meleeAttackBonusIndex
                ?? (entity.isNpc() ? 3 : entity.getAsPlayer().getFightType().getBonusType());
            const defenceIndex = traits?.meleeDefenceBonusIndex ?? meleeIndex;
            defRoll = AccuracyFormulasDpsCalc.defenseMeleeRoll(enemy, defenceIndex);
        } else if (defenceStyle === CombatType.RANGED) {
            defRoll = AccuracyFormulasDpsCalc.defenseRangedRoll(enemy);
        } else {
            defRoll = AccuracyFormulasDpsCalc.defenseMagicRoll(enemy);
        }

        if (traits?.defenceRollMultiplier !== undefined) {
            defRoll = Math.floor(defRoll * traits.defenceRollMultiplier);
        }
        if (entity.isNpc()) {
            attRoll = Math.floor(attRoll * entity.getAsNpc().getRollFactor());
        }
        if (enemy.isNpc()) {
            defRoll = Math.floor(defRoll * enemy.getAsNpc().getRollFactor());
        }

        return { attack: attRoll, defence: defRoll };
    }

    public static rollAccuracy(entity: any, enemy: any, style: any, defenceType?: CombatType) {
        const rolls = AccuracyFormulasDpsCalc.specialRolls(entity, enemy, style, defenceType);
        if (rolls == null) {
            return false;
        }
        return this.randomInclusive(rolls.attack) > this.randomInclusive(rolls.defence);
    }

    /** Number of successful independent accuracy rolls out of `count`. */
    public static rollAccuracyCount(entity: any, enemy: any, style: any, count: number, defenceType?: CombatType): number {
        let successful = 0;
        for (let roll = 0; roll < Math.max(0, Math.trunc(count)); roll++) {
            if (AccuracyFormulasDpsCalc.rollAccuracy(entity, enemy, style, defenceType)) {
                successful++;
            }
        }
        return successful;
    }

    /**
     * Single fixed-percentage accuracy roll used by execute-window specials:
     * the attack roll is scaled, then compared deterministically to the defence roll.
     */
    public static rollFixedAccuracy(entity: any, enemy: any, style: any, multiplier: number, defenceType?: CombatType): boolean {
        const rolls = AccuracyFormulasDpsCalc.specialRolls(entity, enemy, style, defenceType);
        if (rolls == null) {
            return false;
        }
        const attack = Math.max(0, Math.floor(rolls.attack * multiplier));
        const defence = Math.max(0, Math.floor(rolls.defence));
        if (attack >= defence) {
            return true;
        }
        return Math.random() < (attack + 1) / (defence + 1);
    }

    public static hitChance(attRoll: number, defRoll: number) {

        if (attRoll > defRoll) {
            return 1 - ((defRoll + 2) / (2 * (attRoll + 1)));
        } else {
            return attRoll / (2 * (defRoll + 1));
        }
    }

    public static effectiveAttackLevel(entity: Mobile) {
        const cache = this.getRollCache(entity);
        if (cache.effectiveAttackLevel != null) {
            return cache.effectiveAttackLevel;
        }
        if (entity.isNpc()) {
            const att = entity.getAsNpc().getCurrentDefinition().getStats()[0] + 9;
            cache.effectiveAttackLevel = att;
            return att;
        }

        let player = entity.getAsPlayer();
        const traits = CombatSpecial.activeTraitsFor(entity);
        let visibleAttack = player.getSkillManager().getCurrentLevel(Skill.ATTACK);
        if (traits?.attackLevelMultiplier !== undefined) {
            visibleAttack = Math.floor(visibleAttack * traits.attackLevelMultiplier);
        }
        let att = AccuracyFormulasDpsCalc.scalePercent(
            visibleAttack,
            AccuracyFormulasDpsCalc.meleeAttackPrayerPercent(player)
        );

        let fightStyle = player.getFightType().getStyle();
        if (fightStyle == FightStyle.ACCURATE)
            att += 3;
        else if (fightStyle == FightStyle.CONTROLLED)
            att += 1;
        att += 8;

        att = applyCombatEffectiveLevelModifiers(entity, att, { combatType: CombatType.MELEE, purpose: "accuracy" });

        cache.effectiveAttackLevel = att;
        return att;
    }

    public static attackMeleeRoll(entity: Mobile) {
        const cache = this.getRollCache(entity);
        if (cache.attackMeleeRoll != null) {
            return cache.attackMeleeRoll;
        }
        let attRoll = AccuracyFormulasDpsCalc.effectiveAttackLevel(entity);

        if (entity.isNpc()) {
            // NPCs have a single melee accuracy bonus, not per-style ones.
            attRoll *= AccuracyFormulasDpsCalc.npcAttackBonus(entity, 5) + 64;
            cache.attackMeleeRoll = Math.floor(attRoll);
            return cache.attackMeleeRoll;
        }

        let player = entity.getAsPlayer();

        let attStab = player.getBonusManager().getAttackBonus()[BonusManager.ATTACK_STAB];
        let attSlash = player.getBonusManager().getAttackBonus()[BonusManager.ATTACK_SLASH];
        let attCrush = player.getBonusManager().getAttackBonus()[BonusManager.ATTACK_CRUSH];

        const traits = CombatSpecial.activeTraitsFor(entity);
        const bonusType = traits?.meleeAttackBonusIndex ?? player.getFightType().getBonusType();
        switch (bonusType) {
            case BonusManager.ATTACK_STAB:
                attRoll *= attStab + 64;
                break;
            case BonusManager.ATTACK_SLASH:
                attRoll *= attSlash + 64;
                break;
            case BonusManager.ATTACK_CRUSH:
                attRoll *= attCrush + 64;
                break;
            default:
                let maxAtt = Math.max(attStab, Math.max(attCrush, attSlash));
                attRoll *= maxAtt + 64;
        }

        // Gear bonuses (salve, slayer helm, ...) scale the finished roll (Wiki DPS calculator).
        attRoll = Math.floor(applyMeleeAttackAccuracyModifiers(player, attRoll));
        attRoll = AccuracyFormulasDpsCalc.applyAccuracyTraits(attRoll, entity, CombatType.MELEE, traits);

        cache.attackMeleeRoll = Math.floor(attRoll);
        return cache.attackMeleeRoll;
    }

    public static effectiveDefenseLevel(enemy: Mobile) {
        const cache = this.getRollCache(enemy);
        if (cache.effectiveDefenseLevel != null) {
            return cache.effectiveDefenseLevel;
        }
        if (enemy.isNpc()) {
            cache.effectiveDefenseLevel = cache.defenceLevel + 9;
            return cache.effectiveDefenseLevel;
        }

        let player = enemy.getAsPlayer();
        let def = AccuracyFormulasDpsCalc.scalePercent(
            player.getSkillManager().getCurrentLevel(Skill.DEFENCE),
            AccuracyFormulasDpsCalc.defencePrayerPercent(player)
        );

        def += AccuracyFormulasDpsCalc.defenceStanceBonus(player) + 8;

        def = Math.floor(applyMeleeDefenseModifiers(player, def));

        cache.effectiveDefenseLevel = def;
        return def;
    }

    private static calcDefenseMeleeRoll(entity: Mobile, enemy: Mobile) {
        let bonusType = (entity.isNpc() ? 3 /* Default case */ : entity.getAsPlayer().getFightType().getBonusType());

        return AccuracyFormulasDpsCalc.defenseMeleeRoll(enemy, bonusType);
    }

    public static defenseMeleeRoll(enemy: Mobile, bonusType: number) {
        const cache = this.getRollCache(enemy);
        const cachedRoll = cache.defenseMeleeRolls?.get(bonusType);
        if (cachedRoll != null) {
            return cachedRoll;
        }
        let defLevel = AccuracyFormulasDpsCalc.effectiveDefenseLevel(enemy);

        let defStab = AccuracyFormulasDpsCalc.defenceBonus(enemy, BonusManager.DEFENCE_STAB);
        let defSlash = AccuracyFormulasDpsCalc.defenceBonus(enemy, BonusManager.DEFENCE_SLASH);
        let defCrush = AccuracyFormulasDpsCalc.defenceBonus(enemy, BonusManager.DEFENCE_CRUSH);

        switch (bonusType) {
            case BonusManager.ATTACK_STAB:
                defLevel *= defStab + 64;
                break;
            case BonusManager.ATTACK_SLASH:
                defLevel *= defSlash + 64;
                break;
            case BonusManager.ATTACK_CRUSH:
                defLevel *= defCrush + 64;
                break;
            default:
                let maxDef = Math.max(defStab, Math.max(defCrush, defSlash));
                defLevel *= maxDef + 64;
        }

        const resolved = Math.floor(defLevel);
        cache.defenseMeleeRolls?.set(bonusType, resolved);
        return resolved;
    }

    // Ranged
    public static defenseRangedRoll(enemy: Mobile) {
        const cache = this.getRollCache(enemy);
        if (cache.defenseRangedRoll != null) {
            return cache.defenseRangedRoll;
        }
        let defLevel = AccuracyFormulasDpsCalc.effectiveDefenseLevel(enemy);

        const defRange = AccuracyFormulasDpsCalc.defenceBonus(enemy, BonusManager.DEFENCE_RANGE);

        defLevel = applyRangedDefenseModifiers(enemy, defLevel);
        defLevel *= defRange + 64;

        cache.defenseRangedRoll = Math.floor(defLevel);
        return cache.defenseRangedRoll;
    }

    private static effectiveRangedAttack(entity: Mobile) {
        const cache = this.getRollCache(entity);
        if (cache.effectiveRangedAttack != null) {
            return cache.effectiveRangedAttack;
        }
        if (entity.isNpc()) {
            // Prayer bonuses don't apply to NPCs (yet)
            cache.effectiveRangedAttack = entity.getAsNpc().getCurrentDefinition().getStats()[3] + 9;
            return cache.effectiveRangedAttack;
        }

        let player = entity.getAsPlayer();
        let rngStrength = AccuracyFormulasDpsCalc.scalePercent(
            player.getSkillManager().getCurrentLevel(Skill.RANGED),
            AccuracyFormulasDpsCalc.rangedAttackPrayerPercent(player)
        );

        let fightStyle = player.getFightType().getStyle();
        if (fightStyle == FightStyle.ACCURATE)
            rngStrength += 3;
        rngStrength += 8;

        rngStrength = applyCombatEffectiveLevelModifiers(entity, rngStrength, { combatType: CombatType.RANGED, purpose: "accuracy" });

        //    if (dragonHunter(input))
        //        rngStrength =
        cache.effectiveRangedAttack = rngStrength;
        return rngStrength;
    }

    public static attackRangedRoll(entity: Mobile) {
        const cache = this.getRollCache(entity);
        if (cache.attackRangedRoll != null) {
            return cache.attackRangedRoll;
        }
        let accuracyBonus = (entity.isNpc()
            ? AccuracyFormulasDpsCalc.npcAttackBonus(entity, 9)
            : entity.getAsPlayer().getBonusManager().getAttackBonus()[BonusManager.ATTACK_RANGE]);

        let attRoll = AccuracyFormulasDpsCalc.effectiveRangedAttack(entity);

        attRoll *= (accuracyBonus + 64);
        if (entity.isPlayer()) {
            attRoll = Math.floor(applyRangedAttackAccuracyModifiers(entity, attRoll));
        }

        attRoll = AccuracyFormulasDpsCalc.applyAccuracyTraits(
            attRoll,
            entity,
            CombatType.RANGED,
            CombatSpecial.activeTraitsFor(entity)
        );

        cache.attackRangedRoll = Math.floor(attRoll);
        return cache.attackRangedRoll;
    }

    private static effectiveMagicLevel(entity: Mobile) {
        const cache = this.getRollCache(entity);
        if (cache.effectiveMagicLevel != null) {
            return cache.effectiveMagicLevel;
        }
        if (entity.isNpc()) {
            // Prayer bonuses don't apply to NPCs (yet)
            const mag = entity.getAsNpc().getCurrentDefinition().getStats()[4] + 9;
            cache.effectiveMagicLevel = mag;
            return mag;
        }

        let player = entity.getAsPlayer();
        let mag = AccuracyFormulasDpsCalc.scalePercent(
            player.getSkillManager().getCurrentLevel(Skill.MAGIC),
            AccuracyFormulasDpsCalc.magicAttackPrayerPercent(player)
        );

        // +8 base and +1 for every cast; a powered staff on Accurate adds 2 more
        // (the Wiki DPS calculator). A staff's own bash/pound/focus stances are
        // melee styles and give magic nothing.
        mag += 9;
        if (AccuracyFormulasDpsCalc.usingPoweredStaffAccurate(player)) {
            mag += 2;
        }

        mag = applyCombatEffectiveLevelModifiers(entity, mag, { combatType: CombatType.MAGIC, purpose: "accuracy" });

        cache.effectiveMagicLevel = mag;
        return mag;
    }

    public static defenseMagicRoll(enemy: Mobile): number {
        const cache = this.getRollCache(enemy);
        if (cache.defenseMagicRoll != null) {
            return cache.defenseMagicRoll;
        }
        let defLevel: number;

        if (enemy.isNpc()) {
            defLevel = enemy.getAsNpc().getCurrentDefinition().getStats()[4] + 9;
        } else {
            const player = enemy.getAsPlayer();
            const magicLevel = AccuracyFormulasDpsCalc.scalePercent(
                player.getSkillManager().getCurrentLevel(Skill.MAGIC),
                AccuracyFormulasDpsCalc.magicAttackPrayerPercent(player)
            );
            const defenceLevel = AccuracyFormulasDpsCalc.scalePercent(
                player.getSkillManager().getCurrentLevel(Skill.DEFENCE),
                AccuracyFormulasDpsCalc.defencePrayerPercent(player)
            );
            // 70% Magic and 30% Defence, each rounded down, then the Defence
            // stance bonus and +8 (the Wiki DPS calculator's player defence roll).
            defLevel = AccuracyFormulasDpsCalc.scaleRatio(magicLevel, 7, 10)
                + AccuracyFormulasDpsCalc.scaleRatio(defenceLevel, 3, 10)
                + AccuracyFormulasDpsCalc.defenceStanceBonus(player)
                + 8;
            defLevel = applyMagicDefenseModifiers(player, defLevel);
        }

        let defRange = AccuracyFormulasDpsCalc.defenceBonus(enemy, BonusManager.DEFENCE_MAGIC);

        defLevel *= (defRange + 64);

        cache.defenseMagicRoll = Math.floor(defLevel);
        return cache.defenseMagicRoll;
    }

    public static attackMagicRoll(entity: Mobile): number {
        const cache = this.getRollCache(entity);
        if (cache.attackMagicRoll != null) {
            return cache.attackMagicRoll;
        }
        let accuracyBonus = (entity.isNpc()
            ? AccuracyFormulasDpsCalc.npcAttackBonus(entity, 7)
            : entity.getAsPlayer().getBonusManager().getAttackBonus()[BonusManager.ATTACK_MAGIC]);

        let attRoll = AccuracyFormulasDpsCalc.effectiveMagicLevel(entity);
        attRoll *= (accuracyBonus + 64);
        if (entity.isPlayer()) {
            attRoll = Math.floor(applyMagicAttackAccuracyModifiers(entity, attRoll));
        }

        attRoll = AccuracyFormulasDpsCalc.applyAccuracyTraits(
            attRoll,
            entity,
            CombatType.MAGIC,
            CombatSpecial.activeTraitsFor(entity)
        );

        const demonbaneMultiplier = (entity.getCombat().getSelectedSpell() as any)?.demonbaneAccuracyMultiplier?.(entity);
        if (typeof demonbaneMultiplier === "number") {
            attRoll = AccuracyFormulasDpsCalc.scaleSpecial(attRoll, demonbaneMultiplier);
        }

        cache.attackMagicRoll = Math.floor(attRoll);
        return cache.attackMagicRoll;
    }
}
