import { CombatMethod } from "../CombatMethod";
import { Mobile } from "../../../../entity/impl/Mobile";
import { Sounds } from "../../../../Sounds";
import { CombatType } from "../../CombatType";
import { PendingHit } from "../../hit/PendingHit";
import { Animation } from "../../../../model/Animation";
import { WeaponProfiles } from "../../WeaponProfile";
export class MeleeCombatMethod extends CombatMethod {
    start(character: Mobile, target: Mobile) {
        const animation = character.getAttackAnim(target);
        if (animation !== -1) {
            character.performAnimation(new Animation(animation));
            Sounds.sendSound(character, character.getAttackSound());
        }
    }

    type(): CombatType {
        return CombatType.MELEE;
    }

    hits(character: Mobile, target: Mobile): PendingHit[] {
        return [new PendingHit(character, target, this)];
    }

    /** A weapon that allows no melee keeps its target but never swings (WeaponProfiles.meleeAllowed). */
    canAttack(character: Mobile, target: Mobile): boolean {
        return !character.isPlayer() || WeaponProfiles.meleeAllowed(character.getAsPlayer());
    }

    attackDistance(character: Mobile): number {
        return character.isPlayer() ? WeaponProfiles.meleeAttackDistance(character.getAsPlayer(), 1) : 1;
    }
}
