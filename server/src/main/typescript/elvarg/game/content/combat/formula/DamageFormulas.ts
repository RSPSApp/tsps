import { BonusManager } from "../../../model/equipment/BonusManager";
import { Skill } from "../../../model/Skill";
import { PrayerHandler } from "../../PrayerHandler";
import { CombatType } from "../CombatType";
import { FightStyle } from "../FightStyle";
import { Mobile } from "../../../entity/impl/Mobile";
import type { Player } from "../../../entity/impl/player/Player";
import type { NPC } from "../../../entity/impl/npc/NPC";
import type { CombatSpell } from "../magic/CombatSpell";
import { applyCombatEffectiveLevelModifiers, applyMagicDamageBonusModifiers, applyMagicHitModifiers, applyMeleeHitModifiers, applyRangedHitModifiers } from "../EquipmentEffects";
import { CombatSpecial } from "../CombatSpecial";
import { SpecialAttackMaximumHitSource, WeaponSpecialTraits } from "../WeaponSpecialTraits";

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

export class DamageFormulas {
    private static scaleRatio(value: number, numerator: number, denominator: number): number {
        return Math.floor((value * numerator) / denominator);
    }

    private static scalePercent(value: number, percent: number): number {
        return DamageFormulas.scaleRatio(value, percent, 100);
    }

    // CombatSpecial currently stores fixed decimal configuration values. Convert
    // that configuration once, then keep the actual combat calculation integral.
    private static scaleSpecial(value: number, multiplier: number): number {
        return DamageFormulas.scaleRatio(value, Math.round(multiplier * 1000), 1000);
    }

    /**
     * Applies a special's damage traits to a base max hit. With no traits the
     * legacy per-weapon `strengthMultiplier` is used, so existing specials are
     * unaffected.
     */
    private static applyDamageMultiplierTraits(
        maxHit: number,
        traits: WeaponSpecialTraits | null,
        legacyMultiplier: number
    ): number {
        if (!traits) {
            return DamageFormulas.scaleSpecial(maxHit, legacyMultiplier);
        }
        const stages = traits.damageMultiplierStages;
        if (stages && stages.length > 0) {
            return stages.reduce((value, multiplier, index) => {
                const scaled = value * multiplier;
                return traits.damageMultiplierStageRounding?.[index] === "ceil"
                    ? Math.ceil(scaled)
                    : Math.floor(scaled);
            }, maxHit);
        }
        return Math.floor(maxHit * (traits.damageMultiplier ?? 1));
    }

    private static applyVisibleLevelMultiplier(level: number, multiplier: number | undefined): number {
        return multiplier === undefined ? level : Math.floor(level * multiplier);
    }

    /**
     * Max hit for a special that overrides its maximum-hit source (e.g. a melee
     * special whose damage comes from Magic). Falls back to the attack type.
     */
    public static sourceMaxHit(entity: Mobile, attackType: CombatType): number {
        const traits = CombatSpecial.activeTraitsFor(entity);
        switch (traits?.maximumHitSource) {
            case SpecialAttackMaximumHitSource.PhysicalMelee:
                return DamageFormulas.calculateMaxMeleeHit(entity);
            case SpecialAttackMaximumHitSource.Magic:
            case SpecialAttackMaximumHitSource.VisibleMagic:
                return DamageFormulas.calculateMaxMagicHit(entity);
            default:
                break;
        }
        if (attackType === CombatType.RANGED) {
            return DamageFormulas.calculateMaxRangedHit(entity);
        }
        if (attackType === CombatType.MAGIC) {
            return DamageFormulas.getMagicMaxhit(entity);
        }
        return DamageFormulas.calculateMaxMeleeHit(entity);
    }

    private static applyEffectiveLevelBonus(baseLevel: number, bonus: number): number {
        return baseLevel + bonus + 8;
    }

    private static meleeStrengthPrayerPercent(player: Player): number {
        if (PrayerHandler.isActivated(player, PrayerHandler.BURST_OF_STRENGTH)) {
            return 105;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.SUPERHUMAN_STRENGTH)) {
            return 110;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.ULTIMATE_STRENGTH)) {
            return 115;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.CHIVALRY)) {
            return 118;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.PIETY)) {
            return 123;
        }
        return 100;
    }

    private static rangedStrengthPrayerPercent(player: Player): number {
        if (PrayerHandler.isActivated(player, PrayerHandler.SHARP_EYE)) {
            return 105;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.HAWK_EYE)) {
            return 110;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.EAGLE_EYE)) {
            return 115;
        } else if (PrayerHandler.isActivated(player, PrayerHandler.RIGOUR)) {
            return 123;
        }
        return 100;
    }

    private static effectiveStrengthLevel(player: Player, visibleLevelMultiplier?: number): number {
        const prayerAdjusted = DamageFormulas.scalePercent(
            DamageFormulas.applyVisibleLevelMultiplier(
                player.getSkillManager().getCurrentLevel(Skill.STRENGTH),
                visibleLevelMultiplier
            ),
            DamageFormulas.meleeStrengthPrayerPercent(player)
        );

        let styleBonus = 0;
        let fightStyle = player.getFightType().getStyle();
        if (fightStyle == FightStyle.AGGRESSIVE)
            styleBonus = 3;
        else if (fightStyle == FightStyle.CONTROLLED)
            styleBonus = 1;

        let effectiveLevel = DamageFormulas.applyEffectiveLevelBonus(prayerAdjusted, styleBonus);

        return applyCombatEffectiveLevelModifiers(player, effectiveLevel, { combatType: CombatType.MELEE, purpose: "damage" });
    }

    public static calculateMaxMeleeHit(entity: Mobile, includeSpecial?: boolean): number {
        let maxHit: number;
        if (entity.isPlayer()) {
            let player = entity.getAsPlayer();
            const traits = CombatSpecial.activeTraitsFor(entity);
            let strengthBonus = player.getBonusManager().getOtherBonus()[BonusManager.STRENGTH];
            maxHit = DamageFormulas.scaleRatio(
                DamageFormulas.effectiveStrengthLevel(player, traits?.strengthLevelMultiplier) * (strengthBonus + 64) + 320,
                1,
                640
            );

            const special = getPlayerCombatSpecial(player);
            const specialApplies =
                traits != null ||
                ((includeSpecial ?? player.isSpecialActivated()) &&
                    special?.getCombatMethod().type() === CombatType.MELEE);
            if (specialApplies) {
                maxHit = traits?.maxHitOverride !== undefined
                    ? Math.floor(traits.maxHitOverride)
                    : DamageFormulas.applyDamageMultiplierTraits(
                        maxHit,
                        traits,
                        special?.getStrengthMultiplier?.() ?? 1
                    );
            }

        } else {
            maxHit = entity.getAsNpc().getCurrentDefinition().getMaxHit();
        }
        const adjusted = applyMeleeHitModifiers(entity, maxHit);
        return Math.floor(adjusted);
    }

    public static getMagicMaxhit(c: Mobile, spellOverride?: CombatSpell | null): number {
        let maxHit = 0;
        const spell = spellOverride ?? c.getCombat().getSelectedSpell();

        if (spell && spell.maximumHit() > 0) {
            maxHit = spell.maximumHit();
        } else if (c.isNpc()) {
            maxHit = c.getAsNpc().getDefinition().getMaxHit();
        } else {
            maxHit = 1;
        }

        const { CombatSpells } = require("../magic/CombatSpells") as typeof import("../magic/CombatSpells");
        maxHit = CombatSpells.applyChargeMaxHit(c, maxHit, spell);

        maxHit = DamageFormulas.applyMagicDamageBonus(c, maxHit);

        const demonbaneMultiplier = (spell as any)?.demonbaneDamageMultiplier?.(c);
        if (typeof demonbaneMultiplier === "number") {
            maxHit = DamageFormulas.scaleSpecial(maxHit, demonbaneMultiplier);
        }

        return Math.floor(applyMagicHitModifiers(c, maxHit));
    }

    public static getVolatileNightmareStaffBaseMaxHit(player: Player): number {
        return Math.min(
            Math.floor((player.getSkillManager().getCurrentLevel(Skill.MAGIC) * 263) / 449 + 1),
            58
        );
    }

    /**
     * Visible-Magic special base: min(configured, floor(configured*visibleMagic/99 + 1)),
     * before magic-damage bonuses. Mirrors the upstream evaluator.
     */
    private static visibleMagicBaseMaxHit(player: Player, baseMaxHit: number): number {
        const base = Math.max(0, Math.floor(baseMaxHit));
        if (base <= 0) {
            return 0;
        }
        const visibleMagic = player.getSkillManager().getCurrentLevel(Skill.MAGIC);
        return Math.min(base, Math.floor((base * visibleMagic) / 99 + 1));
    }

    public static calculateMaxMagicHit(entity: Mobile, spellOverride?: CombatSpell | null, includeSpecial?: boolean): number {
        if (entity.isPlayer()) {
            const player = entity.getAsPlayer();
            const traits = CombatSpecial.activeTraitsFor(entity);
            if (traits) {
                if (traits.maximumHitSource === SpecialAttackMaximumHitSource.VisibleMagic) {
                    return DamageFormulas.applyMagicDamageBonus(
                        player,
                        DamageFormulas.visibleMagicBaseMaxHit(player, traits.visibleMagicMaximumHit ?? 0)
                    );
                }
                if (traits.maxHitOverride !== undefined) {
                    return Math.floor(traits.maxHitOverride);
                }
            }
            const special = getPlayerCombatSpecial(player);
            const weaponId = player.getEquipment().getWeapon().getId();
            const { ItemIdentifiers } = require("../../../../util/ItemIdentifiers") as typeof import("../../../../util/ItemIdentifiers");
            if (
                (includeSpecial ?? player.isSpecialActivated()) &&
                special?.getCombatMethod().type() === CombatType.MAGIC &&
                weaponId === ItemIdentifiers.VOLATILE_NIGHTMARE_STAFF
            ) {
                return DamageFormulas.applyMagicDamageBonus(
                    player,
                    DamageFormulas.getVolatileNightmareStaffBaseMaxHit(player)
                );
            }
        }

        return DamageFormulas.getMagicMaxhit(entity, spellOverride);
    }

    private static effectiveRangedStrength(player: Player, visibleLevelMultiplier?: number): number {
        const prayerAdjusted = DamageFormulas.scalePercent(
            DamageFormulas.applyVisibleLevelMultiplier(
                player.getSkillManager().getCurrentLevel(Skill.RANGED),
                visibleLevelMultiplier
            ),
            DamageFormulas.rangedStrengthPrayerPercent(player)
        );

        let styleBonus = 0;
        let fightStyle = player.getFightType().getStyle();
        if (fightStyle == FightStyle.ACCURATE)
            styleBonus = 3;

        let effectiveLevel = DamageFormulas.applyEffectiveLevelBonus(prayerAdjusted, styleBonus);

        effectiveLevel = applyCombatEffectiveLevelModifiers(player, effectiveLevel, { combatType: CombatType.RANGED, purpose: "damage" });

        // if (dragonHunter(input))
        // rngStrength = (int) (rngStrength * 1.3f);
        return effectiveLevel;
    }

    private static maximumRangeHitDpsCalc(player: Player, includeSpecial?: boolean) {
        const traits = CombatSpecial.activeTraitsFor(player);
        let strengthBonus = player.getBonusManager().getOtherBonus()[BonusManager.RANGED_STRENGTH];
        let maxHit = DamageFormulas.scaleRatio(
            DamageFormulas.effectiveRangedStrength(player, traits?.strengthLevelMultiplier) * (strengthBonus + 64) + 320,
            1,
            640
        );

        const special = getPlayerCombatSpecial(player);
        const useSpecial = includeSpecial ?? player.isSpecialActivated();
        const specialApplies =
            traits != null ||
            (useSpecial && special != null && special.getCombatMethod().type() == CombatType.RANGED);
        if (specialApplies) {
            maxHit = traits?.maxHitOverride !== undefined
                ? Math.floor(traits.maxHitOverride)
                : DamageFormulas.applyDamageMultiplierTraits(
                    maxHit,
                    traits,
                    special?.getStrengthMultiplier?.() ?? 1
                );
        }

        return Math.floor(applyRangedHitModifiers(player, maxHit));
    }

    /**
    Calculates the maximum ranged hit for the argued entity without
    taking the victim into consideration.
    @param entity the entity to calculate the maximum hit for.
    @return the maximum ranged hit that this entity can deal.
    */
    public static calculateMaxRangedHit(entity: Mobile, includeSpecial?: boolean) {
        if (entity.isNpc()) {
            let npc = entity as unknown as NPC;
            return npc.getCurrentDefinition().getMaxHit();
        }

        let player = entity as Player;

        return DamageFormulas.maximumRangeHitDpsCalc(player, includeSpecial);
    }

    public static applyMagicDamageBonus(entity: Mobile, maxHit: number): number {
        if (!entity.isPlayer()) {
            return maxHit;
        }

        const player = entity.getAsPlayer();
        const equipmentPermille = Math.round(
            (player.getBonusManager().getOtherBonus()[BonusManager.MAGIC_STRENGTH] ?? 0) * 10
        );
        const prayerPermille = DamageFormulas.magicDamagePrayerPermille(player);

        const bonusPermille = applyMagicDamageBonusModifiers(
            player,
            equipmentPermille + prayerPermille
        );
        return DamageFormulas.scaleRatio(maxHit, 1000 + bonusPermille, 1000);
    }

    private static magicDamagePrayerPermille(player: Player): number {
        if (PrayerHandler.isActivated(player, PrayerHandler.AUGURY)) {
            return 40;
        }
        if (PrayerHandler.isActivated(player, PrayerHandler.MYSTIC_MIGHT)) {
            return 20;
        }
        if (PrayerHandler.isActivated(player, PrayerHandler.MYSTIC_LORE)) {
            return 10;
        }
        return 0;
    }

}
