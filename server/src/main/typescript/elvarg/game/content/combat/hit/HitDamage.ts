import { HitMask } from './HitMask';
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

    public multiplyDamage(mod: number): void {
        this.damage *= mod;
        this.update();
    }

    public update(): void {
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

    public getSplatType(mine: boolean): number | null {
        return this.splatTypes ? (mine ? this.splatTypes.mine : this.splatTypes.others) : null;
    }
}
