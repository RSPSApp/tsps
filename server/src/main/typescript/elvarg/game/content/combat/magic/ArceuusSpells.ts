import { Player } from "../../../entity/impl/player/Player";
import { GameConstants } from "../../../GameConstants";
import { World } from "../../../World";
import { Item } from "../../../model/Item";
import { Location } from "../../../model/Location";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { Skill } from "../../../model/Skill";
import { TeleportHandler } from "../../../model/teleportation/TeleportHandler";
import { TeleportType } from "../../../model/teleportation/TeleportType";
import { Spell } from "./Spell";
import { ArceuusOfferings } from "./ArceuusOfferings";
import { ArceuusUtilities } from "./ArceuusUtilities";
import { ArceuusThralls } from "./ArceuusThralls";
import { Task } from "../../../task/Task";
import { TaskManager } from "../../../task/TaskManager";
import { Animation } from "../../../model/Animation";
import { Graphic } from "../../../model/Graphic";
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { PluginManager } from "../../../../plugins/PluginManager";
import { resolveChatHighlights } from "../../../../net/protocol/ClientProtocol";
import { CombatRange } from "../CombatRange";

type TeleportSpell = {
    level: number;
    experience: number;
    runes: Item[];
    destination: Location;
    cooldown?: { attribute: string; duration: number };
    /** A quest the teleport needs completed (Wiki: Arceuus spellbook). */
    quest?: { key: string; name: string; message?: string };
};

type SelfSpell = {
    id: number; level: number; experience: number; runes: Item[]; effect: (player: Player) => void;
    cooldown?: { attribute: string; duration: number; message?: string | ((player: Player) => string) };
    castDelay?: boolean;
    /** The cast's animation and graphic (cache ids), and the message it sends. */
    animation?: number; graphic?: number; message?: string;
    /** Why the spell can't be cast now (a message), checked before runes are taken. */
    blocked?: (player: Player) => string | null;
};

/** Death Charge, as in rsprox recordings 4102 (cast, fade) and 3340 (recast refusals, kill). */
const DEATH_CHARGE_TICKS = 100;
const DEATH_CHARGE_COOLDOWN_VARBIT = "arceuus_death_charge_cooldown";
const DEATH_CHARGE_ACTIVE_VARBIT = "arceuus_death_charge_active";
const DEATH_CHARGE_CAST_SOUND = 5034;
const DEATH_CHARGE_FADE_SOUND = 5056;
/** Wiki: the caster must be within 16 tiles of the slain creature (any tile of a large one). */
const DEATH_CHARGE_RANGE = 16;
/** Wiki: it does not trigger after PvP combat in the last ten ticks (Mod Ash: "attacked by a player lately"). */
const DEATH_CHARGE_PVP_TICKS = 10;
const DEATH_CHARGE_PENDING = "You already have a Death Charge pending on you.";
const DEATH_CHARGE_COOLDOWN = "You can only cast Death Charge every 60 seconds.";
// Live's purple highlight: a53fff on a transparent chatbox, 6800bf on an opaque one (237/04102.txt; 241/900051.txt
// sends the @mes_hl_pur@ tag itself).
const DEATH_CHARGE_CAST = "@mes_hl_pur@Upon the death of your next foe, some of your special attack energy will be restored.</col>";
const DEATH_CHARGE_RESTORED = "@mes_hl_pur@Some of your special attack energy has been restored.</col>";
const DEATH_CHARGE_FADED = "@mes_hl_pur@Your Death Charge has faded away.</col>";

/** The cache's self-cast Arceuus animation (human_cast_selfimbue). */
const SELF_IMBUE = 8970;

class ArceuusSelfSpell extends Spell {
    constructor(private readonly data: SelfSpell) { super(); }
    spellId(): number { return this.data.id; }
    levelRequired(): number { return this.data.level; }
    baseExperience(): number { return this.data.experience; }
    itemsRequired(): Item[] { return this.data.runes; }
    equipmentRequired(): Item[] { return []; }
    startCast(): void { }
    getSpellbook(): MagicSpellbook { return MagicSpellbook.ARCEUUS; }
    protected getCastCooldown() { return this.data.cooldown ?? null; }
    protected usesSharedCastDelay() { return this.data.castDelay === true; }
    cast(player: Player): boolean {
        const cooldown = this.data.cooldown;
        if (cooldown && Number(player.getAttribute(cooldown.attribute) ?? 0) > World.getProcessCycle()) {
            const message = typeof cooldown.message === "function" ? cooldown.message(player) : cooldown.message;
            if (message) player.sendMessage(message);
            return true;
        }
        const blocked = this.data.blocked?.(player);
        if (blocked) {
            player.sendMessage(blocked);
            return true;
        }
        if (!this.canCast(player, false) || !this.canCast(player, true)) return true;
        if (this.data.animation) player.performAnimation(new Animation(this.data.animation));
        if (this.data.graphic) player.performGraphic(new Graphic(this.data.graphic));
        if (this.data.message) player.sendMessage(this.data.message);
        this.data.effect(player);
        player.getSkillManager().addExperiences(Skill.MAGIC, this.data.experience);
        return true;
    }
}

class ArceuusTeleportSpell extends Spell {
    constructor(readonly data: TeleportSpell) {
        super();
    }

    spellId(): number { return 0; }
    levelRequired(): number { return this.data.level; }
    baseExperience(): number { return this.data.experience; }
    itemsRequired(): Item[] { return this.data.runes; }
    equipmentRequired(): Item[] { return []; }
    startCast(): void { }
    getSpellbook(): MagicSpellbook { return MagicSpellbook.ARCEUUS; }
    protected getCastCooldown() { return this.data.cooldown ?? null; }

    cast(player: Player): boolean {
        const quest = this.data.quest;
        // The world's quests:equipment-requirements switch lifts the quest with the other spellbook requirements.
        if (quest && PluginManager.getPluginConfig<boolean>("quests:equipment-requirements", true) !== false) {
            const query = { player, key: quest.key, complete: false };
            PluginManager.emitCustomEvent("quest:is-complete", query);
            if (!query.complete) {
                // A quest without its own line (West Ardougne, Harmony Island) uses TSPS wording.
                player.sendMessage(quest.message ?? `You need to complete ${quest.name} to cast this spell.`);
                return true;
            }
        }
        if (!TeleportHandler.checkReqs(player, this.data.destination) || !this.canCast(player, false)) {
            return true;
        }
        TeleportHandler.confirm(player, this.data.destination, () => {
            if (!this.canCast(player, true)) return;
            player.getSkillManager().addExperiences(Skill.MAGIC, this.data.experience);
            TeleportHandler.teleport(player, this.data.destination, TeleportType.ARCEUUS, false);
        });
        return true;
    }
}

const rune = (id: number, amount = 1) => new Item(id, amount);
const teleport = (level: number, experience: number, runes: Item[], x: number, y: number, z = 0, cooldown?: TeleportSpell["cooldown"],
    quest?: TeleportSpell["quest"]) =>
    new ArceuusTeleportSpell({ level, experience, runes, destination: new Location(x, y, z), cooldown, quest });
/**
 * Wiki (Salve Graveyard Teleport): "You must have completed Priest in Peril and received Drezel's warning to cast
 * this spell." Fenkenstrain's Castle Teleport has the same requirement, so the same line (inferred).
 */
const PRIEST_IN_PERIL = {
    key: "priest_in_peril",
    name: "Priest in Peril",
    message: "You must have completed Priest in Peril and received Drezel's warning to cast this spell.",
};
// rsprox captures (227/1000586.txt tick 845: a second click the tick of a cast).
const THRALL_COOLDOWN = { attribute: "arceuus:thrall-until", duration: 10_000, message: "You can only cast resurrection spells every 10 seconds." };
/**
 * Resurrect, as in rsprox captures: the caster plays human_spellcast_resurrect with its kind's cast
 * graphic, and the thrall rises with its kind's impact graphic and spawn animation, the *_raised ones
 * since revision 237 (no capture has a zombie rising since then).
 */
const RESURRECT = 8973;
const GHOST = { cast: 1873, impact: 1903, rise: 13683, kind: "ghostly" };
const SKELETON = { cast: 1874, impact: 1904, rise: 13684, kind: "skeletal" };
const ZOMBIE = { cast: 1875, impact: 1905, rise: 13685, kind: "zombified" };

/** Self-cast Arceuus spells. Targeted spells remain in their respective packet handlers. */
export class ArceuusSpells {
    public static readonly WARD_UNTIL = "arceuus:ward-until";
    public static readonly DEATH_CHARGE_UNTIL = "arceuus:death-charge-until";
    private static readonly DEATH_CHARGE_TOKEN = "arceuus:death-charge-token";
    public static readonly SHADOW_VEIL_UNTIL = "arceuus:shadow-veil-until";
    public static readonly MARK_UNTIL = "arceuus:mark-until";
    private static readonly CORRUPTION = "arceuus:corruption";
    private static readonly CORRUPTION_MARKED = "arceuus:corruption-marked";
    private static readonly CORRUPTION_COOLDOWN = "arceuus:corruption-cooldown";
    private static readonly MARK_TOKEN = "arceuus:mark-token";
    private static readonly SELF_SPELLS = new Map<string, ArceuusSelfSpell>([
        // Wiki: lasts a tick per Magic level at casting.
        ["ward of arceuus", new ArceuusSelfSpell({
            id: 20763, level: 73, experience: 83, runes: [rune(566, 4), rune(561, 2), rune(564)],
            animation: SELF_IMBUE, graphic: 1851,
            cooldown: { attribute: "arceuus:ward-cooldown", duration: 30_000, message: "You can only cast Ward of Arceuus every 30 seconds." },
            effect: (player) => player.setAttribute(this.WARD_UNTIL, World.getProcessCycle() + player.getSkillManager().getCurrentLevel(Skill.MAGIC)),
        })],
        // Wiki: lasts 3 ticks per base Magic level (x5 with a purging staff), with its messages.
        ["mark of darkness", new ArceuusSelfSpell({
            id: 20392, level: 59, experience: 70, runes: [rune(566), rune(564)],
            animation: SELF_IMBUE, graphic: 1852, message: "You have placed a Mark of Darkness upon yourself",
            effect: (player) => ArceuusSpells.placeMark(player),
        })],
        // Wiki: one corruption spell every 30 seconds; the Mark at casting makes it certain and faster.
        ["lesser corruption", new ArceuusSelfSpell({
            id: 10511, level: 64, experience: 75, runes: [rune(560), rune(566, 2)],
            animation: SELF_IMBUE, graphic: 1877,
            cooldown: { attribute: this.CORRUPTION_COOLDOWN, duration: 30_000, message: "You can only cast corruption spells every 30 seconds." },
            effect: (player) => this.primeCorruption(player, 6),
        })],
        ["greater corruption", new ArceuusSelfSpell({
            id: 20762, level: 85, experience: 95, runes: [rune(565), rune(566, 3)],
            animation: SELF_IMBUE, graphic: 1878,
            cooldown: { attribute: this.CORRUPTION_COOLDOWN, duration: 30_000, message: "You can only cast corruption spells every 30 seconds." },
            effect: (player) => this.primeCorruption(player, 12),
        })],
        ["demonic offering", new ArceuusSelfSpell({
            id: 15346, level: 84, experience: 175, runes: [rune(566), rune(21880)],
            cooldown: { attribute: "arceuus:offering-until", duration: 5_400 },
            animation: 8975, graphic: 1871,
            effect: (player) => ArceuusOfferings.demonic(player),
        })],
        ["sinister offering", new ArceuusSelfSpell({
            id: 8796, level: 92, experience: 180, runes: [rune(565), rune(21880)],
            cooldown: { attribute: "arceuus:offering-until", duration: 5_400 },
            animation: 8975, graphic: 1872,
            blocked: (player) => ArceuusOfferings.sinisterRefusal(player),
            effect: (player) => ArceuusOfferings.sinister(player),
        })],
        // Wiki: a minute to make one kill, once every 60 seconds; recording 4102 for the cast's state.
        ["death charge", new ArceuusSelfSpell({
            id: 15309, level: 80, experience: 90, runes: [rune(560), rune(565), rune(566)],
            animation: SELF_IMBUE, graphic: 1854,
            cooldown: {
                attribute: "arceuus:death-charge-cooldown", duration: 60_000,
                message: (player) => this.hasDeathCharge(player) ? DEATH_CHARGE_PENDING : DEATH_CHARGE_COOLDOWN,
            },
            effect: (player) => this.startDeathCharge(player),
        })],
        ["degrime", new ArceuusSelfSpell({
            id: 15345, level: 70, experience: 83, runes: [rune(557, 4), rune(561, 2)],
            animation: 8980, graphic: 1885,
            effect: (player) => ArceuusUtilities.degrime(player),
        })],
        // Wiki: lasts a tick per base Magic level.
        ["shadow veil", new ArceuusSelfSpell({
            id: 15344, level: 47, experience: 58, runes: [rune(557, 5), rune(554, 5), rune(564, 5)],
            animation: 8979, graphic: 1881,
            cooldown: { attribute: "arceuus:shadow-veil-cooldown", duration: 30_000, message: "You can only cast Shadow Veil every 30 seconds." },
            effect: (player) => player.setAttribute(this.SHADOW_VEIL_UNTIL, World.getProcessCycle() + player.getSkillManager().getMaxLevel(Skill.MAGIC)),
        })],
        // Wiki: prayer to run energy 1:1, only as much as fills it, once every 10.2 seconds.
        ["vile vigour", new ArceuusSelfSpell({
            id: 15304, level: 66, experience: 76, runes: [rune(566), rune(556, 3)],
            animation: 8978, graphic: 1876,
            cooldown: { attribute: "arceuus:vile-vigour-cooldown", duration: 10_200, message: "You can only cast Vile Vigour every 10 seconds." },
            effect: (player) => {
                const prayer = player.getSkillManager().getCurrentLevel(Skill.PRAYER);
                const spent = Math.min(prayer, 100 - player.getRunEnergy());
                player.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, spent, 0);
                player.setRunEnergy(Math.min(100, player.getRunEnergy() + spent));
                player.getPacketSender().sendRunEnergy();
            },
        })],
        ["resurrect lesser ghost", new ArceuusSelfSpell({ id: 25511, level: 38, experience: 55, runes: [rune(558, 5), rune(556, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, animation: RESURRECT, graphic: GHOST.cast, effect: (p) => ArceuusThralls.summon(p, 10878, 2, 1, 6, GHOST) })],
        ["resurrect superior ghost", new ArceuusSelfSpell({ id: 25506, level: 57, experience: 70, runes: [rune(560, 5), rune(557, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, animation: RESURRECT, graphic: GHOST.cast, effect: (p) => ArceuusThralls.summon(p, 10879, 4, 2, 6, GHOST) })],
        ["resurrect greater ghost", new ArceuusSelfSpell({ id: 25507, level: 76, experience: 88, runes: [rune(565, 5), rune(554, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, animation: RESURRECT, graphic: GHOST.cast, effect: (p) => ArceuusThralls.summon(p, 10880, 6, 3, 6, GHOST) })],
        ["resurrect lesser skeleton", new ArceuusSelfSpell({ id: 25509, level: 38, experience: 55, runes: [rune(558, 5), rune(556, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, animation: RESURRECT, graphic: SKELETON.cast, effect: (p) => ArceuusThralls.summon(p, 10881, 2, 1, 6, SKELETON) })],
        ["resurrect superior skeleton", new ArceuusSelfSpell({ id: 25512, level: 57, experience: 70, runes: [rune(560, 5), rune(557, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, animation: RESURRECT, graphic: SKELETON.cast, effect: (p) => ArceuusThralls.summon(p, 10882, 4, 2, 6, SKELETON) })],
        ["resurrect greater skeleton", new ArceuusSelfSpell({ id: 25510, level: 76, experience: 88, runes: [rune(565, 5), rune(554, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, animation: RESURRECT, graphic: SKELETON.cast, effect: (p) => ArceuusThralls.summon(p, 10883, 6, 3, 6, SKELETON) })],
        ["resurrect lesser zombie", new ArceuusSelfSpell({ id: 25508, level: 38, experience: 55, runes: [rune(558, 5), rune(556, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, animation: RESURRECT, graphic: ZOMBIE.cast, effect: (p) => ArceuusThralls.summon(p, 10884, 2, 1, 1, ZOMBIE) })],
        ["resurrect superior zombie", new ArceuusSelfSpell({ id: 25513, level: 57, experience: 70, runes: [rune(560, 5), rune(557, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, animation: RESURRECT, graphic: ZOMBIE.cast, effect: (p) => ArceuusThralls.summon(p, 10885, 4, 2, 1, ZOMBIE) })],
        ["resurrect greater zombie", new ArceuusSelfSpell({ id: 25514, level: 76, experience: 88, runes: [rune(565, 5), rune(554, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, animation: RESURRECT, graphic: ZOMBIE.cast, effect: (p) => ArceuusThralls.summon(p, 10886, 6, 3, 1, ZOMBIE) })],
    ]);
    private static readonly TELEPORTS = new Map<string, ArceuusTeleportSpell>([
        // Wiki (Arceuus Library Teleport): 9.5 base experience (as its tablet, lectern.json).
        ["arceuus library teleport", teleport(6, 9.5, [rune(557, 2), rune(563)], 1632, 3838)],
        ["draynor manor teleport", teleport(17, 16, [rune(557), rune(555), rune(563)], 3108, 3352)],
        ["battlefront teleport", teleport(23, 19, [rune(557), rune(554), rune(563)], 1348, 3739)],
        ["mind altar teleport", teleport(28, 22, [rune(558), rune(563, 2)], 2980, 3510)],
        ["respawn teleport", teleport(34, 27, [rune(566), rune(563)], GameConstants.DEFAULT_LOCATION.getX(), GameConstants.DEFAULT_LOCATION.getY(), GameConstants.DEFAULT_LOCATION.getZ())],
        ["salve graveyard teleport", teleport(40, 30, [rune(566, 2), rune(563)], 3432, 3461, 0, undefined, PRIEST_IN_PERIL)],
        ["fenkenstrain's castle teleport", teleport(48, 50, [rune(557), rune(566), rune(563)], 3548, 3528, 0, undefined, PRIEST_IN_PERIL)],
        ["west ardougne teleport", teleport(61, 68, [rune(566, 2), rune(563, 2)], 2500, 3291, 0, undefined, { key: "biohazard", name: "Biohazard" })],
        ["harmony island teleport", teleport(65, 74, [rune(566), rune(561), rune(563)], 3797, 2866, 0, undefined, { key: "great_brain_robbery", name: "The Great Brain Robbery" })],
        ["cemetery teleport", teleport(71, 82, [rune(565), rune(566), rune(563)], 2978, 3763)],
        // Wiki (Barrows Teleport): "Completion of the quest Priest in Peril ... is required".
        ["barrows teleport", teleport(83, 90, [rune(566, 2), rune(565), rune(563, 2)], 3565, 3315, 0, undefined, PRIEST_IN_PERIL)],
        // Wiki (Ape Atoll Teleport (Arceuus)): "Completion of the Monkey Madness I quest is required to cast this spell."
        ["ape atoll teleport", teleport(90, 100, [rune(566, 2), rune(565, 2), rune(563, 2)], 2770, 9100, 0, undefined, { key: "monkey_madness_i", name: "Monkey Madness I" })],
    ]);

    public static getTeleportDestinations() {
        return Array.from(this.TELEPORTS, ([name, spell]) => ({ name, ...spell.data }));
    }

    public static handleSpell(player: Player, name: string | undefined): boolean {
        const key = name?.trim().toLowerCase() ?? "";
        if (key === "demonic offering" && !ArceuusOfferings.hasDemonicRemains(player) ||
            key === "sinister offering" && !ArceuusOfferings.hasBones(player)) {
            player.sendMessage("You do not have any suitable remains in your inventory.");
            return true;
        }
        // Guesses: the wording for no herbs, full run energy and no prayer.
        if (key === "degrime" && !ArceuusUtilities.hasGrimyHerbs(player)) {
            player.sendMessage("You don't have any grimy herbs to clean.");
            return true;
        }
        if (key === "vile vigour" && player.getRunEnergy() >= 100) {
            player.sendMessage("You're already at maximum run energy.");
            return true;
        }
        if (key === "vile vigour" && player.getSkillManager().getCurrentLevel(Skill.PRAYER) <= 0) {
            player.sendMessage("You don't have enough prayer points to cast that spell.");
            return true;
        }
        const thrallPrayerCost = key.includes("lesser") ? 2 : key.includes("superior") ? 4 : key.includes("greater") ? 6 : 0;
        if (thrallPrayerCost > 0 && key.startsWith("resurrect ") &&
            (player.getCombat().getTarget()?.isPlayer() || player.getCombat().getAttacker()?.isPlayer())) {
            player.sendMessage("You cannot summon a Thrall during PvP combat.");
            return true;
        }
        if (thrallPrayerCost > 0 && key.startsWith("resurrect ") &&
            (!player.getEquipment().contains(25818) || player.getSkillManager().getCurrentLevel(Skill.PRAYER) < thrallPrayerCost)) {
            player.sendMessage("You need the Book of the dead and enough Prayer points to summon that Thrall.");
            return true;
        }
        const selfSpell = this.SELF_SPELLS.get(key);
        if (selfSpell) return selfSpell.cast(player);
        const spell = this.TELEPORTS.get(key);
        return spell?.cast(player) ?? false;
    }

    public static hasWard(target: any): boolean {
        return Number(target?.getAttribute?.(this.WARD_UNTIL) ?? 0) > World.getProcessCycle();
    }

    public static hasDeathCharge(player: Player): boolean {
        return Number(player.getAttribute(this.DEATH_CHARGE_UNTIL) ?? 0) > World.getProcessCycle();
    }

    public static hasShadowVeil(player: Player): boolean {
        return Number(player.getAttribute(this.SHADOW_VEIL_UNTIL) ?? 0) > World.getProcessCycle();
    }

    public static hasMark(player: Player): boolean {
        return Number(player.getAttribute(this.MARK_UNTIL) ?? 0) > World.getProcessCycle();
    }

    /**
     * Mark of Darkness (Wiki): 3 ticks per base Magic level, x5 with a purging staff; a warning 10
     * ticks before it ends, then its end graphic (cache 1886) and message. A recast restarts it.
     */
    public static placeMark(player: Player): void {
        const magic = player.getSkillManager().getMaxLevel(Skill.MAGIC);
        const purging = [29594, 29595].includes(player.getEquipment().getWeapon()?.getId?.() ?? -1);
        const ticks = magic * 3 * (purging ? 5 : 1);
        player.setAttribute(this.MARK_UNTIL, World.getProcessCycle() + ticks);
        const token = Number(player.getAttribute(this.MARK_TOKEN) ?? 0) + 1;
        player.setAttribute(this.MARK_TOKEN, token);
        let left = ticks;
        TaskManager.submit(new class extends Task {
            // Not keyed to the player, so clearing their tasks (a click) doesn't cancel it.
            constructor() { super(1, false); }
            execute(): void {
                if (!player.isRegistered() || player.getAttribute(ArceuusSpells.MARK_TOKEN) !== token) {
                    this.stop();
                    return;
                }
                left--;
                if (left === 10) player.sendMessage("Your Mark of Darkness is about to run out.");
                if (left > 0) return;
                player.performGraphic(new Graphic(1886));
                player.sendMessage("Your Mark of Darkness has faded away.");
                this.stop();
            }
        });
    }

    /** The next successful hit may corrupt; whether the Mark was up is fixed at casting (Wiki). */
    private static primeCorruption(player: Player, total: number): void {
        player.setAttribute(this.CORRUPTION, total);
        player.setAttribute(this.CORRUPTION_MARKED, this.hasMark(player));
    }

    /** A message with live's `@mes_hl_*@` highlight, coloured for the player's chatbox background. */
    private static sendHighlighted(player: Player, message: string): void {
        const varbit = CacheDefinitions.getVarbitId("chatbox_transparency");
        player.sendMessage(resolveChatHighlights(message, varbit != null && player.getPacketSender().getVarbit(varbit) === 1));
    }

    private static sendDeathChargeVarbit(player: Player, name: string, value: number): void {
        const id = CacheDefinitions.getVarbitId(name);
        if (id != null) player.getPacketSender().sendVarbit(id, value);
    }

    /**
     * The cast: the spellbook's cooldown and active varbits go up with the message, and 100 ticks
     * later the cooldown ends and an unused charge fades with its message and sound (recording 4102).
     */
    public static startDeathCharge(player: Player): void {
        player.setAttribute(this.DEATH_CHARGE_UNTIL, World.getProcessCycle() + DEATH_CHARGE_TICKS);
        const token = Number(player.getAttribute(this.DEATH_CHARGE_TOKEN) ?? 0) + 1;
        player.setAttribute(this.DEATH_CHARGE_TOKEN, token);
        this.sendDeathChargeVarbit(player, DEATH_CHARGE_COOLDOWN_VARBIT, 1);
        this.sendDeathChargeVarbit(player, DEATH_CHARGE_ACTIVE_VARBIT, 1);
        this.sendHighlighted(player, DEATH_CHARGE_CAST);
        player.getPacketSender().sendSoundEffect(DEATH_CHARGE_CAST_SOUND, 1, 0, 255);
        TaskManager.submit(new class extends Task {
            // Not keyed to the player, so clearing their tasks (a click) doesn't cancel it.
            constructor() { super(DEATH_CHARGE_TICKS, false); }
            execute(): void {
                this.stop();
                if (!player.isRegistered() || player.getAttribute(ArceuusSpells.DEATH_CHARGE_TOKEN) !== token) return;
                ArceuusSpells.sendDeathChargeVarbit(player, DEATH_CHARGE_COOLDOWN_VARBIT, 0);
                if (player.getAttribute(ArceuusSpells.DEATH_CHARGE_UNTIL) == null) return; // spent on a kill
                player.setAttribute(ArceuusSpells.DEATH_CHARGE_UNTIL, null);
                ArceuusSpells.sendDeathChargeVarbit(player, DEATH_CHARGE_ACTIVE_VARBIT, 0);
                ArceuusSpells.sendHighlighted(player, DEATH_CHARGE_FADED);
                player.getPacketSender().sendSoundEffect(DEATH_CHARGE_FADE_SOUND, 1, 0, 255);
            }
        });
    }

    /**
     * A kill uses the charge up (Wiki: restores energy once per cast, and only when the killed
     * creature is within 16 tiles; a full bar still spends it), with its end graphic (cache 1855),
     * the varbit going down and the restored message (recording 3340).
     */
    public static useDeathCharge(player: Player, killed?: { getLocation(): Location; size?(): number }): boolean {
        if (!this.hasDeathCharge(player)) return false;
        if (killed && CombatRange.footprintDistance(killed.getLocation(), killed.size?.() ?? 1, player.getLocation()) > DEATH_CHARGE_RANGE) {
            return false;
        }
        if (player.getCombat().ticksSinceAttackedByPlayer() <= DEATH_CHARGE_PVP_TICKS) return false;
        player.setAttribute(this.DEATH_CHARGE_UNTIL, null);
        this.sendDeathChargeVarbit(player, DEATH_CHARGE_ACTIVE_VARBIT, 0);
        player.performGraphic(new Graphic(1855));
        this.sendHighlighted(player, DEATH_CHARGE_RESTORED);
        return true;
    }

    public static applyCorruption(caster: Player, target: Player): void {
        const total = Number(caster.getAttribute(this.CORRUPTION) ?? 0);
        const validTarget = () => target.isRegistered() && target.getHitpoints() > 0 && !ArceuusSpells.hasWard(target);
        if (total <= 0 || !validTarget()) return;
        const marked = caster.getAttribute(this.CORRUPTION_MARKED) === true;
        caster.setAttribute(this.CORRUPTION, null);
        caster.setAttribute(this.CORRUPTION_MARKED, null);
        // Wiki: 50%, certain with the Mark; drains every 10 ticks, every 5 with it.
        if (!marked && Math.random() >= 0.5) return;
        target.performGraphic(new Graphic(total === 6 ? 1879 : 1880));
        const drains = total === 6 ? [1, 2, 3] : [2, 4, 6];
        let index = 0;
        const delay = marked ? 5 : 10;
        TaskManager.submit(new class extends Task {
            constructor() { super(delay); }
            onTick(): void {
                // Death/departure can end before the next 5/10-tick drain.
                // Observe the target each tick so respawn cannot revive this effect.
                if (this.isRunning() && !validTarget()) this.stop();
            }
            execute(): void {
                if (!validTarget() || index >= drains.length) {
                    this.stop();
                    return;
                }
                target.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, drains[index++], 0);
                if (index >= drains.length) this.stop();
            }
        });
    }
}
