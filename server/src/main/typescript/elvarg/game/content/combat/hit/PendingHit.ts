import { CombatFactory } from "../CombatFactory";
import { HitDamage } from "./HitDamage";
import { CombatType } from "../CombatType";
import { CombatMethod } from "../method/CombatMethod";
import { Mobile } from "../../../entity/impl/Mobile";
import type { Player } from "../../../entity/impl/player/Player";
import { AccuracyFormulasDpsCalc } from "../formula/AccuracyFormulasDpsCalc";
import { HitMask } from "./HitMask";
import { ServerPerf } from "../../../../util/ServerPerf";
import { ArceuusSpells } from "../magic/ArceuusSpells";
import { PluginManager } from "../../../../plugins/PluginManager";
import { CombatSpecial } from "../CombatSpecial";
import { DamageFormulas } from "../formula/DamageFormulas";
import type { SpecialDamageBounds } from "../CombatFactory";
import type { WeaponSpecialTraits } from "../WeaponSpecialTraits";

type PendingHitConfig = {
    delay?: number;
    handleAfterHitEffects?: boolean;
    hitAmount?: number;
    rollAccuracy?: boolean;
    /** False for damage that pays its own XP (or none), skipping the usual combat XP. */
    experience?: boolean;
};

export class PendingHit {
    private attacker: Mobile;
    private target: Mobile;
    private method: CombatMethod;
    private combatType: CombatType;
    private hits: HitDamage[];
    private totalDamage = 0;
    private readonly delay: number;
    private accurate: boolean;
    private handleAfterHitEffects: boolean;
    private experience = true;
    /** Optional per-hitsplat extra reveal delays (from `hitDelayTicks`). */
    private hitDelays?: number[];

    constructor(attacker: Mobile, target: Mobile, method: CombatMethod, delayOrConfig?: number | PendingHitConfig, handleAfterHitEffects?: boolean) {
        this.attacker = attacker;
        this.target = target;
        this.method = method;
        this.combatType = method.type();

        let resolvedDelay = 0;
        let resolvedHandleAfterHitEffects = true;
        let resolvedHitAmount = 1;
        let resolvedRollAccuracy = true;

        if (typeof delayOrConfig === "number") {
            resolvedDelay = delayOrConfig;
            if (typeof handleAfterHitEffects === "boolean") {
                resolvedHandleAfterHitEffects = handleAfterHitEffects;
            }
        } else if (delayOrConfig && typeof delayOrConfig === "object") {
            if (Number.isInteger(delayOrConfig.delay)) {
                resolvedDelay = delayOrConfig.delay as number;
            }
            if (typeof delayOrConfig.handleAfterHitEffects === "boolean") {
                resolvedHandleAfterHitEffects = delayOrConfig.handleAfterHitEffects;
            }
            if (Number.isInteger(delayOrConfig.hitAmount) && (delayOrConfig.hitAmount as number) > 0) {
                resolvedHitAmount = delayOrConfig.hitAmount as number;
            }
            if (typeof delayOrConfig.rollAccuracy === "boolean") {
                resolvedRollAccuracy = delayOrConfig.rollAccuracy;
            }
            if (delayOrConfig.experience === false) {
                this.experience = false;
            }
        }

        this.hits = this.prepareHits(resolvedHitAmount, resolvedRollAccuracy);
        this.delay = Math.max(0, resolvedDelay);
        this.handleAfterHitEffects = resolvedHandleAfterHitEffects;
    }

    public getAttacker(): Mobile {
        return this.attacker;
    }

    public getTarget(): Mobile {
        return this.target;
    }

    public getCombatMethod(): CombatMethod {
        return this.method;
    }

    public getHits(): HitDamage[] {
        return this.hits;
    }

    public getDelay(): number {
        return this.delay;
    }

    public getTotalDamage(): number {
        return this.totalDamage;
    }

    /** Whether the attacker gets the usual combat XP for this hit. */
    public rewardsExperience(): boolean {
        return this.experience;
    }

    public isAccurate(): boolean {
        return this.accurate;
    }

    public setTotalDamage(damage: number): void {
        for (let hit of this.hits) {
            hit.setDamage(damage);
        }
        this.updateTotalDamage();
    }

    public setHandleAfterHitEffects(handleAfterHitEffects: boolean): PendingHit {
        this.handleAfterHitEffects = handleAfterHitEffects;
        return this;
    }

    public getHandleAfterHitEffects(): boolean {
        return this.handleAfterHitEffects;
    }

    /** Per-hitsplat extra reveal delays, or undefined when all land together. */
    public getHitDelays(): readonly number[] | undefined {
        return this.hitDelays;
    }

    private prepareHits(hitAmount: number, rollAccuracy: boolean): HitDamage[] {
        // Check the hit amounts.
        if (hitAmount > 4) {
            throw new Error(
                "Illegal number of hits! The maximum number of hits per turn is 4.");
        } else if (hitAmount < 0) {
            throw new Error(
                "Illegal number of hits! The minimum number of hits per turn is 0.");
        }

        if (this.attacker == null || this.target == null) {
            return null;
        }

        // Utility-only specials (e.g. stat boosts that resolve outside the hit
        // pipeline) declare skipAttack and produce no hitsplat.
        const traits = CombatSpecial.activeTraitsFor(this.attacker);
        if (traits?.skipAttack === true) {
            this.totalDamage = 0;
            return [];
        }

        // Declarative specials can request extra hits without hand-rolling hits().
        if (traits?.hitCount !== undefined) {
            hitAmount = Math.min(4, Math.max(hitAmount, Math.trunc(traits.hitCount)));
        }
        if (traits?.hitDelayTicks) {
            this.hitDelays = [...traits.hitDelayTicks].map((tick) => Math.max(0, Math.trunc(tick)));
        }

        this.totalDamage = 0;

        // Damage is capped to the HP the target had when the blow was rolled, the
        // way LostCity does it (min(randominc(maxhit), stat(hitpoints))). This is
        // what makes tick-eating work: healing after the roll but before the hit
        // lands leaves the already-capped damage non-lethal. It also keeps XP
        // honest, since XP is awarded from this total at swing time rather than
        // from an uncapped overkill roll.
        let remaining = Math.max(0, this.target.getHitpoints());
        const capToRemaining = (damage: HitDamage): HitDamage => {
            if (damage.getDamage() > remaining) {
                damage.setDamage(remaining);
            }
            remaining -= damage.getDamage();
            return damage;
        };

        if (hitAmount === 1) {
            const roll = { attacker: this.attacker, target: this.target, combatType: this.combatType, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer: false };
            PluginManager.emitCombatHitRoll(roll);
            const resolved = PendingHit.withForcedMax(this.rollSpecialTraits(traits, roll.forceAccurate, rollAccuracy, 0), roll.forceMaxHit);
            this.accurate = resolved.accurate;
            const damage: HitDamage = this.accurate
                ? ServerPerf.measurePhase(
                    "combat.process.method_hits.damage",
                    () => CombatFactory.getHitDamage(this.attacker, this.target, this.combatType, roll.bypassProtectionPrayer, resolved.bounds)
                )
                : new HitDamage(0, HitMask.BLUE);
            if (this.accurate && this.attacker.isPlayer() && this.target.isPlayer()) {
                ArceuusSpells.applyCorruption(this.attacker.getAsPlayer(), this.target.getAsPlayer());
            }
            ServerPerf.measurePhase(
                "combat.process.method_hits.extra_rolls",
                () => CombatFactory.applyExtraHitRolls(
                    this.attacker,
                    this.target,
                    this.combatType,
                    damage,
                    this.accurate,
                    this.method
                )
            );
            capToRemaining(damage);
            this.totalDamage = damage.getDamage();
            return [damage];
        }

        if (traits?.firstSuccessfulAccuracyDamageRanges?.length) {
            const resolvedBranch = this.resolveFirstSuccessfulRanges(traits, capToRemaining);
            if (resolvedBranch) {
                return resolvedBranch;
            }
        }

        let hits: HitDamage[] = new Array(hitAmount);
        let firstAccurate: boolean | undefined;
        let firstBounds: SpecialDamageBounds | undefined;
        for (let i = 0; i < hits.length; i++) {
            const roll = { attacker: this.attacker, target: this.target, combatType: this.combatType, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer: false };
            PluginManager.emitCombatHitRoll(roll);
            let resolved: { accurate: boolean; bounds?: SpecialDamageBounds };
            if (i > 0 && traits?.sharedAccuracyRollAcrossHits === true) {
                resolved = { accurate: firstAccurate === true, bounds: firstBounds };
            } else {
                resolved = PendingHit.withForcedMax(this.rollSpecialTraits(traits, roll.forceAccurate, rollAccuracy, i), roll.forceMaxHit);
                if (i === 0) {
                    firstAccurate = resolved.accurate;
                    firstBounds = resolved.bounds;
                }
            }
            this.accurate = resolved.accurate;
            let damage: HitDamage = this.accurate ? ServerPerf.measurePhase(
                "combat.process.method_hits.damage",
                () => CombatFactory.getHitDamage(this.attacker, this.target, this.combatType, roll.bypassProtectionPrayer, resolved.bounds)
            ) : new HitDamage(0, HitMask.BLUE);
            if (this.accurate && this.attacker.isPlayer() && this.target.isPlayer()) {
                ArceuusSpells.applyCorruption(this.attacker.getAsPlayer(), this.target.getAsPlayer());
            }
            ServerPerf.measurePhase(
                "combat.process.method_hits.extra_rolls",
                () => CombatFactory.applyExtraHitRolls(
                    this.attacker,
                    this.target,
                    this.combatType,
                    damage,
                    this.accurate,
                    this.method
                )
            );
            capToRemaining(damage);
            this.totalDamage += damage.getDamage();
            hits[i] = damage;
        }
        return hits;
    }

    /**
     * Resolves accuracy for one hitsplat using the active special's traits
     * (accuracy roll count, guaranteed rolls, fixed execute-window accuracy)
     * and derives the per-hit damage bounds for indexed damage ranges.
     */
    /** A plugin's forceMaxHit: the roll lands on the maximum (a minimum multiplier of 1). */
    private static withForcedMax(
        resolved: { accurate: boolean; bounds?: SpecialDamageBounds },
        forceMaxHit: boolean
    ): { accurate: boolean; bounds?: SpecialDamageBounds } {
        if (!forceMaxHit || !resolved.accurate) return resolved;
        return { ...resolved, bounds: { ...(resolved.bounds ?? {}), minimumMultiplier: 1 } };
    }

    private rollSpecialTraits(
        traits: WeaponSpecialTraits | null,
        forceAccurate: boolean,
        rollAccuracyFlag: boolean,
        hitIndex: number
    ): { accurate: boolean; bounds?: SpecialDamageBounds } {
        const defenceType = this.method.accuracyDefenceType(this.combatType);
        if (!traits) {
            const accurate = forceAccurate || !rollAccuracyFlag ||
                AccuracyFormulasDpsCalc.rollAccuracy(this.attacker, this.target, this.combatType, defenceType);
            return { accurate };
        }
        const guaranteed =
            traits.guaranteedHit === true ||
            forceAccurate ||
            (hitIndex === 0 && traits.guaranteedFirstAccuracyRoll === true);
        const rollCount = Math.max(1, Math.trunc(traits.accuracyRollCount ?? 1));
        let successfulRolls: number;
        if (guaranteed || !rollAccuracyFlag) {
            successfulRolls = rollCount;
        } else {
            const fixed = traits.fixedAccuracyRollMultiplierWhenTargetAtOrBelowMaximumDamage;
            if (fixed !== undefined && this.target.getHitpoints() <= DamageFormulas.sourceMaxHit(this.attacker, this.combatType)) {
                successfulRolls = AccuracyFormulasDpsCalc.rollFixedAccuracy(this.attacker, this.target, this.combatType, fixed, defenceType) ? 1 : 0;
            } else {
                successfulRolls = AccuracyFormulasDpsCalc.rollAccuracyCount(this.attacker, this.target, this.combatType, rollCount, defenceType);
            }
        }
        const range = successfulRolls > 0 ? traits.damageRangeBySuccessfulAccuracyRolls?.[successfulRolls - 1] : undefined;

        // maximumHitSplitCount divides the final max hit across the hit sequence.
        const splitCount = Math.max(1, Math.trunc(traits.maximumHitSplitCount ?? 1));
        let splitFraction = 1;
        if (splitCount > 1) {
            const total = Math.max(1, DamageFormulas.sourceMaxHit(this.attacker, this.combatType));
            const index = Math.max(0, Math.min(splitCount - 1, hitIndex));
            splitFraction =
                (Math.floor((total * (index + 1)) / splitCount) - Math.floor((total * index) / splitCount)) /
                total;
        }

        const bounds: SpecialDamageBounds = {
            minimumMultiplier: (range?.minimumDamageMultiplier ?? traits.minimumDamageMultiplier ?? 0) * splitFraction,
            maximumMultiplier: (range?.maximumDamageMultiplier ?? traits.maximumDamageMultiplier ?? 1) * splitFraction,
            minimumBonus: traits.minimumDamageBonus,
            maximumBonus: traits.maximumDamageBonus,
            cap: traits.maximumDamageCap,
            reduction: successfulRolls === rollCount ? traits.maximumHitReductionOnFullAccuracyRolls : 0,
        };
        return { accurate: successfulRolls > 0, bounds };
    }

    /**
     * First-successful-accuracy branch table (dragon claws family): each entry is
     * attempted until one lands, then its damage is split across the configured
     * hit count. All-miss outcomes use the configured damage patterns.
     */
    private resolveFirstSuccessfulRanges(
        traits: WeaponSpecialTraits,
        capToRemaining: (damage: HitDamage) => HitDamage
    ): HitDamage[] | null {
        const ranges = traits.firstSuccessfulAccuracyDamageRanges ?? [];
        if (ranges.length === 0) {
            return null;
        }
        const hitCount = Math.max(1, Math.trunc(traits.hitCount ?? 1));
        for (let attempt = 0; attempt < ranges.length; attempt++) {
            const range = ranges[attempt];
            const success = traits.guaranteedHit === true ||
                AccuracyFormulasDpsCalc.rollAccuracy(
                    this.attacker,
                    this.target,
                    this.combatType,
                    this.method.accuracyDefenceType(this.combatType)
                );
            if (!success) {
                continue;
            }
            const bounds: SpecialDamageBounds = {
                minimumMultiplier: range.minimumDamageMultiplier,
                maximumMultiplier: range.maximumDamageMultiplier,
                reduction: range.maximumDamageReduction ?? 0,
            };
            const base = CombatFactory.getHitDamage(this.attacker, this.target, this.combatType, false, bounds).getDamage();
            const distributed = range.distributeDamage?.(base, hitCount);
            const hits: HitDamage[] = [];
            let total = 0;
            for (let i = 0; i < hitCount; i++) {
                const raw = distributed
                    ? distributed[i] ?? 0
                    : base * (range.hitDamageMultipliers[i] ?? 0) + Math.trunc(range.hitDamageBonuses?.[i] ?? 0);
                const value = Math.max(0, Math.floor(raw));
                const hit = new HitDamage(value, value === 0 ? HitMask.BLUE : HitMask.RED);
                capToRemaining(hit);
                total += hit.getDamage();
                hits.push(hit);
            }
            this.accurate = total > 0;
            this.totalDamage = total;
            return hits;
        }

        const patterns = traits.allMissDamagePatterns;
        const fallbackRoll = Math.random();
        const pattern = patterns && patterns.length > 0
            ? patterns[Math.min(patterns.length - 1, Math.floor(fallbackRoll * patterns.length))]
            : Array.from({ length: hitCount }, (_, i) =>
                i === hitCount - 1 ? (fallbackRoll < 0.2 ? 0 : fallbackRoll < 0.6 ? 1 : 2) : 0);
        const hits: HitDamage[] = [];
        let total = 0;
        let landed = false;
        for (let i = 0; i < hitCount; i++) {
            const value = Math.max(0, Math.floor(pattern[i] ?? 0));
            landed = landed || value > 0;
            const hit = new HitDamage(value, value === 0 ? HitMask.BLUE : HitMask.RED);
            capToRemaining(hit);
            total += hit.getDamage();
            hits.push(hit);
        }
        this.accurate = landed;
        this.totalDamage = total;
        return hits;
    }

    public updateTotalDamage() {
        this.totalDamage = 0;
        for (let i = 0; i < this.hits.length; i++) {
            this.totalDamage += this.hits[i].getDamage();
        }
    }

    public getSkills(): number[] {
        if (this.attacker.isNpc()) {
            return new Array();
        }
        return (this.attacker as Player).getFightType().getStyle().skill(this.combatType);
    }

    public getCombatType(): CombatType {
        return this.combatType;
    }
}    
