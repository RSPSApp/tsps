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

type TeleportSpell = {
    level: number;
    experience: number;
    runes: Item[];
    destination: Location;
    cooldown?: { attribute: string; duration: number };
};

type SelfSpell = {
    id: number; level: number; experience: number; runes: Item[]; effect: (player: Player) => void;
    cooldown?: { attribute: string; duration: number };
    castDelay?: boolean;
};

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
        if (!this.canCast(player, false) || !this.canCast(player, true)) return true;
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
    private static readonly SELF_SPELLS = new Map<string, ArceuusSelfSpell>([
        ["ward of arceuus", new ArceuusSelfSpell({
            id: 20763, level: 73, experience: 83, runes: [rune(566, 4), rune(561, 2), rune(564)],
            effect: (player) => player.setAttribute(this.WARD_UNTIL, Date.now() + player.getSkillManager().getCurrentLevel(Skill.MAGIC) * 600),
        })],
        ["mark of darkness", new ArceuusSelfSpell({
            id: 20392, level: 59, experience: 70, runes: [rune(566), rune(564)],
            effect: (player) => player.setAttribute(this.MARK_UNTIL, Date.now() + player.getSkillManager().getCurrentLevel(Skill.MAGIC) * 600),
        })],
        ["lesser corruption", new ArceuusSelfSpell({
            id: 10511, level: 64, experience: 75, runes: [rune(560), rune(566, 2)],
            effect: (player) => player.setAttribute(this.CORRUPTION, 6),
        })],
        ["greater corruption", new ArceuusSelfSpell({
            id: 20762, level: 85, experience: 95, runes: [rune(565), rune(566, 3)],
            effect: (player) => player.setAttribute(this.CORRUPTION, 12),
        })],
        ["demonic offering", new ArceuusSelfSpell({
            id: 15346, level: 84, experience: 175, runes: [rune(566), rune(21880)],
            cooldown: { attribute: "arceuus:offering-until", duration: 5_400 },
            effect: (player) => ArceuusOfferings.demonic(player),
        })],
        ["sinister offering", new ArceuusSelfSpell({
            id: 8796, level: 92, experience: 180, runes: [rune(565), rune(21880)],
            cooldown: { attribute: "arceuus:offering-until", duration: 5_400 },
            effect: (player) => ArceuusOfferings.sinister(player),
        })],
        ["death charge", new ArceuusSelfSpell({
            id: 15309, level: 80, experience: 90, runes: [rune(560), rune(565), rune(566)],
            effect: (player) => player.setAttribute(this.DEATH_CHARGE_UNTIL, Date.now() + 60_000),
        })],
        ["degrime", new ArceuusSelfSpell({
            id: 15345, level: 70, experience: 83, runes: [rune(557, 4), rune(561, 2)],
            effect: (player) => ArceuusUtilities.degrime(player),
        })],
        ["shadow veil", new ArceuusSelfSpell({
            id: 15344, level: 47, experience: 58, runes: [rune(557, 5), rune(554, 5), rune(564, 5)],
            effect: (player) => player.setAttribute(this.SHADOW_VEIL_UNTIL, Date.now() + player.getSkillManager().getMaxLevel(Skill.MAGIC) * 600),
        })],
        ["vile vigour", new ArceuusSelfSpell({
            id: 15304, level: 66, experience: 76, runes: [rune(566), rune(556, 3)],
            effect: (player) => {
                const prayer = player.getSkillManager().getCurrentLevel(Skill.PRAYER);
                player.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, prayer, 0);
                player.setRunEnergy(Math.min(100, player.getRunEnergy() + prayer));
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
        ["arceuus home teleport", teleport(1, 0, [], 1712, 3882, 0, { attribute: "magic:home-teleport-until", duration: 1_800_000 })],
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
            key === "sinister offering" && !ArceuusOfferings.hasBones(player) ||
            key === "degrime" && !ArceuusUtilities.hasGrimyHerbs(player) ||
            key === "vile vigour" && (player.getRunEnergy() >= 100 || player.getSkillManager().getCurrentLevel(Skill.PRAYER) <= 0)) {
            player.sendMessage("You do not have any suitable remains in your inventory.");
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

    public static applyCorruption(caster: Player, target: Player): void {
        const total = Number(caster.getAttribute(this.CORRUPTION) ?? 0);
        if (total <= 0 || this.hasWard(target)) return;
        caster.setAttribute(this.CORRUPTION, null);
        if (Math.random() >= 0.5) return;
        const drains = total === 6 ? [1, 2, 3] : [2, 4, 6];
        let index = 0;
        const delay = this.hasMark(caster) ? 5 : 10;
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
