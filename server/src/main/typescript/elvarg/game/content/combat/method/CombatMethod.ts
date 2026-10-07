import { PendingHit } from "../hit/PendingHit";
import { Mobile } from "../../../entity/impl/Mobile";
import { CombatType } from "../CombatType";

export abstract class CombatMethod {

    public start(character: Mobile, target: Mobile): void {
    }

    public finished(character: Mobile, target: Mobile): void {
    }

    public onCombatBegan(character: Mobile, target: Mobile): void {
    }

    public onCombatEnded(character: Mobile, target: Mobile): void {
    }

    /** False when the attack gives the target its own animation instead of a block (a knockback). */
    public playsBlockAnimation(): boolean {
        return true;
    }

    public handleAfterHitEffects(hit: PendingHit): void {
    }

    public canAttack(character: Mobile, target: Mobile): boolean {
        return true;
    }

    /**
     * Non-consuming eligibility used before pursuit. This must NOT delegate to
     * canAttack(): overrides of that consume/validate ammo and runes and reset
     * combat as a side effect, and pursuit runs every cycle while walking in.
     * Override only when a method can cheaply decide it will never be usable.
     */
    public canPursue(character: Mobile, target: Mobile): boolean {
        return true;
    }

    public shouldRenew(character: Mobile): boolean {
        return true;
    }

    public attackSpeed(character: Mobile): number {
        return character.getBaseAttackSpeed();
    }

    public attackDistance(character: Mobile): number {
        return 1;
    }

    /**
     * Defence the accuracy roll is taken against. Override for attacks that roll
     * one style's accuracy against another style's defence - e.g. Kree'arra's
     * "ranged magic" rolls Magic accuracy against the target's Ranged defence.
     * Damage still uses `type()`; only the defence side of the roll changes.
     */
    public accuracyDefenceType(type: CombatType): CombatType {
        return type;
    }

    public abstract type(): CombatType;
    public abstract hits(character: Mobile, target: Mobile): PendingHit[];
}
