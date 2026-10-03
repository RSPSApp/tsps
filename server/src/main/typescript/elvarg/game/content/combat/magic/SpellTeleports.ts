import { Player } from "../../../entity/impl/player/Player";
import { Item } from "../../../model/Item";
import { Location } from "../../../model/Location";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { Skill } from "../../../model/Skill";
import { TeleportHandler } from "../../../model/teleportation/TeleportHandler";
import { TeleportType } from "../../../model/teleportation/TeleportType";
import { Spell } from "./Spell";
import { PluginManager } from "../../../../plugins/PluginManager";

type TeleportData = {
    spellbook: MagicSpellbook;
    level: number;
    experience: number;
    runes: Item[];
    destination: Location;
};

class TeleportSpell extends Spell {
    constructor(readonly data: TeleportData) { super(); }

    spellId(): number { return 0; }
    levelRequired(): number { return this.data.level; }
    baseExperience(): number { return this.data.experience; }
    itemsRequired(): Item[] { return this.data.runes; }
    equipmentRequired(): Item[] { return []; }
    startCast(): void { }
    getSpellbook(): MagicSpellbook { return this.data.spellbook; }

    cast(player: Player, name: string): boolean {
        if (!TeleportHandler.checkReqs(player, this.data.destination) || !this.canCast(player, false)) {
            return true;
        }
        if (!this.canCast(player, true)) {
            return true;
        }
        TeleportHandler.teleport(player, this.data.destination, this.data.spellbook === MagicSpellbook.ANCIENT ? TeleportType.ANCIENT : TeleportType.NORMAL, false,
            () => PluginManager.emitCustomEvent("spell:teleport-arrival", { player, name }));
        player.getSkillManager().addExperiences(Skill.MAGIC, this.data.experience);
        return true;
    }
}

const rune = (id: number, amount = 1) => new Item(id, amount);
const teleport = (spellbook: MagicSpellbook, level: number, experience: number, runes: Item[], x: number, y: number, z = 0) =>
    new TeleportSpell({ spellbook, level, experience, runes, destination: new Location(x, y, z) });

/** Normal and Ancient spellbook teleports not handled by the combat spell engine. */
export class SpellTeleports {
    private static readonly SPELLS = new Map<string, TeleportSpell>([
        ["lumbridge home teleport", teleport(MagicSpellbook.NORMAL, 0, 0, [], 3222, 3218)],
        ["varrock teleport", teleport(MagicSpellbook.NORMAL, 25, 35, [rune(563), rune(556, 3), rune(554)], 3213, 3424)],
        ["lumbridge teleport", teleport(MagicSpellbook.NORMAL, 31, 41, [rune(563), rune(556, 3), rune(557)], 3222, 3218)],
        ["falador teleport", teleport(MagicSpellbook.NORMAL, 37, 48, [rune(563), rune(556, 3), rune(555)], 2964, 3378)],
        ["teleport to house", teleport(MagicSpellbook.NORMAL, 40, 30, [rune(563), rune(556), rune(557)], 2953, 3224)],
        ["camelot teleport", teleport(MagicSpellbook.NORMAL, 45, 55.5, [rune(563), rune(556, 5)], 2757, 3478)],
        ["kourend castle teleport", teleport(MagicSpellbook.NORMAL, 48, 58, [rune(563, 2), rune(555), rune(554)], 1643, 3672)],
        ["ardougne teleport", teleport(MagicSpellbook.NORMAL, 51, 61, [rune(563, 2), rune(555, 2)], 2661, 3301)],
        ["civitas illa fortis teleport", teleport(MagicSpellbook.NORMAL, 54, 64, [rune(563, 2), rune(557), rune(554)], 1680, 3130)],
        ["watchtower teleport", teleport(MagicSpellbook.NORMAL, 58, 68, [rune(563, 2), rune(557, 2)], 2549, 3112, 2)],
        ["trollheim teleport", teleport(MagicSpellbook.NORMAL, 61, 68, [rune(563, 2), rune(554, 2)], 2891, 3678)],
        ["ape atoll teleport", teleport(MagicSpellbook.NORMAL, 64, 74, [rune(563, 2), rune(555, 2), rune(554, 2), rune(1963)], 2796, 2798)],
        ["edgeville home teleport", teleport(MagicSpellbook.ANCIENT, 0, 0, [], 3087, 3496)],
        ["paddewwa teleport", teleport(MagicSpellbook.ANCIENT, 54, 64, [rune(563, 2), rune(556), rune(554)], 3097, 9880)],
        ["senntisten teleport", teleport(MagicSpellbook.ANCIENT, 60, 70, [rune(563, 2), rune(566)], 3320, 3338)],
        ["kharyrll teleport", teleport(MagicSpellbook.ANCIENT, 66, 76, [rune(563, 2), rune(565)], 3492, 3471)],
        ["lassar teleport", teleport(MagicSpellbook.ANCIENT, 72, 82, [rune(563, 2), rune(555, 4)], 3002, 3470)],
        ["dareeyak teleport", teleport(MagicSpellbook.ANCIENT, 78, 88, [rune(563, 2), rune(556, 2), rune(554, 3)], 2966, 3696)],
        ["carrallanger teleport", teleport(MagicSpellbook.ANCIENT, 84, 94, [rune(563, 2), rune(566, 2)], 3156, 3666)],
        ["annakarl teleport", teleport(MagicSpellbook.ANCIENT, 90, 100, [rune(563, 2), rune(565, 2)], 3288, 3886)],
        ["ghorrock teleport", teleport(MagicSpellbook.ANCIENT, 96, 106, [rune(563, 2), rune(555, 8)], 2977, 3873)],
    ]);

    public static getTeleportDestinations() {
        return Array.from(this.SPELLS, ([name, spell]) => ({ name, ...spell.data }));
    }

    static handleSelf(player: Player, name: string | undefined): boolean {
        const key = name?.trim().toLowerCase() ?? "";
        const spell = this.SPELLS.get(key);
        return spell ? spell.cast(player, key) : false;
    }
}
