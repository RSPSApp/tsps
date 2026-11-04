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
import { resolveSpecialAttackType } from "../WeaponSpecialTraits";
import type { WeaponSpecialTraits } from "../WeaponSpecialTraits";
import type { CombatSpell } from "../magic/CombatSpell";
import { Spell, SpellCastContext } from "../magic/Spell";

type PendingHitConfig = {
    delay?: number;
    handleAfterHitEffects?: boolean;
    hitAmount?: number;
    rollAccuracy?: boolean;
    /** False for damage that pays its own XP (or none), skipping the usual combat XP. */
    experience?: boolean;
    /** A pre-rolled damage value, still passing through damage hooks and the HP cap. */
    damage?: number;
    /** Fixed status damage for direct application: no attack rolls, bonuses or roll-time procs. */
    statusDamage?: boolean;
    /** Already-mitigated scripted damage may bypass ordinary protection prayers. */
    bypassProtectionPrayer?: boolean;
    /** Shared across one attack's hits on the same victim; applied after queue-time modifiers. */
    damageBudget?: { remaining: number };
    /** A single hit rolls this many times and keeps the best; only the kept roll goes through the hooks. */
    bestOf?: number;
    /** Scales the kept roll's damage before the hook and the HP cap (a size bonus). */
    damageMultiplier?: number;
    /**
     * An ordinary attack whatever is armed when it is built: while its rolls are made the attacker
     * counts as having no special armed, so no special's traits, accuracy or damage formulas apply
     * (a hit derived from an earlier one, which must not borrow a special armed since). The armed
     * special stays armed, with its energy, for the attacker's next attack.
     */
    ordinary?: boolean;
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
    private damageBudget?: { remaining: number };
    private bestOf = 1;
    private damageMultiplier = 1;
    /** No special attack's traits apply (PendingHitConfig.ordinary). */
    private ordinary = false;
    /** Optional per-hitsplat extra reveal delays (from `hitDelayTicks`). */
    private hitDelays?: number[];
    /** Spell selected when this hit was launched; the caster may clear it before impact. */
    private spell: CombatSpell | null = null;
    /** A roll hook (Verac's set) let this hit through protection prayers. */
    private protectionBypassed = false;
    /** Attack kind whose protection prayer is checked when the hit lands. */
    private protectionType: CombatType;
    /** Protection/Elysian stages already run on this hit object, so a replay cannot double them. */
    private impactProtectionApplied = false;
    private impactIncomingApplied = false;
    /** A scripted producer fills this hit in manipulateHit; run Elysian/equipment after it. */
    private incomingDamageDeferred = false;
    /** Index of the `firstSuccessfulAccuracyDamageRanges` branch that landed; -1 when every roll missed. */
    private firstSuccessfulRangeIndex: number | undefined;

    constructor(attacker: Mobile, target: Mobile, method: CombatMethod, delayOrConfig?: number | PendingHitConfig, handleAfterHitEffects?: boolean,
        private readonly spellContext: SpellCastContext | null = null) {
        this.attacker = attacker;
        this.target = target;
        this.method = method;
        this.combatType = method.type();
        this.protectionType = this.combatType;

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
            this.damageBudget = delayOrConfig.damageBudget;
            this.bestOf = Math.max(1, Math.trunc(delayOrConfig.bestOf ?? 1));
            this.damageMultiplier = delayOrConfig.damageMultiplier ?? 1;
            this.ordinary = delayOrConfig.ordinary === true;
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

        // An ordinary hit is rolled as if no special were armed: every formula reads the armed
        // special through isSpecialActivated (CombatSpecial.activeTraitsFor, the accuracy and damage
        // formulas), so the flag is lowered for the rolls and put back after.
        const armed = this.ordinary && attacker?.isSpecialActivated?.() === true;
        if (armed) attacker.setSpecialActivated(false);
        try {
            // Defensive reactions are resolved when the hit lands, not when it is rolled:
            // a PendingHit only records the raw damage (already capped to the target's HP).
            if (typeof delayOrConfig === "object" && delayOrConfig?.statusDamage === true) {
                const amount = Math.max(0, Math.min(target.getHitpoints(), Math.floor(delayOrConfig.damage ?? 0)));
                this.hits = [new HitDamage(amount, HitMask.RED)];
                this.accurate = true;
                this.totalDamage = amount;
                this.experience = false;
                this.protectionBypassed = true;
            } else {
                this.hits = Spell.withCastContext(attacker, this.spellContext, () =>
                    CombatFactory.duringHitRoll(() =>
                        this.prepareHits(resolvedHitAmount, resolvedRollAccuracy,
                            typeof delayOrConfig === "object" ? delayOrConfig?.damage : undefined,
                            typeof delayOrConfig === "object" && delayOrConfig?.bypassProtectionPrayer === true)));
            }
        } finally {
            if (armed) attacker.setSpecialActivated(true);
        }
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

    public getSpell(): CombatSpell | null {
        return this.spell;
    }
    public getSpellContext(): SpellCastContext | null { return this.spellContext; }

    public setSpell(spell: CombatSpell | null): PendingHit {
        this.spell = spell;
        return this;
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

    public capDamageToBudget(): void {
        if (!this.damageBudget) return;
        for (const damage of this.hits) {
            const value = Math.max(0, Math.min(damage.getDamage(), this.damageBudget.remaining));
            damage.setDamage(value);
            this.damageBudget.remaining -= value;
        }
        this.updateTotalDamage();
    }

    /** Whether the attacker gets the usual combat XP for this hit. */
    public rewardsExperience(): boolean {
        return this.experience;
    }

    /** The branch of a first-successful-roll special that landed (0-based), -1 if all rolls missed, undefined if not such a special. */
    public getFirstSuccessfulRangeIndex(): number | undefined {
        return this.firstSuccessfulRangeIndex;
    }

    public isAccurate(): boolean {
        return this.accurate;
    }

    /** Whether a roll hook let this hit through protection prayers (not a special's own trait). */
    public bypassesProtectionPrayer(): boolean {
        return this.protectionBypassed;
    }

    /** Content that rerolls the hit later may still declare it prayer-piercing. */
    public markProtectionBypassed(): void {
        this.protectionBypassed = true;
    }

    /** The attack kind whose protection prayer is checked at impact. */
    public getProtectionType(): CombatType {
        return this.protectionType;
    }

    public hasAppliedImpactProtection(): boolean {
        return this.impactProtectionApplied;
    }

    public markImpactProtectionApplied(): void {
        this.impactProtectionApplied = true;
    }

    public hasAppliedImpactIncoming(): boolean {
        return this.impactIncomingApplied;
    }

    public markImpactIncomingApplied(): void {
        this.impactIncomingApplied = true;
    }

    /** Content that resolves its own scripted damage in manipulateHit defers equipment reactions. */
    public deferIncomingDamageUntilImpact(): void {
        this.incomingDamageDeferred = true;
    }

    public defersIncomingDamage(): boolean {
        return this.incomingDamageDeferred;
    }

    public completeDeferredIncomingDamage(): void {
        this.incomingDamageDeferred = false;
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

    private prepareHits(hitAmount: number, rollAccuracy: boolean, fixedDamage?: number, bypassProtectionPrayer = false): HitDamage[] {
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
        const traits = fixedDamage === undefined && !this.ordinary ? CombatSpecial.activeTraitsFor(this.attacker) : null;
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

        // Which overhead is checked when the blow lands. A special that changes the
        // damage type (Favour, magic specials) must keep that type after it is disarmed.
        this.protectionType = resolveSpecialAttackType(traits?.damageType) ?? this.combatType;
        if (bypassProtectionPrayer || traits?.ignoreProtectionPrayer === true) {
            this.protectionBypassed = true;
        }

        this.totalDamage = 0;

        // Damage is capped to the HP the target had when the blow was rolled, the
        // way LostCity does it (min(randominc(maxhit), stat(hitpoints))). This is
        // what makes tick-eating work: healing after the roll but before the hit
        // lands leaves the already-capped damage non-lethal. It also keeps XP
        // honest, since XP is awarded from this total at swing time rather than
        // from an uncapped overkill roll. Protection, Elysian and incoming-damage
        // reactions are deliberately not applied here: they are read at impact.
        let remaining = Math.max(0, this.target.getHitpoints());
        const capToRemaining = (damage: HitDamage): HitDamage => {
            if (damage.getDamage() > remaining) {
                damage.setDamage(remaining);
            }
            remaining -= damage.getDamage();
            return damage;
        };

        if (hitAmount === 1) {
            const roll = { attacker: this.attacker, target: this.target, combatType: this.combatType, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer };
            PluginManager.emitCombatHitRoll(roll);
            if (roll.bypassProtectionPrayer) this.protectionBypassed = true;
            let damage: HitDamage = new HitDamage(0, HitMask.BLUE);
            this.accurate = false;
            for (let attempt = fixedDamage === undefined ? this.bestOf : 1; attempt > 0; attempt--) {
                const resolved = PendingHit.withForcedMax(this.rollSpecialTraits(traits, roll.forceAccurate, rollAccuracy, 0), roll.forceMaxHit);
                const rolled: HitDamage = resolved.accurate
                    ? ServerPerf.measurePhase(
                        "combat.process.method_hits.damage",
                        () => CombatFactory.getHitDamage(this.attacker, this.target, this.combatType, roll.bypassProtectionPrayer,
                            fixedDamage === undefined ? resolved.bounds : {
                                minimumMultiplier: 0,
                                maximumMultiplier: 0,
                                minimumBonus: fixedDamage,
                                maximumBonus: fixedDamage,
                            }, fixedDamage === undefined, false)
                    )
                    : new HitDamage(0, HitMask.BLUE);
                if (rolled.getDamage() > damage.getDamage() || (resolved.accurate && !this.accurate)) {
                    damage = rolled;
                    this.accurate = resolved.accurate;
                }
            }
            if (this.accurate && this.attacker.isPlayer() && this.target.isPlayer()) {
                ArceuusSpells.applyCorruption(this.attacker.getAsPlayer(), this.target.getAsPlayer());
            }
            this.emitHitDamage(damage);
            // Cap the roll to the HP held when it was made, before the hit-time
            // protection/Elysian reductions, so tick-eating and XP see this value.
            capToRemaining(damage);
            if (this.damageMultiplier !== 1) {
                damage.setDamage(Math.floor(damage.getDamage() * this.damageMultiplier));
                // The multiplier is a size bonus, never an excuse for an overkill splat.
                const hitpointCap = Math.max(0, this.target.getHitpoints());
                if (damage.getDamage() > hitpointCap) damage.setDamage(hitpointCap);
            }
            this.totalDamage = damage.getDamage();
            return [damage];
        }

        if (traits?.firstSuccessfulAccuracyDamageRanges?.length) {
            const resolvedBranch = this.resolveFirstSuccessfulRanges(traits, capToRemaining, bypassProtectionPrayer);
            if (resolvedBranch) {
                return resolvedBranch;
            }
        }

        let hits: HitDamage[] = new Array(hitAmount);
        let firstAccurate: boolean | undefined;
        let firstBounds: SpecialDamageBounds | undefined;
        const priorHits: HitDamage[] = [];
        for (let i = 0; i < hits.length; i++) {
            const roll = { attacker: this.attacker, target: this.target, combatType: this.combatType, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer };
            PluginManager.emitCombatHitRoll(roll);
            if (roll.bypassProtectionPrayer) this.protectionBypassed = true;
            const projectedDefence = i > 0 && this.method
                ? this.method.projectedDefenceLevel?.(this.attacker, this.target, {
                    hitIndex: i,
                    priorHits: [...priorHits],
                    combatType: this.combatType,
                })
                : undefined;
            let resolved: { accurate: boolean; bounds?: SpecialDamageBounds };
            if (i > 0 && traits?.sharedAccuracyRollAcrossHits === true) {
                resolved = { accurate: firstAccurate === true, bounds: firstBounds };
            } else {
                resolved = PendingHit.withForcedMax(this.rollSpecialTraits(traits, roll.forceAccurate, rollAccuracy, i, projectedDefence), roll.forceMaxHit);
                if (i === 0) {
                    firstAccurate = resolved.accurate;
                    firstBounds = resolved.bounds;
                }
            }
            this.accurate = resolved.accurate;
            let damage: HitDamage = this.accurate ? ServerPerf.measurePhase(
                "combat.process.method_hits.damage",
                () => CombatFactory.getHitDamage(this.attacker, this.target, this.combatType, roll.bypassProtectionPrayer, resolved.bounds, true, false)
            ) : new HitDamage(0, HitMask.BLUE);
            if (this.accurate && this.attacker.isPlayer() && this.target.isPlayer()) {
                ArceuusSpells.applyCorruption(this.attacker.getAsPlayer(), this.target.getAsPlayer());
            }
            this.emitHitDamage(damage);
            capToRemaining(damage);
            this.totalDamage += damage.getDamage();
            hits[i] = damage;
            priorHits.push(damage);
        }
        return hits;
    }

    /** Lets plugins change a rolled hitsplat (enchanted bolts); they may also make it accurate. */
    private emitHitDamage(damage: HitDamage): void {
        const event = {
            attacker: this.attacker,
            target: this.target,
            combatType: this.combatType,
            hit: this,
            damage,
            accurate: this.accurate,
        };
        ServerPerf.measurePhase(
            "combat.process.method_hits.extra_rolls",
            () => PluginManager.emitCombatHitDamage(event)
        );
        this.accurate = event.accurate;
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
        hitIndex: number,
        projectedDefenceLevel?: number
    ): { accurate: boolean; bounds?: SpecialDamageBounds } {
        const defenceType = this.method.accuracyDefenceType(this.combatType);
        if (!traits) {
            const accurate = forceAccurate || !rollAccuracyFlag ||
                AccuracyFormulasDpsCalc.rollAccuracy(this.attacker, this.target, this.combatType, defenceType, undefined, projectedDefenceLevel);
            return { accurate };
        }
        const guaranteed =
            traits.guaranteedHit === true ||
            forceAccurate ||
            (hitIndex === 0 && traits.guaranteedFirstAccuracyRoll === true) ||
            (traits.guaranteedHitOnUnsuspectingTarget === true && this.target.getCombat().getLastDamager() !== this.attacker);
        const rollCount = Math.max(1, Math.trunc(traits.accuracyRollCount ?? 1));
        let successfulRolls: number;
        if (guaranteed || !rollAccuracyFlag) {
            successfulRolls = rollCount;
        } else {
            const fixed = traits.fixedAccuracyRollMultiplierWhenTargetAtOrBelowMaximumDamage;
            if (fixed !== undefined && this.target.getHitpoints() <= DamageFormulas.sourceMaxHit(this.attacker, this.combatType)) {
                successfulRolls = AccuracyFormulasDpsCalc.rollFixedAccuracy(this.attacker, this.target, this.combatType, fixed, defenceType, projectedDefenceLevel) ? 1 : 0;
            } else {
                successfulRolls = AccuracyFormulasDpsCalc.rollAccuracyCount(this.attacker, this.target, this.combatType, rollCount, defenceType, projectedDefenceLevel);
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
        capToRemaining: (damage: HitDamage) => HitDamage,
        bypassProtectionPrayer = false
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
            const base = CombatFactory.getHitDamage(this.attacker, this.target, this.combatType, bypassProtectionPrayer, bounds, true, false).getDamage();
            if (bypassProtectionPrayer) this.protectionBypassed = true;
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
            this.firstSuccessfulRangeIndex = attempt;
            return hits;
        }

        this.firstSuccessfulRangeIndex = -1;
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
