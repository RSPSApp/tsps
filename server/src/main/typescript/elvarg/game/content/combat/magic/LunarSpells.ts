import { World } from "../../../World";
import { Player } from "../../../entity/impl/player/Player";
import { Animation } from "../../../model/Animation";
import { Graphic } from "../../../model/Graphic";
import { GraphicHeight } from "../../../model/GraphicHeight";
import { Item } from "../../../model/Item";
import { Location } from "../../../model/Location";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { Skill } from "../../../model/Skill";
import { TeleportHandler } from "../../../model/teleportation/TeleportHandler";
import { TeleportType } from "../../../model/teleportation/TeleportType";
import { Sound } from "../../../Sound";
import { Sounds } from "../../../Sounds";
import { Task } from "../../../task/Task";
import { TaskManager } from "../../../task/TaskManager";
import { Spell } from "./Spell";
import { EffectSpells } from "./EffectSpells";
import { DialogueChainBuilder } from "../../../model/dialogues/builders/DialogueChainBuilder";
import { OptionDialogue } from "../../../model/dialogues/entries/impl/OptionDialogue";
import { StatementDialogue } from "../../../model/dialogues/entries/impl/StatementDialogue";
import { ARCEUUS_LOCKED_MESSAGE, arceuusLocked, lockingQuest, spellbookOpen } from "./SpellbookLocks";
import { DialogueOption } from "../../../model/dialogues/DialogueOption";
import { PluginManager } from "../../../../plugins/PluginManager";
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { Wilderness } from "../../wilderness/Wilderness";
import { AreaManager } from "../../../model/areas/AreaManager";

/** A cast's animation, graphic and sound on the caster (cache ids); `areaSound` is heard nearby. */
/** `graphicHeight`: the spotanim height rsprox captures show (0 when none is recorded). */
type CastVisuals = { animation: number; graphic?: number; graphicHeight?: number; sound?: number; areaSound?: number };
/**
 * Each spell's level and runes are the cache's (its spell obj's params); `experience` is the
 * Wiki's. `cast` is what the caster plays, as in rsprox captures of live OSRS; null for a
 * teleport, whose TeleportType animates it. Spells no capture shows yet keep the summon
 * animation (4413) with the Lunar teleport graphic (747).
 */
type SpellData = { experience: number; cast?: CastVisuals | null; spellId?: number };
type TeleportData = SpellData & { destination: Location };

const UNCAPTURED: CastVisuals = { animation: 4413, graphic: 747, graphicHeight: 92 };
/** The Lunar spells rsprox captures show, by cache name: the caster's animation, then graphic. */
const CASTS = {
    // lunar_human_magic_summon2, quest_lunar_bakepie_spotanim
    "bake pie": { animation: 4413, graphic: 746 },
    // dream_player_humidify_spell, dream_humidify_spell_spotanim; area sound 3614 (rsprox 547)
    "humidify": { animation: 6294, graphic: 1061, graphicHeight: 72, areaSound: 3614 },
    // dream_player_hunter_box_spell, dream_hunter_spell_spotanim; sound 3615 (rsprox 75)
    "hunter kit": { animation: 6303, graphic: 1074, graphicHeight: 62, sound: 3615 },
    // dream_player_make_plank_spell, dream_plank_make_spell_spotanim; sound 3617 (rsprox 3461)
    "plank make": { animation: 6298, graphic: 1063, graphicHeight: 60, sound: 3617 },
    // dream_player_monsterexam_statspy, dream_spell_monsterexam_statspy_spotanim; sound 3620 (rsprox 3235)
    "monster examine": { animation: 6293, graphic: 1059, graphicHeight: 32, sound: 3620 },
    // lunar_human_magic_summon2, quest_lunar_magic_flax_strim; sound 3618 (rsprox 4045)
    "astral contact": { animation: 4413, graphic: 728, graphicHeight: 92, sound: 3618 },
    // dream_player_spellbook_swap, dream_spellbook_spotanim
    "spellbook swap": { animation: 6299, graphic: 1062, graphicHeight: 10 },
    // lunar_human_magic_summon1, quest_lunar_spellbook_string_jewelery_spot_anim
    "string jewellery": { animation: 4412, graphic: 730 },
    // quest_lunar_pushing_magic_animation; the target shows the Vengeance graphic (725)
    "vengeance other": { animation: 4411 },
} satisfies Record<string, CastVisuals>;
/** A captured spell's cast: a misspelt name fails to compile instead of falling back to UNCAPTURED. */
const castOf = (spell: keyof typeof CASTS): CastVisuals => CASTS[spell];

const COINS = 995;
/** Uncooked pie -> [pie, Cooking level, Cooking XP] (Wiki: Bake Pie). */
const PIES = new Map<number, [number, number, number]>([
    [2321, [2325, 10, 78]], [2319, [2327, 20, 110]], [7168, [7170, 29, 128]], [2317, [2323, 30, 130]],
    [7176, [7178, 34, 138]], [7186, [7188, 47, 164]], [19656, [19662, 52, 180]], [21684, [21690, 60, 200]],
    [7196, [7198, 70, 210]], [22789, [22795, 73, 220]], [7206, [7208, 85, 240]], [7216, [7218, 95, 260]],
]);
/** Empty vessel -> filled (Wiki: Humidify). Farming adds seedlings and part-filled watering cans. */
const WATER_CONTAINERS = new Map<number, number>([
    [1925, 1929], [1923, 1921], [1935, 1937], [229, 227], [6667, 6668], [1980, 4458], [434, 1761],
    [1825, 1823], [1827, 1823], [1829, 1823], [1831, 1823], [5331, 5340],
]);
/** Unstrung -> strung (Wiki: String Jewellery); 4 Crafting XP each. */
const UNSTRUNG = new Map<number, number>([
    [1673, 1692], [1675, 1694], [1677, 1696], [1679, 1698], [1681, 1700], [1683, 1702],
    [21099, 21108], [21102, 21111], [21105, 21114], [4082, 4081], [4022, 4021], [1714, 1716], [1720, 1722],
]);
const STRING_CRAFTING_XP = 4;
/** Log -> [plank, coins]: 70% of the sawmill's price (Wiki: Plank Make). */
const PLANKS = new Map<number, [number, number]>([
    [1511, [960, 70]], [1521, [8778, 175]], [6333, [8780, 350]], [6332, [8782, 1050]],
    [32904, [31432, 1750]], [32907, [31435, 3500]], [32910, [31438, 5250]],
]);
/**
 * All Settings' Plank Make confirmations (420-423), by log: basic, oak, teak and mahogany. With one
 * on, the spell asks before it takes coins for that log.
 */
const PLANK_CONFIRM_VARBITS = new Map<number, number>([[1511, 624], [1521, 2319], [6333, 2320], [6332, 3939]]);
const HUNTER_KIT = 11159;
/** Hunter kit's contents; a player holding all of them is refused (Wiki: Hunter Kit). */
const HUNTER_KIT_CONTENTS = [10150, 10010, 10006, 10031, 10029, 596, 11260, 10008, 34631];
/**
 * Repeat spacing in ticks: String Jewellery and Bake Pie every 3 (Wiki; rsprox 3236, 435 show
 * other players at 3); Plank Make 5 ticks after the click, then every 6 (rsprox 3461).
 */
const STRING_TICKS = 3;
const BAKE_TICKS = 3;
const PLANK_TICKS = 6;
const PLANK_FIRST_REPEAT_TICKS = 5;
/** Monster Examine's stats replace the spellbook in the magic tab (rsprox 3235); 522:17 closes them. */
const MONSTER_STATS_INTERFACE = 522;
const MONSTER_STATS_CLOSE = 17;
const MONSTER_STATS_SCRIPT = 1179;
const ELEMENTS = ["Air", "Water", "Earth", "Fire"];
/** NPC Contact: the click to the runes, XP and contact list (rsprox 4045: +7 on all three casts). */
const NPC_CONTACT_TICKS = 7;
/** Casters whose NPC Contact list is still to open. */
const NPC_CONTACT_PENDING = new WeakSet<Player>();
/** Magic Imbue lasts 21 ticks (12.6 s), its cooldown as long (Wiki). */
const MAGIC_IMBUE_TICKS = 21;
/** When Magic Imbue may be cast again: its own clock, so Spellbook Swap ending the effect keeps the cooldown. */
const MAGIC_IMBUE_READY_AT_ATTRIBUTE = "lunar:magic-imbue-ready-at";
/** Heal Group's cooldown: 90 s (Wiki). Heal Other's isn't settled on the Wiki, so it has none. */
const HEAL_GROUP_COOLDOWN_TICKS = 150;
/** Dream heals 1 Hitpoint every 20 s on its own timer (Wiki). */
const DREAM_HEAL_TICKS = 33;
/** Energy Transfer costs the caster 10 Hitpoints (Wiki). */
const ENERGY_TRANSFER_HITPOINTS = 10;

/**
 * Wiki (Dream Mentor, Rewards): the quest gives "the ability to use" these seven Lunar spells; the rest of the book
 * needs only Lunar Diplomacy's spellbook. Captured refusal (rec 1695 tick 219, rec 3448 tick 532): "You must have
 * completed <Quest> to use this spell."
 */
const DREAM_MENTOR_SPELLS = new Set(["monster examine", "humidify", "hunter kit", "stat spy", "dream", "plank make", "spellbook swap"]);

/**
 * A Dream Mentor spell before the quest: refused (before any other check or cost), and true. The world's
 * `quests:equipment-requirements` switch lifts this with the other quest spellbook requirements when false.
 */
export function refuseBeforeDreamMentor(player: Player, key: string): boolean {
    if (!DREAM_MENTOR_SPELLS.has(key)) return false;
    if (PluginManager.getPluginConfig<boolean>("quests:equipment-requirements", true) === false) return false;
    const query = { player, key: "dream_mentor", complete: false };
    PluginManager.emitCustomEvent("quest:is-complete", query);
    if (query.complete === true) return false;
    // Content may lift the requirement ("magic:spell-unlocked", the Grimoire league relic: "all ... spells regardless of
    // area, quest, or diary requirements"), as the Mage Arena's god spells allow.
    const unlock = { player, name: key, unlocked: false };
    PluginManager.emitCustomEvent("magic:spell-unlocked", unlock);
    if (unlock.unlocked === true) return false;
    player.sendMessage("You must have completed Dream Mentor to use this spell.");
    return true;
}

class LunarSpell extends Spell {
    private requirements?: { level: number; runes: Item[] };
    constructor(readonly name: string, readonly data: SpellData) { super(); this.members = true; }
    private cacheRequirements(): { level: number; runes: Item[] } {
        if (this.requirements) return this.requirements;
        const cached = CacheDefinitions.getSpellRequirements(this.name);
        if (!cached) throw new Error(`Missing cache spell: ${this.name}`);
        return this.requirements = { level: cached.level, runes: cached.runes.map(rune => new Item(rune.id, rune.amount)) };
    }
    spellId(): number { return this.data.spellId ?? CacheDefinitions.getSpellByName(this.name)?.widgetId ?? 0; }
    levelRequired(): number { return this.cacheRequirements().level; }
    baseExperience(): number { return this.data.experience; }
    itemsRequired(): Item[] { return this.cacheRequirements().runes.map(rune => new Item(rune.getId(), rune.getAmount())); }
    equipmentRequired(): Item[] { return []; }
    startCast(): void { }
    getSpellbook(): MagicSpellbook { return MagicSpellbook.LUNAR; }
    /** Whether the player could cast it now (Defence, level, runes), without paying; the reason sent when not. */
    castable(player: Player): boolean {
        if (player.getSkillManager().getMaxLevel(Skill.DEFENCE) < 40) {
            player.sendMessage("You need at least level 40 Defence to cast Lunar spells.");
            return false;
        }
        return this.canCast(player, false);
    }
    /** Pays for one cast and plays it; false (with the reason sent) when it can't be cast. */
    pay(player: Player): boolean {
        if (!this.castable(player) || !this.canCast(player, true)) return false;
        this.playCast(player);
        return true;
    }
    /** The caster's animation, graphic and sound, without paying. */
    playCast(player: Player): void {
        const cast = this.data.cast === undefined ? UNCAPTURED : this.data.cast;
        if (cast) {
            player.performAnimation(new Animation(cast.animation));
            // (id, delay, height): a 2-argument number that is not a GraphicHeight member would be read as a delay.
            if (cast.graphic !== undefined) player.performGraphic(new Graphic(cast.graphic, 0, (cast.graphicHeight ?? 0) as GraphicHeight));
            if (cast.sound !== undefined) player.getPacketSender().sendSoundEffect(cast.sound, 1, 0, 255);
            if (cast.areaSound !== undefined) {
                const at = player.getLocation();
                Sounds.playAreaSound({ soundId: cast.areaSound, x: at.getX(), y: at.getY(), level: at.getZ(), radius: 5 });
            }
        }
    }
    /** One cast: pays, runs `effect` and gives the Magic XP. Always true (the click is handled). */
    cast(player: Player, effect: () => void): boolean {
        if (!this.pay(player)) return true;
        effect();
        player.getSkillManager().addExperiences(Skill.MAGIC, this.data.experience);
        return true;
    }
}

class LunarTeleport extends LunarSpell {
    constructor(name: string, readonly teleport: TeleportData) { super(name, { ...teleport, cast: null }); }
    castTeleport(player: Player): boolean {
        // The cast's own checks come before anything asks (the boat-at-sea warning), so it never asks for a cast that
        // can't happen; paying checks them again.
        if (!TeleportHandler.checkReqs(player, this.teleport.destination) || !this.castable(player)) return true;
        TeleportHandler.confirm(player, this.teleport.destination, () => this.cast(player, () => TeleportHandler.teleport(player,
            this.teleport.destination, TeleportType.LUNAR, false, () => PluginManager.emitCustomEvent("spell:teleport-arrival", { player, name: this.name }))));
        return true;
    }
}

const teleport = (name: string, experience: number, x: number, y: number, z = 0) =>
    new LunarTeleport(name, { experience, destination: new Location(x, y, z) });
const spell = (name: string, experience: number, cast?: CastVisuals) => new LunarSpell(name, { experience, cast });

/** Lunar spells that can be fulfilled by the current server primitives. */
export class LunarSpells {
    public static readonly CASTS = CASTS;
    /** Spells cast straight from the spellbook (op 1, Cast). */
    private static readonly SELF = new Map<string, LunarSpell>([
        ["vengeance", spell("vengeance", 112)],
        ["dream", spell("dream", 82)],
        ["heal group", spell("heal group", 124)],
        ["spellbook swap", spell("spellbook swap", 130, castOf("spellbook swap"))],
        ["bake pie", spell("bake pie", 60, castOf("bake pie"))],
        ["humidify", spell("humidify", 65, castOf("humidify"))],
        ["hunter kit", spell("hunter kit", 70, castOf("hunter kit"))],
        ["magic imbue", spell("magic imbue", 86)],
        ["astral contact", spell("astral contact", 63, castOf("astral contact"))],
        ["string jewellery", spell("string jewellery", 83, castOf("string jewellery"))],
    ]);
    /** Spells cast on a player, an NPC or an inventory item. */
    private static readonly SPELLS = new Map<string, LunarSpell>([
        ["energy transfer", spell("energy transfer", 100)],
        ["heal other", spell("heal other", 101)],
        ["stat spy", spell("stat spy", 76)],
        ["monster examine", spell("monster examine", 61, castOf("monster examine"))],
        ["plank make", spell("plank make", 90, castOf("plank make"))],
        ["stat restore pot share", spell("stat restore pot share", 84)],
        ["boost potion share", spell("boost potion share", 88)],
    ]);
    private static readonly VENGEANCE_OTHER = new LunarSpell("vengeance other",
        { experience: 108, cast: castOf("vengeance other"), spellId: EffectSpells.VENGEANCE_OTHER.spellId() });

    /**
     * Landing tiles: rsprox captures for Moonclan (75, 86: 2114,3914-3916) and Waterbirth (3433,
     * 1851); the rest are the Wiki's map markers, Catherby's and Tele Group Moonclan's the middle
     * of the Wiki's landing area.
     */
    private static readonly TELEPORTS = new Map<string, LunarTeleport>([
        ["moonclan teleport", teleport("moonclan teleport", 66, 2114, 3915)],
        ["ourania teleport", teleport("ourania teleport", 69, 2468, 3246)],
        ["waterbirth teleport", teleport("waterbirth teleport", 71, 2546, 3754)],
        ["barbarian teleport", teleport("barbarian teleport", 76, 2543, 3569)],
        ["khazard teleport", teleport("khazard teleport", 80, 2636, 3167)],
        ["fishing guild teleport", teleport("fishing guild teleport", 89, 2613, 3391)],
        ["catherby teleport", teleport("catherby teleport", 92, 2802, 3449)],
        ["ice plateau teleport", teleport("ice plateau teleport", 96, 2975, 3938)],
    ]);

    private static readonly GROUP_TELEPORTS = new Map<string, LunarTeleport>([
        ["tele group moonclan", teleport("tele group moonclan", 67, 2110, 3915)],
        ["tele group waterbirth", teleport("tele group waterbirth", 72, 2546, 3754)],
        ["tele group barbarian", teleport("tele group barbarian", 77, 2543, 3569)],
        ["tele group khazard", teleport("tele group khazard", 81, 2636, 3167)],
        ["tele group fishing guild", teleport("tele group fishing guild", 90, 2613, 3391)],
        ["tele group catherby", teleport("tele group catherby", 93, 2802, 3449)],
        ["tele group ice plateau", teleport("tele group ice plateau", 99, 2975, 3938)],
    ]);

    /**
     * Destination, cost and level of every Lunar teleport, in the same shape as the standard and
     * Arceuus spellbooks: the construction portals reuse them for their own costs and Magic checks.
     */
    public static getTeleportDestinations() {
        return Array.from(this.TELEPORTS, ([name, spell]) => ({
            name,
            level: spell.levelRequired(),
            experience: spell.data.experience,
            runes: spell.itemsRequired(),
            destination: spell.teleport.destination,
        }));
    }

    /** A self-cast from the spellbook; `option` is the clicked op (Spellbook Swap's quick books are 2-4). */
    public static handleSelf(player: Player, name: string | undefined, option = 1): boolean {
        let key = name?.trim().toLowerCase() ?? "";
        if (key === "npc contact") key = "astral contact";
        const teleport = this.TELEPORTS.get(key);
        const groupTeleport = this.GROUP_TELEPORTS.get(key);
        const spell = this.SELF.get(key);
        if (!teleport && !groupTeleport && !spell) return false;
        if (spell && refuseBeforeDreamMentor(player, key)) return true;
        this.interrupt(player);
        if (teleport) return teleport.castTeleport(player);
        if (groupTeleport) return this.castGroupTeleport(player, groupTeleport);
        if (!spell) return false;
        switch (key) {
            case "vengeance": return EffectSpells.handleSpell(player, EffectSpells.VENGEANCE.spellId());
            case "dream": return this.castDream(player, spell);
            case "heal group": return this.castHealGroup(player, spell);
            case "spellbook swap": return this.castSpellbookSwap(player, spell, option);
            case "bake pie": return this.castBakePie(player, spell);
            case "humidify": return this.castHumidify(player, spell);
            case "hunter kit": return this.castHunterKit(player, spell);
            case "magic imbue": return this.castMagicImbue(player, spell);
            case "astral contact": return this.castNpcContact(player, spell);
            case "string jewellery": return this.castStringJewellery(player, spell);
        }
        return false;
    }

    private static castGroupTeleport(player: Player, spell: LunarTeleport): boolean {
        if (!TeleportHandler.checkReqs(player, spell.teleport.destination) || !spell.castable(player)) return true;
        TeleportHandler.confirm(player, spell.teleport.destination, () => spell.cast(player, () => {
            TeleportHandler.teleport(player, spell.teleport.destination, TeleportType.LUNAR, false,
                () => PluginManager.emitCustomEvent("spell:teleport-arrival", { player, name: spell.name }));
            this.forNearbyPlayers(player, 1, target => {
                // A passenger is asked too (the boat-at-sea warning) before they go.
                if (TeleportHandler.checkReqs(target, spell.teleport.destination)) {
                    TeleportHandler.confirm(target, spell.teleport.destination,
                        () => TeleportHandler.teleport(target, spell.teleport.destination, TeleportType.LUNAR, false));
                }
            });
        }));
        return true;
    }

    /**
     * Repeats `step` every `ticks` until it returns false or the player acts: a player-keyed task,
     * so walking, interacting, combat or another Lunar cast stops it. `onStop` runs once either way.
     * The first repeat comes after `first` ticks.
     */
    private static repeat(player: Player, ticks: number, step: () => boolean, onStop?: () => void, first = ticks): void {
        TaskManager.submit(new class extends Task {
            constructor() { super(first, player.getIndex(), false); }
            execute(): void {
                this.setDelay(ticks);
                if (!player.isRegistered() || !step()) this.stop();
            }
            stop(): void {
                if (this.isRunning()) onStop?.();
                super.stop();
            }
        });
    }

    /** A new cast ends the caster's repeating spell or Dream, as any other action does. */
    private static interrupt(player: Player): void {
        TaskManager.cancelTasks(player.getIndex());
    }

    /**
     * Sleeps until full Hitpoints, healing 1 every 20 s; any action wakes the caster, and so does
     * poison damage (Wiki: Dream).
     */
    private static castDream(player: Player, spell: LunarSpell): boolean {
        const hitpoints = () => player.getSkillManager().getCurrentLevel(Skill.HITPOINTS);
        const maximum = () => player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
        if (hitpoints() >= maximum()) {
            player.sendMessage("You have no need to cast this spell since your hitpoints are already full.");
            return true;
        }
        return spell.cast(player, () => {
            let ticks = 0;
            // Every poison splat counts, even one landing on the tick of another hit.
            const hits = player.getCombat().getHitQueue();
            const poisonSplats = hits.getPoisonSplatCount();
            this.repeat(player, 1, () => {
                if (hits.getPoisonSplatCount() !== poisonSplats) return false;
                if (++ticks % DREAM_HEAL_TICKS === 0) player.heal(1);
                return hitpoints() < maximum();
            }, () => player.performAnimation(new Animation(-1)));
        });
    }

    /**
     * 75% of the caster's Hitpoints, plus 5, split evenly among up to five injured players within a
     * tile who accept aid. Needs 11% Hitpoints; 90 s cooldown (Wiki: Heal Group).
     */
    private static castHealGroup(player: Player, spell: LunarSpell): boolean {
        const now = World.getProcessCycle();
        if (Number(player.getAttribute("lunar:heal-group-ready-at") ?? 0) > now) {
            player.sendMessage("You can't cast Heal Group again yet.");
            return true;
        }
        if (!this.hasHealingHitpoints(player)) return true;
        const injured: Player[] = [];
        this.forNearbyPlayers(player, 1, target => {
            const skills = target.getSkillManager();
            if (injured.length < 5 && skills.getCurrentLevel(Skill.HITPOINTS) < skills.getMaxLevel(Skill.HITPOINTS)) injured.push(target);
        });
        if (injured.length === 0) {
            player.sendMessage("There is nobody nearby who needs healing.");
            return true;
        }
        return spell.cast(player, () => {
            const transferred = Math.floor(player.getHitpoints() * 0.75);
            player.setHitpoints(player.getHitpoints() - transferred);
            const share = Math.floor((transferred + 5) / injured.length);
            for (const target of injured) target.heal(share);
            player.setAttribute("lunar:heal-group-ready-at", now + HEAL_GROUP_COOLDOWN_TICKS);
        });
    }

    /** Heal Other and Heal Group won't cast below 11% of the caster's Hitpoints (Wiki). */
    private static hasHealingHitpoints(player: Player): boolean {
        if (player.getHitpoints() >= Math.ceil(player.getSkillManager().getMaxLevel(Skill.HITPOINTS) * 0.11)) return true;
        player.sendMessage("You need more hitpoints to cast this spell.");
        return false;
    }

    /**
     * Op 1 asks which book; ops 2-4 are the Standard, Ancient and Arceuus quick picks. Only an unlocked book is
     * swapped to (Wiki): a locked quick pick is refused before the cast, and the menu lists only open books.
     */
    private static castSpellbookSwap(player: Player, spell: LunarSpell, option: number): boolean {
        const books = [MagicSpellbook.NORMAL, MagicSpellbook.ANCIENT, MagicSpellbook.ARCEUUS];
        const quick = option >= 2 && option <= 4 ? books[option - 2] : undefined;
        if (quick) {
            if (this.refuseLockedBook(player, quick)) return true;
            return this.castSwapTo(player, spell, quick);
        }
        // Wiki (Spellbook Swap): the runes are spent when a book is selected, so the menu only checks them.
        if (spell.castable(player)) this.openSpellbookSwap(player, spell);
        return true;
    }

    /** Pays for the swap and moves to `book`. */
    private static castSwapTo(player: Player, spell: LunarSpell, book: MagicSpellbook): boolean {
        return spell.cast(player, () => {
            // Spellbook Swap ends Magic Imbue's effect (Wiki), not its 21-tick cooldown.
            player.setAttribute("lunar:magic-imbue-until", null);
            this.swapTo(player, book);
        });
    }

    /** A book the player hasn't unlocked (core SpellbookLocks): refused with the captured message box, and true. */
    private static refuseLockedBook(player: Player, book: MagicSpellbook): boolean {
        const quest = lockingQuest(player, book);
        if (!quest) {
            if (!arceuusLocked(player, book)) return false;
            // rsprox_transcripts/227/00086.txt: the Arceuus quick pick before speaking to Tyss.
            player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, ARCEUUS_LOCKED_MESSAGE)));
            return true;
        }
        // Captured with its colours (rsprox_transcripts/227/00086.txt, a league recording): "You need to have completed
        // <col=800000>Desert Treasure I<col=000000> in order to use <col=000000>Ancient Magicks."
        const bookName = book === MagicSpellbook.ANCIENT ? "Ancient Magicks" : "that spellbook";
        player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0,
            `You need to have completed <col=800000>${quest.name}<col=000000> in order to use <col=000000>${bookName}.`)));
        return true;
    }

    /** Bakes every uncooked pie one after another, a cast (runes and XP) per pie (Wiki: Bake Pie). */
    private static castBakePie(player: Player, spell: LunarSpell): boolean {
        const cooking = () => player.getSkillManager().getCurrentLevel(Skill.COOKING);
        const next = () => player.getInventory().getValidItems().find(item => {
            const pie = PIES.get(item.getId());
            return pie !== undefined && cooking() >= pie[1];
        });
        if (!next()) {
            const raw = player.getInventory().getValidItems().find(item => PIES.has(item.getId()));
            player.sendMessage(raw
                ? `You need a Cooking level of ${PIES.get(raw.getId())![1]} to bake this pie.`
                : "You do not have any uncooked pies to bake.");
            return true;
        }
        const bake = (): boolean => {
            const item = next();
            if (!item || !spell.pay(player)) return false;
            const [pie, , experience] = PIES.get(item.getId())!;
            const rawId = item.getId();
            item.setId(pie);
            player.getInventory().refreshItems();
            player.getSkillManager().addExperiences(Skill.MAGIC, spell.baseExperience());
            player.getSkillManager().addExperiences(Skill.COOKING, experience);
            PluginManager.emitCustomEvent("cooking:success", {
                player, skill: Skill.COOKING, rawId, itemId: pie, amount: 1, location: player.getLocation().clone(),
            });
            return next() !== undefined;
        };
        if (bake()) this.repeat(player, BAKE_TICKS, bake);
        return true;
    }

    /** Fills every empty vessel in one cast; Farming adds seedlings and watering cans (Wiki: Humidify). */
    private static castHumidify(player: Player, spell: LunarSpell): boolean {
        const containers = new Map(WATER_CONTAINERS);
        PluginManager.emitCustomEvent("magic:water-containers", { player, containers });
        const inventory = player.getInventory();
        if (!inventory.getValidItems().some(item => containers.has(item.getId()))) {
            player.sendMessage("You do not have any containers that can be filled with water.");
            return true;
        }
        return spell.cast(player, () => {
            for (const item of inventory.getValidItems()) {
                const filled = containers.get(item.getId());
                if (filled) item.setId(filled);
            }
            inventory.refreshItems();
            PluginManager.emitCustomEvent("magic:humidified", { player });
        });
    }

    /** One hunter kit, which opens into the Hunter gear (Wiki: Hunter Kit). */
    private static castHunterKit(player: Player, spell: LunarSpell): boolean {
        const inventory = player.getInventory();
        if (inventory.contains(HUNTER_KIT) || HUNTER_KIT_CONTENTS.every(id => inventory.contains(id))) {
            player.sendMessage("Why do you want to create a kit? You already have all the Hunter equipment it contains.");
            return true;
        }
        if (inventory.getFreeSlots() < 1) {
            player.sendMessage("You don't have enough inventory space.");
            return true;
        }
        return spell.cast(player, () => inventory.adds(HUNTER_KIT, 1).refreshItems());
    }

    /** Lets combination runes be crafted without the talisman for 21 ticks (Wiki: Magic Imbue). */
    private static castMagicImbue(player: Player, spell: LunarSpell): boolean {
        const now = World.getProcessCycle();
        // Wiki: "This spell can only be cast once every 12.6 seconds (21 game ticks)."
        if (Number(player.getAttribute(MAGIC_IMBUE_READY_AT_ATTRIBUTE) ?? 0) > now) {
            player.sendMessage("You can't use that spell yet.");
            return true;
        }
        return spell.cast(player, () => {
            player.setAttribute("lunar:magic-imbue-until", now + MAGIC_IMBUE_TICKS);
            player.setAttribute(MAGIC_IMBUE_READY_AT_ATTRIBUTE, now + MAGIC_IMBUE_TICKS);
            player.sendMessage("You are charged to combine runes!");
        });
    }

    /** Strings each unstrung amulet, one every 3 ticks, a cast (runes and XP) per amulet (Wiki: String Jewellery). */
    private static castStringJewellery(player: Player, spell: LunarSpell): boolean {
        const next = () => player.getInventory().getValidItems().find(item => UNSTRUNG.has(item.getId()));
        if (!next()) {
            player.sendMessage("You do not have any unstrung amulets to string.");
            return true;
        }
        const string = (): boolean => {
            const item = next();
            if (!item || !spell.pay(player)) return false;
            item.setId(UNSTRUNG.get(item.getId())!);
            player.getInventory().refreshItems();
            player.getSkillManager().addExperiences(Skill.MAGIC, spell.baseExperience());
            player.getSkillManager().addExperiences(Skill.CRAFTING, STRING_CRAFTING_XP);
            return next() !== undefined;
        };
        if (string()) this.repeat(player, STRING_TICKS, string);
        return true;
    }

    public static handlePlayerTarget(player: Player, target: Player, name: string | undefined): boolean {
        const key = name?.trim().toLowerCase() ?? "";
        if (!["energy transfer", "heal other", "vengeance other", "stat spy"].includes(key)) return false;
        if (refuseBeforeDreamMentor(player, key)) return true;
        // Stat Spy only reads the target's stats: the duel rule is for the spells that aid one.
        const aid = key !== "stat spy";
        if (target === player || !this.acceptsAid(target) || (aid && (this.inDuel(player) || this.inDuel(target))) ||
            !this.sameInstance(player, target) ||
            !player.getLocation().isWithinDistance(target.getLocation(), 10)) return false;
        // Wiki (Energy Transfer): it can't be cast in single-way combat PvP areas, nor from multi onto a player
        // standing in single-way Wilderness.
        if (key === "energy transfer" && (this.inSingleWayPvp(player) || this.inSingleWayPvp(target))) return false;
        // Wiki (Vengeance Other): "unable to cast" it "in a single-combat area inside the Wilderness" (the house half
        // is Construction's spell-disabled hook). The Wilderness itself, levelled: not a PvP zone elsewhere.
        if (key === "vengeance other" && this.inSingleWayPvp(player) &&
            Wilderness.levelAt(player.getLocation().getX(), player.getLocation().getY()) > 0) return false;
        this.interrupt(player);
        if (key === "vengeance other") return this.castVengeanceOther(player, target);
        const spell = this.SPELLS.get(key)!;
        if (key === "energy transfer") {
            if (player.getSpecialPercentage() < 100) {
                player.sendMessage("You need a full special attack bar to cast Energy Transfer.");
                return true;
            }
            if (player.getHitpoints() <= ENERGY_TRANSFER_HITPOINTS) {
                player.sendMessage("You need more hitpoints to cast this spell.");
                return true;
            }
            // The caster gives their whole special bar and 10 Hitpoints; the target gets a full
            // special bar and full run energy (Wiki: Energy Transfer).
            return spell.cast(player, () => {
                player.setHitpoints(player.getHitpoints() - ENERGY_TRANSFER_HITPOINTS);
                player.setSpecialPercentage(0);
                target.setSpecialPercentage(100);
                target.setRunEnergy(100);
                target.getPacketSender().updateSpecialAttackOrb().sendRunEnergy();
                player.getPacketSender().updateSpecialAttackOrb();
            });
        }
        if (key === "heal other") {
            // "Up to" 75% of the caster's Hitpoints (Wiki): no more than the target is missing.
            const missing = target.getSkillManager().getMaxLevel(Skill.HITPOINTS) - target.getHitpoints();
            if (missing <= 0) {
                player.sendMessage("That player doesn't need healing.");
                return true;
            }
            if (!this.hasHealingHitpoints(player)) return true;
            return spell.cast(player, () => {
                const transferred = Math.min(missing, Math.floor(player.getHitpoints() * 0.75));
                player.setHitpoints(player.getHitpoints() - transferred);
                target.heal(transferred);
            });
        }
        return spell.cast(player, () => {
            const stats = Skill.values().map(skill => `${skill.getName()}: ${target.getSkillManager().getCurrentLevel(skill)}`).join(", ");
            player.sendMessage(stats);
            target.sendMessage(`${player.getDisplayName()} is reading your skill stats!`);
        });
    }

    private static castVengeanceOther(player: Player, target: Player): boolean {
        // The cooldown is the caster's, shared with Vengeance; the target's own doesn't matter (Wiki: Vengeance_Other).
        if (EffectSpells.vengeanceOnCooldown(player)) return true;
        if (target.hasVengeanceReturn()) {
            player.sendMessage("That player cannot receive Vengeance right now.");
            return true;
        }
        return this.VENGEANCE_OTHER.cast(player, () => {
            target.setHasVengeance(true);
            // Raw2796: immediate radius10 sound is at the caster, not the graphic on the recipient.
            Sounds.playAreaSoundAt(player, Sound.VENGEANCE_OTHER, 10);
            EffectSpells.startVengeanceCooldown(player);
            target.performGraphic(new Graphic(725, GraphicHeight.HIGH));
            target.sendMessage("You have the power of vengeance!");
        });
    }

    public static handleNpcTarget(player: Player, target: any, name: string | undefined): boolean {
        if (name?.trim().toLowerCase() !== "monster examine" || !target || !this.sameInstance(player, target) ||
            !player.getLocation().isWithinDistance(target.getLocation(), 10)) return false;
        if (refuseBeforeDreamMentor(player, "monster examine")) return true;
        this.interrupt(player);
        return this.SPELLS.get("monster examine")!.cast(player, () => {
            player.setPositionToFace(target.getLocation());
            // The NPC's own graphic lands as the caster's ends (rsprox 3235: spotanim 736, delay 76).
            target.performGraphic(new Graphic(736, 76, GraphicHeight.MIDDLE));
            player.getPacketSender()
                .sendMagicTabInterface(MONSTER_STATS_INTERFACE)
                .sendClientScript(MONSTER_STATS_SCRIPT, this.monsterStats(target));
            PluginManager.emitCustomEvent("magic:monster-examine", { player, npc: target });
        });
    }

    /**
     * Interface 522's text, as live sends it to script 1179: four `|`-separated sections and the
     * NPC's name; bonuses of 0 are left out of Aggressive Stats (rsprox 3235, 3377, 2224, 4127).
     */
    public static monsterStats(npc: any, options: {
        includeMaxHit?: boolean; includeAttackStyle?: boolean; meleeBonusLabel?: string;
    } = {}): string {
        const definition = npc.getCurrentDefinition();
        const stats: number[] = definition.getStats();
        const style = definition.getAttackStyle() || "crush";
        const styleName = style === "ranged" ? "Range" : style.charAt(0).toUpperCase() + style.slice(1);
        const heading = (title: string) => `<col=ffb000>${title}</col>`;
        const section = (title: string, lines: string[]) => [heading(title), ...lines].join("<br>");
        const aggressive = [`Attack speed: ${definition.getAttackSpeed()}`];
        const bonus = (label: string, value: number | undefined) => { if (value) aggressive.push(`${label}: ${value}`); };
        bonus(options.meleeBonusLabel ?? (style === "ranged" || style === "magic" ? "Melee bonus" : `${styleName} bonus`), stats[5]);
        bonus("Magic bonus", stats[7]);
        bonus("Ranged bonus", stats[9]);
        const attributes = [definition.getSlayerLevel() > 0 ? "- Is a slayer monster." : "- Is not a slayer monster."];
        if (definition.isPoisonImmune()) attributes.push("- Poison Resistance: 100%.");
        const weakness = definition.getElementalWeakness();
        if (weakness) attributes.push(`- ${weakness.percent}% ${ELEMENTS[weakness.type - 1]} weakness.`);
        const basicStats = [
            `Combat level: ${definition.getCombatLevel()}`, `Hitpoints: ${npc.getHitpoints()}`,
            `Attack: ${npc.getCurrentLevel(Skill.ATTACK)}`, `Defence: ${npc.getCurrentLevel(Skill.DEFENCE)}`,
            `Strength: ${npc.getCurrentLevel(Skill.STRENGTH)}`, `Magic: ${npc.getCurrentLevel(Skill.MAGIC)}`,
            `Ranged: ${npc.getCurrentLevel(Skill.RANGED)}`,
        ];
        if (options.includeMaxHit !== false) basicStats.push(`Max standard hit: ${definition.getMaxHit()}`);
        if (options.includeAttackStyle !== false) basicStats.push(`Main attack style: ${styleName}`);
        return [
            section("Stats", basicStats),
            section("Aggressive Stats", aggressive),
            section("Defensive Stats", [
                `Stab: ${stats[10] ?? 0}`, `Slash: ${stats[11] ?? 0}`, `Crush: ${stats[12] ?? 0}`, `Magic: ${stats[13] ?? 0}`,
                `Light Ranged: ${definition.getRangedDefenceBonus("light")}`,
                `Standard Ranged: ${definition.getRangedDefenceBonus("standard")}`,
                `Heavy Ranged: ${definition.getRangedDefenceBonus("heavy")}`,
            ]),
            section("Other Attributes", attributes),
            definition.getName(),
        ].join("|");
    }

    /** Interface 522's close button puts the spellbook back in the magic tab (rsprox 3235). */
    public static handleWidgetAction(player: Player, groupId: number, childId: number): boolean {
        if (groupId !== MONSTER_STATS_INTERFACE || childId !== MONSTER_STATS_CLOSE) return false;
        player.getPacketSender().sendTabInterface(6, player.getSpellbook().getInterfaceId());
        return true;
    }

    /** Spells cast on an inventory item: Plank Make on a log, the potion shares on a potion. */
    public static handleItemTarget(player: Player, itemId: number, slot: number, name: string | undefined): boolean {
        // Recharge Dragonstone has no target; the Jewellery plugin casts it.
        const key = name?.trim().toLowerCase() ?? "";
        if (key !== "plank make" && key !== "stat restore pot share" && key !== "boost potion share") return false;
        const item = player.getInventory().getItems()[slot];
        if (!item || item.getId() !== itemId) return false;
        if (refuseBeforeDreamMentor(player, key)) return true;
        this.interrupt(player);
        const spell = this.SPELLS.get(key)!;
        if (key === "plank make") return this.castPlankMake(player, spell, itemId);
        return this.castPotionShare(player, spell, slot, key === "stat restore pot share" ? "restore" : "boost");
    }

    /**
     * Turns one log into a plank for 70% of the sawmill's price, then keeps going every 6 ticks on
     * logs of the same kind until stopped (Wiki: Plank Make).
     */
    private static castPlankMake(player: Player, spell: LunarSpell, logId: number): boolean {
        const plank = PLANKS.get(logId);
        if (!plank) {
            player.sendMessage("You can only cast this spell on logs.");
            return true;
        }
        const inventory = player.getInventory();
        const make = (): boolean => {
            const log = inventory.getValidItems().find(item => item.getId() === logId);
            if (!log) return false;
            if (inventory.getAmount(COINS) < plank[1]) {
                player.sendMessage(`You need ${plank[1]} coins to convert that log into a plank.`);
                return false;
            }
            if (!spell.pay(player)) return false;
            inventory.deleteNumber(COINS, plank[1]);
            log.setId(plank[0]);
            inventory.refreshItems();
            player.getSkillManager().addExperiences(Skill.MAGIC, spell.baseExperience());
            PluginManager.emitCustomEvent("magic:plank-make", { player, logId, plankId: plank[0] });
            return inventory.contains(logId);
        };
        const start = (): void => {
            if (make()) {
                this.repeat(player, PLANK_TICKS, make,
                    () => PluginManager.emitCustomEvent("magic:plank-make-end", { player }),
                    PLANK_FIRST_REPEAT_TICKS);
            } else {
                PluginManager.emitCustomEvent("magic:plank-make-end", { player });
            }
        };
        const confirm = PLANK_CONFIRM_VARBITS.get(logId);
        if (confirm === undefined || player.getPacketSender().getVarbit?.(confirm) !== 1
            || !inventory.contains(logId) || inventory.getAmount(COINS) < plank[1]) {
            start();
            return true;
        }
        // Ours: the question and its options (no capture of the confirmation).
        player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
            new OptionDialogue(0, { executeOption: (option: DialogueOption) => {
                player.getPacketSender().sendInterfaceRemoval();
                if ((option as number) === 1) start();
            } }, "Yes", "No").setTitle(`Pay ${plank[1]} coins for each plank?`)));
        return true;
    }

    /**
     * The potion gives a dose to each player within 2 tiles who accepts aid, as many as it has doses,
     * and the caster drinks one free (Wiki: Stat Restore Pot Share, Boost Potion Share).
     */
    private static castPotionShare(player: Player, spell: LunarSpell, slot: number, kind: "restore" | "boost"): boolean {
        const targets: Player[] = [];
        this.forNearbyPlayers(player, 2, target => targets.push(target));
        const share = { player, slot, kind, targets, valid: false, message: null as string | null, apply: null as null | (() => void) };
        PluginManager.emitCustomEvent("potions:share", share);
        if (!share.valid || !share.apply) {
            player.sendMessage(share.message ?? "You can't share that potion.");
            return true;
        }
        return spell.cast(player, share.apply);
    }

    /**
     * A duel is the two duelists' alone: no one else's Vengeance, healing or energy reaches them (the Duel Arena's open
     * map would otherwise let a spectator within range aid one, past the No Magic rule too), and a duelist aids no one.
     */
    private static inDuel(player: Player): boolean {
        return player.getDueling?.()?.inDuel?.() === true;
    }

    /** Players other than the caster within `distance` who accept aid, are alive and aren't in a duel. */
    private static forNearbyPlayers(player: Player, distance: number, effect: (target: Player) => void): void {
        World.getPlayers().forEach(target => {
            if (target && target !== player && this.acceptsAid(target) && !this.inDuel(target) && target.getHitpoints() > 0 &&
                this.sameInstance(player, target) &&
                player.getLocation().isWithinDistance(target.getLocation(), distance)) effect(target);
        });
    }

    /**
     * Whether `target` shares the caster's private world: players in separate instances (solo
     * Colosseum runs, raids) can stand on the same coordinates without seeing each other.
     */
    private static sameInstance(player: Player, target: any): boolean {
        return (player.getPrivateArea() ?? null) === (target.getPrivateArea?.() ?? null);
    }

    /** Standing on single-way PvP ground (the Wilderness or another PvP zone, outside its safe spots). */
    private static inSingleWayPvp(player: Player): boolean {
        return Wilderness.isIn(player) && !AreaManager.inMulti(player);
    }

    private static acceptsAid(player: Player): boolean {
        return player.getAttribute("accept-aid") !== false;
    }

    public static expireSpellbookSwap(player: Player): void {
        const swap: any = player.getAttribute("lunar:spellbook-swap");
        if (swap && World.getProcessCycle() >= swap.expiresAt) {
            player.setAttribute("lunar:spellbook-swap", null);
            MagicSpellbook.changeSpellbook(player, MagicSpellbook.LUNAR, true);
        }
    }

    /**
     * NPC Contact as live casts it (rsprox 4045, rev 237): the animation, graphic and sound on the click, then 7 ticks
     * later the runes and XP go and the contact list (lunar_contact_npc) opens. Walking in between doesn't stop it.
     * The list and the contacts are plugins/interface/NpcContact.plugin.js's.
     */
    private static castNpcContact(player: Player, spell: LunarSpell): boolean {
        // Ours: a second click while the first cast is pending is ignored, so one list costs one cast's runes.
        if (NPC_CONTACT_PENDING.has(player) || !spell.castable(player)) return true;
        NPC_CONTACT_PENDING.add(player);
        spell.playCast(player);
        // Closing the modal held since the click is fine; any modal opened after it (another one, the same one
        // mounted again, or one opened and closed between ticks) owns the screen instead.
        const opens = player.getInterfaceOpens();
        let ticks = 0;
        TaskManager.submit(new class extends Task {
            constructor() { super(1, false); }
            execute(): void {
                // Ours (no capture dies or opens a modal mid-cast): dying, logging out or another modal taking the
                // screen ends the cast unpaid, so it never pays or opens the list in a later life or over that modal.
                const ended = !player.isRegistered() || player.isDyingReturn() || player.getHitpoints() <= 0
                    || player.getInterfaceOpens() !== opens;
                if (!ended && ++ticks < NPC_CONTACT_TICKS) return;
                this.stop();
                NPC_CONTACT_PENDING.delete(player);
                if (ended || !spell.canCast(player, true)) return;
                player.getSkillManager().addExperiences(Skill.MAGIC, spell.data.experience);
                PluginManager.emitCustomEvent("magic:npc-contact", { player });
            }
        });
        return true;
    }

    /** Two minutes on the chosen book for one spell, then back to Lunar (Wiki: Spellbook Swap). */
    private static swapTo(player: Player, book: MagicSpellbook): void {
        player.setAttribute("lunar:spellbook-swap", { expiresAt: World.getProcessCycle() + 200 });
        MagicSpellbook.changeSpellbook(player, book, true);
        player.sendMessage("You have 2 minutes before your spellbook changes back!");
    }

    /** Wiki (Spellbook Swap): the menu offers only "the spellbooks they have access to". */
    private static openSpellbookSwap(player: Player, spell: LunarSpell): void {
        const books = ([[MagicSpellbook.NORMAL, "Standard"], [MagicSpellbook.ANCIENT, "Ancient"], [MagicSpellbook.ARCEUUS, "Arceuus"]] as const)
            .filter(([book]) => spellbookOpen(player, book));
        const builder = new DialogueChainBuilder();
        builder.add(new OptionDialogue(0, { executeOption: (option: DialogueOption) => {
            const book = books[(option as number) - 1]?.[0];
            player.getPacketSender().sendInterfaceRemoval();
            // The cast is paid now, so a menu left open while the book changed elsewhere casts nothing.
            if (player.getSpellbook() !== MagicSpellbook.LUNAR) return;
            if (book && !this.refuseLockedBook(player, book)) this.castSwapTo(player, spell, book);
        } }, ...books.map(([, label]) => label)));
        player.getDialogueManager().startDialogues(builder);
    }
}
