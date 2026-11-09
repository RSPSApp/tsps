import { HitMask } from './HitMask';
import type { Mobile } from '../../../entity/impl/Mobile';
export class HitDamage {
    private damage: number;
    private hitmask: HitMask;
    private startHitmask: HitMask;
    private appliedObservers: Array<(damageTaken: number) => void> = [];
    private healthLost = 0;

    /** Recorded before setHitpoints can invoke reactive healing or a death-phase transition. */
    public setHealthLost(amount: number): void {
        this.healthLost = Math.max(0, amount);
    }

    public getHealthLost(): number {
        return this.healthLost;
    }

    /** Observes health actually lost when this hit lands, before reactive healing. */
    public onApplied(observer: (damageTaken: number) => void): this {
        this.appliedObservers.push(observer);
        return this;
    }

    /** Called by the hit queue; observers are consumed even if one throws. */
    public notifyApplied(damageTaken: number): void {
        const observers = this.appliedObservers;
        this.appliedObservers = [];
        for (const observer of observers) {
            try {
                observer(damageTaken);
            } catch (error) {
                console.error('[HitDamage] Applied observer failed', error);
            }
        }
    }

    constructor(damage: number, hitmask: HitMask) {
        this.damage = damage;
        this.hitmask = hitmask;
        this.startHitmask = hitmask;
        this.update();
    }

    public getDamage(): number {
        return this.damage;
    }

    public setDamage(damage: number): void {
        this.damage = damage;
        this.update();
    }

    public incrementDamage(damage: number): void {
        this.damage += damage;
        this.update();
    }

    /** Scales the damage, rounding down as OSRS does (a 17 into a protection prayer in PvP is 10). */
    public multiplyDamage(mod: number): void {
        this.damage *= mod;
        this.update();
    }

    /** Damage is always whole: anything scaled (prayer, the Elysian, bolt effects) rounds down. */
    public update(): void {
        this.damage = Number.isFinite(this.damage) ? Math.floor(this.damage) : 0;
        if (this.damage > 0) {
            this.hitmask = this.startHitmask == HitMask.BLUE ? HitMask.RED : this.startHitmask;
        } else {
            this.damage = 0;
            this.hitmask = HitMask.BLUE;
        }
    }

    public getHitmask(): HitMask {
        return this.hitmask;
    }

    public setHitmask(hitmask: HitMask): void {
        this.hitmask = hitmask;
    }

    /** Cache hitsplat ids that replace the hitmask's: one for the target, one for everyone else. */
    private splatTypes: { mine: number; others: number } | null = null;

    public setSplatTypes(mine: number, others: number): HitDamage {
        this.splatTypes = { mine, others };
        return this;
    }

    /**
     * Whether this reflected damage counts as its source's for the kill. A reflection is not
     * normally anyone's damage — a monster killed by ring of recoil alone drops nothing (Wiki:
     * Ring of recoil) — but a League's Thorns damage does count as the wearer's, which is why it
     * could stop a "specific type of damage only" Combat Achievement and needed a fix (Jagex,
     * Further Leagues VI Changes).
     */
    private creditsSource = false;

    public markCreditsSource(): HitDamage {
        this.creditsSource = true;
        return this;
    }

    public creditsItsSource(): boolean {
        return this.creditsSource;
    }

    /** Damage rebounded by recoil, vengeance or retribution; a death from it doesn't trigger Retribution. */
    private reflected = false;

    public markReflected(): HitDamage {
        this.reflected = true;
        return this;
    }

    public isReflected(): boolean {
        return this.reflected;
    }

    /**
     * Who dealt the hit, when known. The dealer sees it as their own hitsplat, like
     * the player it lands on; everyone else sees the darker "other" one.
     */
    private source: Mobile | null = null;

    public setSource(source: Mobile | null): HitDamage {
        this.source = source;
        return this;
    }

    public getSource(): Mobile | null {
        return this.source;
    }

    public getSplatType(mine: boolean): number | null {
        return this.splatTypes ? (mine ? this.splatTypes.mine : this.splatTypes.others) : null;
    }
}
