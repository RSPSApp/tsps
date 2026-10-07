import { HitMask } from './HitMask';
import type { Mobile } from '../../../entity/impl/Mobile';
export class HitDamage {
    private damage: number;
    private hitmask: HitMask;
    private startHitmask: HitMask;

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
