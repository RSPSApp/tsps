import { CombatType } from "./CombatType";

/** Rounding applied after each staged special-attack multiplier. */
export type SpecialAttackRounding = "floor" | "ceil";

export const SpecialAttackMaximumHitSource = Object.freeze({
    Standard: "standard",
    PhysicalMelee: "physical_melee",
    Magic: "magic",
    VisibleMagic: "visible_magic",
} as const);

export type SpecialAttackMaximumHitSource =
    (typeof SpecialAttackMaximumHitSource)[keyof typeof SpecialAttackMaximumHitSource];

/** Attack kind a special roll is built with; CombatType or its lower-case name. */
export type SpecialAttackType = CombatType | "melee" | "ranged" | "magic";

export type SpecialAttackTargetPattern = "forward_line";

/** Engagement-level target selection for area/footprint-aware specials. */
export interface SpecialAttackTargeting {
    readonly pattern: SpecialAttackTargetPattern;
    /** Odd number of tiles across the forward line, centred on the primary target. */
    readonly width: number;
    /** Total target cap, including the primary target. */
    readonly maxTargets: number;
    readonly requiresMultiCombat?: boolean;
    /** Replaces area targeting when the primary NPC footprint meets the size. */
    readonly largeTargetExtraHit?: {
        readonly minimumSize: number;
        readonly accuracyMultiplier: number;
    };
}

export interface SpecialAttackDamageRange {
    readonly minimumDamageMultiplier: number;
    readonly maximumDamageMultiplier: number;
}

export interface SpecialAttackFirstSuccessfulRange extends SpecialAttackDamageRange {
    /** Flat reduction applied to this branch's percentage-derived maximum. */
    readonly maximumDamageReduction?: number;
    readonly hitDamageMultipliers: readonly number[];
    readonly hitDamageBonuses?: readonly number[];
    /** Optional exact integer redistribution of the branch's rolled damage. */
    readonly distributeDamage?: (rolledDamage: number, hitCount: number) => readonly number[];
}

/**
 * Per-special roll overrides, ported from the upstream xrsps-typescript
 * `WeaponSpecialAttackTraitOverrides`. Every field is optional; a special
 * describes only what it changes. Core applies these in the hit pipeline.
 */
export interface WeaponSpecialTraits {
    // --- hit shape -------------------------------------------------------
    readonly hitCount?: number;
    /** Splits the final maximum hit across this many sequential hits. */
    readonly maximumHitSplitCount?: number;
    /** Extra reveal delays for each hit, relative to the normal hit delay. */
    readonly hitDelayTicks?: readonly number[];
    /** Replaces this swing's next-attack delay after special energy is consumed. */
    readonly attackSpeedTicks?: number;
    /** Lets an offensive special bypass the normal weapon attack-delay check. */
    readonly bypassAttackDelay?: boolean;

    // --- accuracy --------------------------------------------------------
    readonly accuracyMultiplier?: number;
    /** Applies each accuracy multiplier in order and floors after every stage. */
    readonly accuracyMultiplierStages?: readonly number[];
    /** Overrides the attack kind used to build the accuracy/max-hit roll. */
    readonly rollAttackType?: SpecialAttackType;
    /** Uses this attack kind only when building the target's defence roll. */
    readonly defenceRollAttackType?: SpecialAttackType;
    /** Multiplies the completed target defence roll for this special attack. */
    readonly defenceRollMultiplier?: number;
    /** 0 = stab, 1 = slash, 2 = crush. Forces the melee attack and defence roll. */
    readonly meleeAttackBonusIndex?: 0 | 1 | 2;
    /** 0 = stab, 1 = slash, 2 = crush. Forces only the target defence roll. */
    readonly meleeDefenceBonusIndex?: 0 | 1 | 2;
    /** Number of independent accuracy rolls resolving this one hitsplat. */
    readonly accuracyRollCount?: number;
    /** Reuses the first hitsplat's accuracy outcome for every later hitsplat. */
    readonly sharedAccuracyRollAcrossHits?: boolean;
    /** Guarantees every accuracy roll for this attack. */
    readonly guaranteedHit?: boolean;
    /** Guarantees only the first accuracy roll of the first hitsplat. */
    readonly guaranteedFirstAccuracyRoll?: boolean;
    /**
     * When the target's current hitpoints are at or below this hit's maximum
     * damage, resolves accuracy with one fixed percentage of the max attack roll.
     */
    readonly fixedAccuracyRollMultiplierWhenTargetAtOrBelowMaximumDamage?: number;

    // --- damage ----------------------------------------------------------
    readonly damageMultiplier?: number;
    /** Multiplies the visible Attack level before prayers and stance bonuses. */
    readonly attackLevelMultiplier?: number;
    /** Multiplies the visible Strength level before prayers and stance bonuses. */
    readonly strengthLevelMultiplier?: number;
    /** Applies each multiplier in order, using the matching per-stage rounding. */
    readonly damageMultiplierStages?: readonly number[];
    /** Defaults to floor when a stage does not provide an explicit mode. */
    readonly damageMultiplierStageRounding?: readonly SpecialAttackRounding[];
    readonly maximumHitSource?: SpecialAttackMaximumHitSource;
    /** Replaces the standard max hit before special damage modifiers are applied. */
    readonly maxHitOverride?: number;
    /** Base max hit for a visible-Magic special formula before magic-damage bonuses. */
    readonly visibleMagicMaximumHit?: number;
    readonly minimumDamageMultiplier?: number;
    readonly maximumDamageMultiplier?: number;
    /** Caps the completed per-hitsplat maximum after special damage scaling. */
    readonly maximumDamageCap?: number;
    /** Flat damage added after percentage-based minimum/maximum calculations. */
    readonly minimumDamageBonus?: number;
    readonly maximumDamageBonus?: number;
    /** Flat max-hit reduction when every internal accuracy roll succeeds. */
    readonly maximumHitReductionOnFullAccuracyRolls?: number;
    /** Damage ranges indexed by the number of successful internal accuracy rolls. */
    readonly damageRangeBySuccessfulAccuracyRolls?: readonly SpecialAttackDamageRange[];
    /** Stops after the first successful accuracy roll and uses its indexed range. */
    readonly firstSuccessfulAccuracyDamageRanges?: readonly SpecialAttackFirstSuccessfulRange[];
    /** Uniformly selected damage patterns used when every accuracy roll misses. */
    readonly allMissDamagePatterns?: readonly (readonly number[])[];

    // --- application -----------------------------------------------------
    readonly damageType?: SpecialAttackType;
    /** Ignores the target's matching protection prayer for this one hit. */
    readonly ignoreProtectionPrayer?: boolean;
    /** Prevents the normal attack roll for utility-only special attacks. */
    readonly skipAttack?: boolean;
    /** Multiplies an enchanted bolt's base activation chance for this shot. */
    readonly enchantedBoltEffectChanceMultiplier?: number;
    /** Forces an equipped enchanted bolt effect after this attack lands. */
    readonly guaranteedEnchantedBoltEffect?: boolean;
    /** Engagement-level area/footprint target selection for this special. */
    readonly targeting?: SpecialAttackTargeting;
    /**
     * Activating this special immediately performs an instant (out-of-delay)
     * attack and skips the energy check while the attack is queued - the
     * granite maul "one-tick" behaviour.
     */
    readonly queuedAttack?: boolean;
}

/** Resolves a trait attack type (CombatType or lower-case name) to CombatType. */
export function resolveSpecialAttackType(value: SpecialAttackType | undefined): CombatType | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value === "number") {
        return value as CombatType;
    }
    switch (String(value).toLowerCase()) {
        case "melee":
            return CombatType.MELEE;
        case "ranged":
            return CombatType.RANGED;
        case "magic":
            return CombatType.MAGIC;
        default:
            return undefined;
    }
}
