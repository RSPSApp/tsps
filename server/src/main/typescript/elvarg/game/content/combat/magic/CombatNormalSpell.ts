import { CombatSpell } from "./CombatSpell";
import { Mobile } from "../../../entity/impl/Mobile";
import { Animation } from "../../../model/Animation";
import { Graphic } from "../../../model/Graphic";
import { Projectile } from "../../../model/Projectile";
import { Player } from "../../../entity/impl/player/Player";
import { Item } from "../../../model/Item";
import { Sound } from "../../../Sound";

export interface CombatNormalSpellOptions {
    spellId: () => number
    maximumHit:() => number 
    castAnimation:() => Animation
    startGraphic:() => Graphic
    castProjectile:(cast: Mobile, castOn: Mobile) => Projectile
    endGraphic:() => Graphic 
    finishCast?:(cast: Mobile, castOn: Mobile, accurate: boolean, damage: number) => void
    baseExperience?: () => number
    equipmentRequired?:(player: Player) => Item[]
    itemsRequired?:(player: Player) => Item[]
    levelRequired?:() => number
    spellEffect?:(cast: Mobile, castOn: Mobile) => void 
    members?: boolean
    /** Its own cast sound id (a built-in staff spell has no spellbook id to look it up by). */
    castSound?: () => number
    /** Its own impact sound id, for a built-in staff spell with no spellbook id in the impact table. */
    impactSound?: () => number
  }

export class CombatNormalSpell extends CombatSpell {
    getSpell(): CombatSpell {
      return this;
    }
    constructor(private readonly options: CombatNormalSpellOptions){
        super();
        this.members = options.members === true;
    }

    spellId(): number {
        return this.options.spellId()
    }
    castSound(): Sound | null {
        return this.options.castSound ? new Sound(this.options.castSound(), 1, 0, 0) : null;
    }
    impactSound(): Sound | null {
        return this.options.impactSound ? new Sound(this.options.impactSound(), 1, 0, 0) : null;
    }
    maximumHit(): number {
        return this.options.maximumHit()
    }
    castAnimation(): Animation {
        return this.options.castAnimation()
    }
    startGraphic(): Graphic {
        return this.options.startGraphic()
    }
    castProjectile(cast: Mobile, castOn: Mobile): Projectile {
        return this.options.castProjectile(cast, castOn)
    }
    endGraphic(): Graphic {
        return this.options.endGraphic()
    }

    finishCast(cast: Mobile, castOn: Mobile, accurate: boolean, damage: number): void {
        if (!accurate || damage <= 0) {
          return;
        }
        this.options.finishCast?.(cast, castOn, accurate, damage);
    }

    baseExperience(): number {
        return this.options.baseExperience ? this.options.baseExperience() : 0;
    }

    equipmentRequired(player: Player): Item[] {
        return this.options.equipmentRequired ? this.options.equipmentRequired(player) : null;
    }

    itemsRequired(player: Player): Item[] {
        return this.options.itemsRequired ? this.options.itemsRequired(player) : null;
    }

    levelRequired(): number {
        return this.options.levelRequired ? this.options.levelRequired() : 1;
    }

    spellEffect(cast: Mobile, castOn: Mobile): void {
        if(this.options.spellEffect) {
          return this.options.spellEffect(cast, castOn)
        }
    }  

}
