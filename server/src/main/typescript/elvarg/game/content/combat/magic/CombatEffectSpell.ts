import { Mobile } from "../../../entity/impl/Mobile";
import { Player } from "../../../entity/impl/player/Player";
import { Item } from "../../../model/Item";
import { CombatSpell } from "./CombatSpell";
import { Animation } from "../../../model/Animation";
import { Graphic } from "../../../model/Graphic";
import { Projectile } from "../../../model/Projectile";

interface CombatEffectSpellInterface {
    castAnimation: () => Animation;
    castProjectile: (cast: Mobile, castOn: Mobile) => Projectile;
    spellEffect: (cast: Mobile, castOn: Mobile) => void;
    endGraphic: () => Graphic;
    startGraphic: () => Graphic;
    baseExperience: () => number;
    itemsRequired: (player: Player) => Item[];
    levelRequired: () => number;
    spellId: () => number;
    getSpellbook?: () => any;
    members?: boolean;
}



export class  CombatEffectSpell extends CombatSpell {
    levelRequired(): number {
        return this.options.levelRequired();
    }
    getSpell(): CombatSpell {
        return this;
    }
    itemsRequired(player: Player): Item[] {
        return this.options.itemsRequired(player);
    }
    baseExperience() {
        return this.options.baseExperience();
    }

    constructor(private readonly options: CombatEffectSpellInterface) {
        super();
        this.members = options.members === true;
    }

    spellId(): number {
        return this.options.spellId();
    }
    castAnimation(): Animation {
        return this.options.castAnimation()
    }
    startGraphic(): Graphic {
        return this.options.startGraphic();
    }
    castProjectile(cast: Mobile, castOn: Mobile): Projectile {
        return this.options.castProjectile(cast, castOn);
    }
    endGraphic(): Graphic {
        return this.options.endGraphic();
    }
    public maximumHit(): number {
        return -1;
    }
    public equipmentRequired(player: Player): Item[] {
        return null;
    }

    public finishCast(cast: Mobile, castOn: Mobile, accurate: boolean, damage: number): void {
        if (accurate) {
            this.spellEffect(cast, castOn);
        }
    }
    public spellEffect(cast: Mobile, castOn: Mobile) {
        this.options.spellEffect(cast, castOn);
    }


}
