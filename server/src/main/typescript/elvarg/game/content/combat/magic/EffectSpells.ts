import { Mobile } from "../../../entity/impl/Mobile";
import { Player } from "../../../entity/impl/player/Player";
import { Animation } from "../../../model/Animation";
import { EffectTimer } from "../../../model/EffectTimer";
import { Graphic } from "../../../model/Graphic";
import { GraphicHeight } from "../../../model/GraphicHeight";
import { Item } from "../../../model/Item";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { Skill } from "../../../model/Skill";
import { Spell } from "./Spell";

export class EffectSpells extends Spell {




    public static handleSpell(player: Player, button: number) {

        const spell = EffectSpells.forSpellId(button);
        if (!(spell instanceof EffectSpells)) {
            return false;
        }
        if (!spell.canCast(player, false)) {
            return true;
        }

        switch (spell) {
            case EffectSpells.BONES_TO_PEACHES:
            case EffectSpells.BONES_TO_BANANAS:

                if (!player.getClickDelay().elapsedTime(500)) {
                    return true;
                }
                if (!player.getInventory().contains(526)) {
                    player.sendMessage("You do not have any bones in your inventory.");
                    return true;
                }
                player.getInventory().deleteItemSet(spell.itemsToConsume(player));
                let i = 0;
                player.getInventory().getValidItems().forEach(invItem => {
                    if (invItem.getId() == 526) {
                        if (spell === EffectSpells.BONES_TO_PEACHES) {
                            player.getInventory().deleteNumber(526, 1).adds(6883, 1);
                        } else {
                            player.getInventory().deleteNumber(526, 1).adds(1963, 1);
                        }

                        i++;
                    }
                });
                player.performGraphic(new Graphic(141, GraphicHeight.MIDDLE));
                player.performAnimation(new Animation(722));
                player.getSkillManager().addExperiences(Skill.MAGIC, spell.baseExperience() * i);
                player.getClickDelay().reset();
                break;
            case EffectSpells.VENGEANCE:
                if (player.getDueling().inDuel()) {
                    player.sendMessage("You cannot cast Vengeance during a duel!");
                    return true;
                }
                if (player.getSkillManager().getMaxLevel(Skill.DEFENCE) < 40) {
                    player.sendMessage("You need at least level 40 Defence to cast this spell.");
                    return true;
                }
                if (player.hasVengeanceReturn()) {
                    player.sendMessage("You already have Vengeance's effect.");
                    return true;
                }
                if (!player.getVengeanceTimer().finished()) {
                    player.sendMessage("You must wait another " + player.getVengeanceTimer().secondsRemaining() + " seconds before you can cast that again.");
                    return true;
                }

                player.setHasVengeance(true);
                player.getVengeanceTimer().start(30);
                player.getPacketSender().sendEffectTimer(30, EffectTimer.VENGEANCE)
                    .sendMessage("You now have Vengeance's effect.");
                player.getInventory().deleteItemSet(spell.itemsToConsume(player));
                player.performAnimation(new Animation(8316));
                player.performGraphic(new Graphic(726, GraphicHeight.HIGH));
                break;
        }
        return true;
    }

    public static forSpellName(name: string | undefined): EffectSpells | null {
        switch (name?.trim().toLowerCase()) {
            case "bones to bananas": return EffectSpells.BONES_TO_BANANAS;
            case "bones to peaches": return EffectSpells.BONES_TO_PEACHES;
            default: return null;
        }
    }





    public static readonly BONES_TO_BANANAS = new EffectSpells(
        () => { return 1159; },
        () => { return 15; },
        () => { return 650; },
        () => { return [new Item(561), new Item(555, 2), new Item(557, 2)]; },
        () => { return null; },
        () => { }
    )

    public static LOW_ALCHEMY = new EffectSpells(
        () => { return 1162; },
        () => { return 21; },
        () => { return 4000; },
        () => { return [new Item(554, 3), new Item(561)]; },
        () => { return null; },
        () => { }
    )

    public static TELEKINETIC_GRAB = new EffectSpells(
        () => { return 1168; },
        () => { return 33; },
        () => { return 3988; },
        () => { return [new Item(563), new Item(556)]; },
        () => { return null; },
        () => { }
    )
    public static SUPERHEAT_ITEM = new EffectSpells(
        () => { return 1173; },
        () => { return 43; },
        () => { return 6544; },
        () => { return [new Item(554, 4), new Item(561)]; },
        () => { return null; },
        () => { }
    )
    public static HIGH_ALCHEMY = new EffectSpells(
        () => { return 1178; },
        () => { return 55; },
        () => { return 20000; },
        () => { return [new Item(554, 5), new Item(561)]; },
        () => { return null; },
        () => { }
    )
    public static BONES_TO_PEACHES = new EffectSpells(
        () => { return 15877; },
        () => { return 60; },
        () => { return 4121; },
        () => { return [new Item(561, 2), new Item(555, 4), new Item(557, 4)]; },
        () => { return null; },
        () => { }
    )
    public static BAKE_PIE = new EffectSpells(
        () => { return 9107; },
        () => { return 65; },
        () => { return 5121; },
        () => { return [new Item(9075, 1), new Item(554, 5), new Item(555, 4)]; },
        () => { return null; },
        () => { },
        () => { return MagicSpellbook.LUNAR; }
    )

    public static VENGEANCE_OTHER = new EffectSpells(
        () => { return 9135; },
        () => { return 93; },
        () => { return 10000; },
        () => { return [new Item(9075, 3), new Item(557, 10), new Item(560, 2)]; },
        () => { return null; },
        () => { },
        () => { return MagicSpellbook.LUNAR; }
    )

    public static VENGEANCE = new EffectSpells(
        () => { return 9136; },
        () => { return 94; },
        () => { return 14000; },
        () => { return [new Item(9075, 4), new Item(557, 10), new Item(560, 2)]; },
        () => { return null; },
        () => { },
        () => { return MagicSpellbook.LUNAR; }
    )

    public static readonly map: Map<number, EffectSpells> = new Map<number, EffectSpells>();
    constructor(private readonly spellIdFunction?: Function, private readonly levelRequiredFunction?: Function, private readonly baseExperienceFunction?: Function, private readonly itemsRequiredFunction?: Function, private readonly equipmentRequiredFunction?: Function, private readonly startCastFunction?: Function, private readonly getSpellbookFunction?: Function) {
        super();
    }

    public static forSpellId(spellId: number): EffectSpells {
        const spell = EffectSpells.map.get(spellId);
        if (spell != null) {
            return spell;
        }
        return null;
    }

    baseExperience(): number {
        return this.baseExperienceFunction();
    }

    spellId(): number {
        return this.spellIdFunction();
    }
    levelRequired(): number {
        return this.levelRequiredFunction();
    }
    itemsRequired(player: Player): Item[] {
        return this.itemsRequiredFunction();
    }
    equipmentRequired(player: Player): Item[] {
        return this.equipmentRequiredFunction();
    }
    startCast(cast: Mobile, castOn: Mobile): void {
        return this.startCastFunction();
    }
    public getSpellbook(): MagicSpellbook {
        return this.getSpellbookFunction?.() ?? MagicSpellbook.NORMAL;
    }

}

for (const maybeSpell of Object.values(EffectSpells)) {
    if (maybeSpell instanceof EffectSpells) {
        EffectSpells.map.set(maybeSpell.spellId(), maybeSpell);
    }
}
EffectSpells.map.set(3280, EffectSpells.BONES_TO_BANANAS);
// Bones to Peaches is the standard book's members-only bones spell.
EffectSpells.BONES_TO_PEACHES.members = true;
EffectSpells.map.set(6884, EffectSpells.BONES_TO_PEACHES);
