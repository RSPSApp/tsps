import { World } from "../../../World";
import { NPC } from "../../../entity/impl/npc/NPC";
import { Player } from "../../../entity/impl/player/Player";
import { Animation } from "../../../model/Animation";
import { Graphic } from "../../../model/Graphic";
import { Item } from "../../../model/Item";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { Skill } from "../../../model/Skill";
import { Spell } from "./Spell";

type Reanimation = { level: number; experience: number; runes: Item[]; npcId: number };

class ReanimationSpell extends Spell {
    constructor(private readonly id: number, private readonly data: Reanimation) { super(); }
    spellId(): number { return this.id; }
    levelRequired(): number { return this.data.level; }
    baseExperience(): number { return this.data.experience; }
    itemsRequired(): Item[] { return this.data.runes; }
    equipmentRequired(): Item[] { return []; }
    startCast(): void { }
    getSpellbook(): MagicSpellbook { return MagicSpellbook.ARCEUUS; }
}

const rune = (id: number, amount = 1) => new Item(id, amount);
const BASIC = { level: 16, experience: 32, runes: [rune(559, 4), rune(561, 2)] };
const ADEPT = { level: 41, experience: 80, runes: [rune(559, 4), rune(561, 3), rune(566)] };
const EXPERT = { level: 72, experience: 138, runes: [rune(565), rune(561, 3), rune(566, 2)] };
const MASTER = { level: 90, experience: 170, runes: [rune(565, 2), rune(561, 4), rune(566, 4)] };

/** Reanimation is cast on an ensouled head in the inventory. */
export class ArceuusItemSpells {
    public static readonly BASIC_REANIMATION = 11997;
    public static readonly ADEPT_REANIMATION = 2885;
    public static readonly EXPERT_REANIMATION = 6208;
    public static readonly MASTER_REANIMATION = 6888;

    private static readonly NPC_BY_HEAD = new Map<string, number>([
        ["goblin", 7018], ["monkey", 7019], ["imp", 7020], ["minotaur", 7021], ["scorpion", 7022], ["bear", 7023], ["unicorn", 7024],
        ["dog", 7025], ["chaos druid", 7026], ["giant", 7027], ["ogre", 7028], ["elf", 7029], ["troll", 7030], ["horror", 7031],
        ["kalphite", 7032], ["dagannoth", 7033], ["bloodveld", 7034], ["tzhaar", 7035], ["demon", 7036],
        ["aviansie", 7037], ["abyssal", 7038], ["dragon", 7039], ["hellhound", 11463],
    ]);

    private static reanimation(spellId: number, npcId: number): ReanimationSpell | null {
        const data = npcId <= 7026 ? BASIC : npcId <= 7031 ? ADEPT : npcId <= 7036 ? EXPERT : MASTER;
        if (spellId === this.BASIC_REANIMATION && data !== BASIC ||
            spellId === this.ADEPT_REANIMATION && data !== ADEPT ||
            spellId === this.EXPERT_REANIMATION && data !== EXPERT ||
            spellId === this.MASTER_REANIMATION && data !== MASTER) {
            return null;
        }
        return new ReanimationSpell(spellId, { ...data, npcId });
    }

    public static castOnItem(player: Player, spellId: number, itemId: number, slot: number): boolean {
        if (![this.BASIC_REANIMATION, this.ADEPT_REANIMATION, this.EXPERT_REANIMATION, this.MASTER_REANIMATION].includes(spellId)) {
            return false;
        }
        const item = player.getInventory().getItems()[slot];
        if (!item || item.getId() !== itemId) return true;
        const name = item.getDefinition().getName().toLowerCase();
        const match = /^ensouled (.+) head$/.exec(name);
        const npcId = match ? this.NPC_BY_HEAD.get(match[1]) : undefined;
        const spell = npcId ? this.reanimation(spellId, npcId) : null;
        if (!spell) {
            player.sendMessage("That head cannot be reanimated by this spell.");
            return true;
        }
        if (!spell.canCast(player, false) || !spell.canCast(player, true)) return true;

        player.getInventory().deleteNumber(itemId, 1);
        const npc = NPC.create(npcId, player.getLocation().clone());
        (npc as any).__skipDefaultRespawn = true;
        npc.setOwner(player);
        World.getAddNPCQueue().push(npc);
        // rsprox captures: arceuus_necromancy_playeranim with arceuus_necromancy_playerspot, not Wind
        // Strike's animation and the Underground Pass claw.
        player.performAnimation(new Animation(7198));
        player.performGraphic(new Graphic(1288));
        player.getSkillManager().addExperiences(Skill.MAGIC, spell.baseExperience());
        return true;
    }
}
