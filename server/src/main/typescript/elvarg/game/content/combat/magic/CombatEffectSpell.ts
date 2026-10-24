import { Mobile } from "../../../entity/impl/Mobile";
import { Player } from "../../../entity/impl/player/Player";
import { Item } from "../../../model/Item";
import { CombatSpell } from "./CombatSpell";
import { Animation } from "../../../model/Animation";
import { Graphic } from "../../../model/Graphic";
import { Projectile } from "../../../model/Projectile";
import { PluginManager } from "../../../../plugins/PluginManager";
import type { SpellCastContext } from "./Spell";

interface CombatEffectSpellInterface {
    maximumHit?: () => number;
    castAnimation: () => Animation;
    castProjectile: (cast: Mobile, castOn: Mobile) => Projectile;
    spellEffect?: (cast: Mobile, castOn: Mobile) => void;
    endGraphic: () => Graphic;
    startGraphic: () => Graphic;
    baseExperience: () => number;
    /** The binding spells and Tele Block pay less on a splash. */
    splashExperience?: () => number;
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
    splashExperience() {
        return this.options.splashExperience?.() ?? this.baseExperience();
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
        return this.options.maximumHit?.() ?? -1;
    }
    public equipmentRequired(player: Player): Item[] {
        return null;
    }

    public finishCast(cast: Mobile, castOn: Mobile, accurate: boolean, damage: number, context?: SpellCastContext | null): void {
        if (accurate) {
            this.spellEffect(cast, castOn, context);
        }
    }
    public spellEffect(cast: Mobile, castOn: Mobile, context?: SpellCastContext | null) {
        const event = { attacker: cast, target: castOn, spell: this, context, allowed: true, handled: false };
        PluginManager.emitCustomEvent("magic:utility-effect-check", event);
        if (!event.allowed) return;
        PluginManager.emitCustomEvent("magic:utility-effect", event);
        if (!event.handled) this.options.spellEffect?.(cast, castOn);
    }


}
