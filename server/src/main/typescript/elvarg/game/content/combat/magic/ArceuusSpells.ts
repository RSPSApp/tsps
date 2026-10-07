import { Player } from "../../../entity/impl/player/Player";
import { GameConstants } from "../../../GameConstants";
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

type TeleportSpell = {
    level: number;
    experience: number;
    runes: Item[];
    destination: Location;
    cooldown?: { attribute: string; duration: number };
};

type SelfSpell = {
    id: number; level: number; experience: number; runes: Item[]; effect: (player: Player) => void;
    cooldown?: { attribute: string; duration: number; message?: string };
    castDelay?: boolean;
    /** The cast's animation and graphic (cache ids), and the message it sends. */
    animation?: number; graphic?: number; message?: string;
    /** Why the spell can't be cast now (a message), checked before runes are taken. */
    blocked?: (player: Player) => string | null;
};

/** A tick in milliseconds, for durations the Wiki gives in ticks. */
const TICK_MS = 600;
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
        if (cooldown && Number(player.getAttribute(cooldown.attribute) ?? 0) > Date.now()) {
            if (cooldown.message) player.sendMessage(cooldown.message);
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
        if (!TeleportHandler.checkReqs(player, this.data.destination) || !this.canCast(player, false)) {
            return true;
        }
        if (!this.canCast(player, true)) {
            return true;
        }
        player.getSkillManager().addExperiences(Skill.MAGIC, this.data.experience);
        TeleportHandler.teleport(player, this.data.destination, TeleportType.ARCEUUS, false);
        return true;
    }
}

const rune = (id: number, amount = 1) => new Item(id, amount);
const teleport = (level: number, experience: number, runes: Item[], x: number, y: number, z = 0, cooldown?: TeleportSpell["cooldown"]) =>
    new ArceuusTeleportSpell({ level, experience, runes, destination: new Location(x, y, z), cooldown });
const THRALL_COOLDOWN = { attribute: "arceuus:thrall-until", duration: 30_000 };

/** Self-cast Arceuus spells. Targeted spells remain in their respective packet handlers. */
export class ArceuusSpells {
    public static readonly WARD_UNTIL = "arceuus:ward-until";
    public static readonly DEATH_CHARGE_UNTIL = "arceuus:death-charge-until";
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
            effect: (player) => player.setAttribute(this.WARD_UNTIL, Date.now() + player.getSkillManager().getCurrentLevel(Skill.MAGIC) * TICK_MS),
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
            blocked: (player) => player.getSkillManager().getMaxLevel(Skill.PRAYER) < 70 ? "You require a Prayer level of 70 to do that." : null,
            effect: (player) => ArceuusOfferings.sinister(player),
        })],
        // Wiki: a minute to make one kill, once every 60 seconds.
        ["death charge", new ArceuusSelfSpell({
            id: 15309, level: 80, experience: 90, runes: [rune(560), rune(565), rune(566)],
            animation: SELF_IMBUE, graphic: 1854,
            cooldown: { attribute: "arceuus:death-charge-cooldown", duration: 60_000, message: "You can only cast Death Charge every 60 seconds." },
            effect: (player) => player.setAttribute(this.DEATH_CHARGE_UNTIL, Date.now() + 60_000),
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
            effect: (player) => player.setAttribute(this.SHADOW_VEIL_UNTIL, Date.now() + player.getSkillManager().getMaxLevel(Skill.MAGIC) * TICK_MS),
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
        ["resurrect lesser ghost", new ArceuusSelfSpell({ id: 25511, level: 38, experience: 55, runes: [rune(558, 5), rune(556, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, effect: (p) => ArceuusThralls.summon(p, 10878, 2, 1, 6) })],
        ["resurrect superior ghost", new ArceuusSelfSpell({ id: 25506, level: 57, experience: 70, runes: [rune(560, 5), rune(557, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, effect: (p) => ArceuusThralls.summon(p, 10879, 4, 2, 6) })],
        ["resurrect greater ghost", new ArceuusSelfSpell({ id: 25507, level: 76, experience: 88, runes: [rune(565, 5), rune(554, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, effect: (p) => ArceuusThralls.summon(p, 10880, 6, 3, 6) })],
        ["resurrect lesser skeleton", new ArceuusSelfSpell({ id: 25509, level: 38, experience: 55, runes: [rune(558, 5), rune(556, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, effect: (p) => ArceuusThralls.summon(p, 10881, 2, 1, 6) })],
        ["resurrect superior skeleton", new ArceuusSelfSpell({ id: 25512, level: 57, experience: 70, runes: [rune(560, 5), rune(557, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, effect: (p) => ArceuusThralls.summon(p, 10882, 4, 2, 6) })],
        ["resurrect greater skeleton", new ArceuusSelfSpell({ id: 25510, level: 76, experience: 88, runes: [rune(565, 5), rune(554, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, effect: (p) => ArceuusThralls.summon(p, 10883, 6, 3, 6) })],
        ["resurrect lesser zombie", new ArceuusSelfSpell({ id: 25508, level: 38, experience: 55, runes: [rune(558, 5), rune(556, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, effect: (p) => ArceuusThralls.summon(p, 10884, 2, 1, 1) })],
        ["resurrect superior zombie", new ArceuusSelfSpell({ id: 25513, level: 57, experience: 70, runes: [rune(560, 5), rune(557, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, effect: (p) => ArceuusThralls.summon(p, 10885, 4, 2, 1) })],
        ["resurrect greater zombie", new ArceuusSelfSpell({ id: 25514, level: 76, experience: 88, runes: [rune(565, 5), rune(554, 10), rune(564)], cooldown: THRALL_COOLDOWN, castDelay: true, effect: (p) => ArceuusThralls.summon(p, 10886, 6, 3, 1) })],
    ]);
    private static readonly TELEPORTS = new Map<string, ArceuusTeleportSpell>([
        ["arceuus library teleport", teleport(6, 9, [rune(557, 2), rune(563)], 1632, 3838)],
        ["draynor manor teleport", teleport(17, 16, [rune(557), rune(555), rune(563)], 3108, 3352)],
        ["battlefront teleport", teleport(23, 19, [rune(557), rune(554), rune(563)], 1348, 3739)],
        ["mind altar teleport", teleport(28, 22, [rune(558), rune(563, 2)], 2980, 3510)],
        ["respawn teleport", teleport(34, 27, [rune(4695), rune(563)], GameConstants.DEFAULT_LOCATION.getX(), GameConstants.DEFAULT_LOCATION.getY(), GameConstants.DEFAULT_LOCATION.getZ())],
        ["salve graveyard teleport", teleport(40, 30, [rune(566, 2), rune(563)], 3432, 3461)],
        ["fenkenstrain's castle teleport", teleport(48, 50, [rune(557), rune(4695), rune(563)], 3548, 3528)],
        ["west ardougne teleport", teleport(61, 68, [rune(4695, 2), rune(563, 2)], 2500, 3291)],
        ["harmony island teleport", teleport(65, 74, [rune(4695), rune(561), rune(563)], 3797, 2866)],
        ["cemetery teleport", teleport(71, 82, [rune(565), rune(4695), rune(563)], 2978, 3763)],
        ["barrows teleport", teleport(83, 90, [rune(4695, 2), rune(565), rune(563, 2)], 3565, 3315)],
        ["ape atoll teleport", teleport(90, 100, [rune(4695, 2), rune(565, 2), rune(563, 2)], 2770, 9100)],
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
        return Number(target?.getAttribute?.(this.WARD_UNTIL) ?? 0) > Date.now();
    }

    public static hasDeathCharge(player: Player): boolean {
        return Number(player.getAttribute(this.DEATH_CHARGE_UNTIL) ?? 0) > Date.now();
    }

    public static hasShadowVeil(player: Player): boolean {
        return Number(player.getAttribute(this.SHADOW_VEIL_UNTIL) ?? 0) > Date.now();
    }

    public static hasMark(player: Player): boolean {
        return Number(player.getAttribute(this.MARK_UNTIL) ?? 0) > Date.now();
    }

    /**
     * Mark of Darkness (Wiki): 3 ticks per base Magic level, x5 with a purging staff; a warning 10
     * ticks before it ends, then its end graphic (cache 1886) and message. A recast restarts it.
     */
    public static placeMark(player: Player): void {
        const magic = player.getSkillManager().getMaxLevel(Skill.MAGIC);
        const purging = [29594, 29595].includes(player.getEquipment().getWeapon()?.getId?.() ?? -1);
        const ticks = magic * 3 * (purging ? 5 : 1);
        player.setAttribute(this.MARK_UNTIL, Date.now() + ticks * TICK_MS);
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

    /** Death Charge restores energy once per cast (Wiki), with its end graphic (cache 1855). */
    public static useDeathCharge(player: Player): boolean {
        if (!this.hasDeathCharge(player)) return false;
        player.setAttribute(this.DEATH_CHARGE_UNTIL, null);
        player.performGraphic(new Graphic(1855));
        return true;
    }

    public static applyCorruption(caster: Player, target: Player): void {
        const total = Number(caster.getAttribute(this.CORRUPTION) ?? 0);
        if (total <= 0 || this.hasWard(target)) return;
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
            execute(): void {
                if (!target.isRegistered() || ArceuusSpells.hasWard(target) || index >= drains.length) {
                    this.stop();
                    return;
                }
                target.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, drains[index++], 0);
                if (index >= drains.length) this.stop();
            }
        });
    }
}
