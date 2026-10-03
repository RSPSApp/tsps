import { World } from "../../../World";
import { Player } from "../../../entity/impl/player/Player";
import { Animation } from "../../../model/Animation";
import { Graphic } from "../../../model/Graphic";
import { GraphicHeight } from "../../../model/GraphicHeight";
import { Item } from "../../../model/Item";
import { Location } from "../../../model/Location";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { EffectTimer } from "../../../model/EffectTimer";
import { Skill } from "../../../model/Skill";
import { TeleportHandler } from "../../../model/teleportation/TeleportHandler";
import { TeleportType } from "../../../model/teleportation/TeleportType";
import { Spell } from "./Spell";
import { EffectSpells } from "./EffectSpells";
import { DialogueChainBuilder } from "../../../model/dialogues/builders/DialogueChainBuilder";
import { OptionDialogue } from "../../../model/dialogues/entries/impl/OptionDialogue";
import { DialogueOption } from "../../../model/dialogues/DialogueOption";
import { PluginManager } from "../../../../plugins/PluginManager";

type SpellData = { level: number; experience: number; runes: Item[] };
type TeleportData = SpellData & { destination: Location };

const rune = (id: number, amount = 1) => new Item(id, amount);

class LunarSpell extends Spell {
    constructor(readonly data: SpellData) { super(); }
    spellId(): number { return 0; }
    levelRequired(): number { return this.data.level; }
    baseExperience(): number { return this.data.experience; }
    itemsRequired(): Item[] { return this.data.runes; }
    equipmentRequired(): Item[] { return []; }
    startCast(): void { }
    getSpellbook(): MagicSpellbook { return MagicSpellbook.LUNAR; }
    cast(player: Player, effect: () => void): boolean {
        if (player.getSkillManager().getMaxLevel(Skill.DEFENCE) < 40) {
            player.sendMessage("You need at least level 40 Defence to cast Lunar spells.");
            return true;
        }
        if (!this.canCast(player, false) || !this.canCast(player, true)) return true;
        player.performAnimation(new Animation(4413));
        player.performGraphic(new Graphic(747));
        effect();
        player.getSkillManager().addExperiences(Skill.MAGIC, this.data.experience);
        return true;
    }
}

class LunarTeleport extends LunarSpell {
    constructor(readonly teleport: TeleportData) { super(teleport); }
    castTeleport(player: Player): boolean {
        if (!TeleportHandler.checkReqs(player, this.teleport.destination)) return true;
        return this.cast(player, () => TeleportHandler.teleport(player, this.teleport.destination, TeleportType.LUNAR, false));
    }
}

const teleport = (level: number, experience: number, runes: Item[], x: number, y: number, z = 0) =>
    new LunarTeleport({ level, experience, runes, destination: new Location(x, y, z) });

/** Lunar spells that can be fulfilled by the current server primitives. */
export class LunarSpells {
    private static readonly SELF = new Map<string, LunarSpell>([
        ["cure me", new LunarSpell({ level: 71, experience: 69, runes: [rune(9075, 2), rune(564, 2), rune(563)] })],
        ["cure group", new LunarSpell({ level: 74, experience: 74, runes: [rune(9075, 2), rune(564, 2), rune(563, 2)] })],
        ["vengeance", new LunarSpell({ level: 94, experience: 112, runes: [rune(9075, 4), rune(557, 10), rune(560, 2)] })],
        ["dream", new LunarSpell({ level: 79, experience: 82, runes: [rune(9075, 2), rune(556, 5), rune(563)] })],
        ["heal group", new LunarSpell({ level: 95, experience: 124, runes: [rune(9075, 4), rune(557, 15), rune(565, 3)] })],
        ["spellbook swap", new LunarSpell({ level: 96, experience: 130, runes: [rune(9075, 3), rune(563, 2), rune(560)] })],
    ]);

    private static readonly TELEPORTS = new Map<string, LunarTeleport>([
        ["lunar home teleport", teleport(0, 0, [], 2113, 3917)],
        ["moonclan teleport", teleport(69, 66, [rune(9075, 2), rune(557, 2), rune(563)], 2113, 3917)],
        ["ourania teleport", teleport(71, 69, [rune(9075, 6), rune(557, 2), rune(563)], 2468, 3248)],
        ["waterbirth teleport", teleport(72, 71, [rune(9075), rune(555, 2), rune(563)], 2548, 3758)],
        ["barbarian teleport", teleport(75, 76, [rune(9075, 2), rune(557, 3), rune(563, 2)], 2544, 3569)],
        ["khazard teleport", teleport(78, 80, [rune(9075, 2), rune(557, 4), rune(563, 2)], 2637, 3166)],
        ["fishing guild teleport", teleport(85, 89, [rune(9075, 3), rune(557, 10), rune(563, 3)], 2611, 3390)],
        ["catherby teleport", teleport(87, 92, [rune(9075, 3), rune(557, 10), rune(563, 3)], 2804, 3434)],
        ["ice plateau teleport", teleport(89, 96, [rune(9075, 3), rune(557, 8), rune(563, 3)], 2974, 3873)],
    ]);

    private static readonly GROUP_TELEPORTS = new Map<string, LunarTeleport>([
        ["tele group moonclan", teleport(70, 67, [rune(9075, 4), rune(557, 2), rune(563)], 2113, 3917)],
        ["tele group waterbirth", teleport(73, 72, [rune(9075, 5), rune(555, 2), rune(563)], 2548, 3758)],
        ["tele group barbarian", teleport(76, 77, [rune(9075, 6), rune(554, 2), rune(563, 2)], 2544, 3569)],
        ["tele group khazard", teleport(79, 81, [rune(9075, 8), rune(555, 2), rune(563, 2)], 2637, 3166)],
        ["tele group fishing guild", teleport(86, 90, [rune(9075, 14), rune(555, 3), rune(563, 3)], 2611, 3390)],
        ["tele group catherby", teleport(88, 93, [rune(9075, 15), rune(555, 3), rune(563, 3)], 2804, 3434)],
        ["tele group ice plateau", teleport(90, 99, [rune(9075, 16), rune(555, 3), rune(563, 3)], 2974, 3873)],
    ]);

    public static getTeleportDestinations() {
        return Array.from(this.TELEPORTS, ([name, spell]) => ({ name, ...spell.teleport }));
    }

    public static handleSelf(player: Player, name: string | undefined): boolean {
        const key = name?.trim().toLowerCase() ?? "";
        const teleport = this.TELEPORTS.get(key);
        if (teleport) return teleport.castTeleport(player);
        const groupTeleport = this.GROUP_TELEPORTS.get(key);
        if (groupTeleport) return this.castGroupTeleport(player, groupTeleport);
        if (this.handleUtility(player, key)) return true;
        const spell = this.SELF.get(key);
        if (!spell) return false;
        if (key === "cure me") {
            return spell.cast(player, () => this.curePoison(player));
        }
        if (key === "cure group") {
            return spell.cast(player, () => this.forNearbyPlayers(player, target => this.curePoison(target)));
        }
        if (key === "dream") return spell.cast(player, () => {
            for (const skill of Skill.values()) {
                const current = player.getSkillManager().getCurrentLevel(skill);
                const maximum = player.getSkillManager().getMaxLevel(skill);
                if (current < maximum) player.getSkillManager().setCurrentLevels(skill, maximum);
            }
            player.sendMessage("You feel completely refreshed.");
        });
        if (key === "heal group") return spell.cast(player, () => {
            const transferred = Math.floor(player.getHitpoints() * 0.75);
            player.setHitpoints(Math.max(1, player.getHitpoints() - transferred));
            this.forNearbyPlayers(player, target => target.heal(Math.floor(transferred / 2)));
        });
        if (key === "spellbook swap") return spell.cast(player, () => this.openSpellbookSwap(player));
        if (key === "vengeance") return EffectSpells.handleSpell(player, EffectSpells.VENGEANCE.spellId());
        return false;
    }

    private static castGroupTeleport(player: Player, spell: LunarTeleport): boolean {
        if (!TeleportHandler.checkReqs(player, spell.teleport.destination)) return true;
        return spell.cast(player, () => {
            TeleportHandler.teleport(player, spell.teleport.destination, TeleportType.LUNAR, false);
            this.forNearbyPlayers(player, target => {
                if (target !== player && this.acceptsAid(target) && TeleportHandler.checkReqs(target, spell.teleport.destination)) {
                    TeleportHandler.teleport(target, spell.teleport.destination, TeleportType.LUNAR, false);
                }
            });
        });
    }

    private static handleUtility(player: Player, key: string): boolean {
        const definitions: Record<string, SpellData> = {
            "bake pie": { level: 65, experience: 60, runes: [rune(9075), rune(554, 5), rune(555, 4)] },
            "humidify": { level: 68, experience: 65, runes: [rune(9075), rune(555, 3), rune(563)] },
            "hunter kit": { level: 71, experience: 70, runes: [rune(9075, 2), rune(554, 2), rune(563)] },
            "spin flax": { level: 76, experience: 75, runes: [rune(9075, 2), rune(555, 5), rune(563)] },
            "superglass make": { level: 77, experience: 78, runes: [rune(9075, 2), rune(556, 6), rune(563)] },
            "tan leather": { level: 78, experience: 81, runes: [rune(9075, 2), rune(561, 5), rune(563)] },
            "plank make": { level: 86, experience: 90, runes: [rune(9075, 2), rune(557, 15), rune(561)] },
            "magic imbue": { level: 82, experience: 86, runes: [rune(9075, 2), rune(554, 7), rune(556, 7)] },
            "npc contact": { level: 67, experience: 63, runes: [rune(9075, 2), rune(564), rune(563)] },
        };
        const data = definitions[key];
        if (!data) return false;
        if (key === "npc contact") return new LunarSpell(data).cast(player, () => this.openNpcContact(player));
        const inventory = player.getInventory();
        const items = inventory.getValidItems();
        const has = (ids: readonly number[]) => items.some(item => ids.includes(item.getId()));
        const pies = new Map<number, [number, number]>([
            [2317, [2323, 30]], [2319, [2327, 20]], [2321, [2325, 10]],
            [7168, [7170, 29]], [7176, [7178, 40]], [7186, [7188, 60]],
            [7196, [7198, 175]], [7206, [7208, 240]], [7216, [7218, 260]],
        ]);
        if (key === "bake pie" && !items.some(item => pies.has(item.getId()))) {
            player.sendMessage("You do not have any uncooked pies to bake.");
            return true;
        }
        const waterContainers = new Map<number, number>([
            [1925, 1929], [1923, 1921], [1935, 1937], [229, 227], [6667, 6669],
            [1825, 1823], [1827, 1823], [1829, 1823], [1831, 1823], [5331, 5340],
        ]);
        if (key === "humidify") PluginManager.emitCustomEvent("magic:water-containers", { player, containers: waterContainers });
        if (key === "humidify" && !items.some(item => waterContainers.has(item.getId()))) {
            player.sendMessage("You do not have any containers that can be filled with water.");
            return true;
        }
        if (key === "hunter kit" && inventory.getFreeSlots() < 5) {
            player.sendMessage("You need at least five free inventory spaces to cast Hunter Kit.");
            return true;
        }
        if (key === "spin flax" && !has([1779])) {
            player.sendMessage("You do not have any flax to spin.");
            return true;
        }
        if (key === "superglass make" && (!inventory.contains(1783) || !inventory.contains(1781))) {
            player.sendMessage("You need both bucket of sand and soda ash to make glass.");
            return true;
        }
        const hides = [1753, 1751, 1749, 1747];
        if (key === "tan leather" && !has(hides)) {
            player.sendMessage("You do not have any dragonhide to tan.");
            return true;
        }
        const planks = new Map([[1511, [960, 350]], [1521, [8778, 1050]], [6333, [8780, 350]], [6332, [8782, 1050]]]);
        if (key === "plank make" && !items.some(item => planks.has(item.getId()))) {
            player.sendMessage("You do not have any logs to turn into planks.");
            return true;
        }
        const spell = new LunarSpell(data);
        return spell.cast(player, () => {
            if (key === "bake pie") {
                let cookingExperience = 0;
                for (const item of inventory.getValidItems()) {
                    const pie = pies.get(item.getId());
                    if (!pie) continue;
                    item.setId(pie[0]);
                    cookingExperience += pie[1] * item.getAmount();
                }
                if (cookingExperience > 0) player.getSkillManager().addExperiences(Skill.COOKING, cookingExperience);
            } else if (key === "humidify") {
                for (const item of inventory.getValidItems()) {
                    const filled = waterContainers.get(item.getId());
                    if (filled) item.setId(filled);
                }
                PluginManager.emitCustomEvent("magic:humidified", { player });
            } else if (key === "hunter kit") {
                inventory.adds(946, 1).adds(303, 1).adds(954, 2).adds(10029, 1).adds(10008, 1);
            } else if (key === "magic imbue") {
                player.setAttribute("lunar:magic-imbue-until", Date.now() + 12 * 60_000);
            } else if (key === "spin flax") {
                for (const item of inventory.getValidItems()) if (item.getId() === 1779) item.setId(1777);
            } else if (key === "superglass make") {
                const amount = Math.min(inventory.getAmount(1783), inventory.getAmount(1781));
                inventory.deleteNumber(1783, amount).deleteNumber(1781, amount).adds(1775, amount);
            } else if (key === "tan leather") {
                const leather = new Map([[1753, 1745], [1751, 2505], [1749, 2507], [1747, 2509]]);
                for (const item of inventory.getValidItems()) {
                    const result = leather.get(item.getId());
                    if (result) item.setId(result);
                }
            } else {
                for (const item of [...inventory.getValidItems()]) {
                    const plank = planks.get(item.getId());
                    if (!plank || inventory.getAmount(995) < plank[1]) continue;
                    inventory.deleteNumber(995, plank[1]);
                    item.setId(plank[0]);
                }
            }
            inventory.refreshItems();
        });
    }

    public static handlePlayerTarget(player: Player, target: Player, name: string | undefined): boolean {
        const key = name?.trim().toLowerCase() ?? "";
        const definitions: Record<string, SpellData> = {
            "cure other": { level: 68, experience: 65, runes: [rune(9075), rune(557, 10), rune(563)] },
            "energy transfer": { level: 91, experience: 100, runes: [rune(9075, 3), rune(557, 2), rune(563)] },
            "heal other": { level: 92, experience: 101, runes: [rune(9075, 3), rune(557), rune(565, 3)] },
            "vengeance other": { level: 93, experience: 108, runes: [rune(9075, 3), rune(557, 10), rune(560, 2)] },
            "stat spy": { level: 75, experience: 76, runes: [rune(9075, 2), rune(557, 5), rune(563)] },
            "stat restore pot share": { level: 81, experience: 84, runes: [rune(9075, 2), rune(555, 10), rune(561, 2)] },
            "boost potion share": { level: 84, experience: 88, runes: [rune(9075, 3), rune(555, 12), rune(557, 10)] },
        };
        const data = definitions[key];
        if (!data || target === player || !this.acceptsAid(target) || !player.getLocation().isWithinDistance(target.getLocation(), 10)) return false;
        const spell = new LunarSpell(data);
        if (key === "cure other") return spell.cast(player, () => this.curePoison(target));
        if (key === "energy transfer") {
            if (player.getSpecialPercentage() < 100) {
                player.sendMessage("You need a full special attack bar to cast Energy Transfer.");
                return true;
            }
            return spell.cast(player, () => {
                target.setSpecialPercentage(100);
                player.setSpecialPercentage(0);
                target.setRunEnergy(Math.min(100, target.getRunEnergy() + Math.floor(player.getRunEnergy() * 0.5)));
                player.setRunEnergy(0);
                target.getPacketSender().updateSpecialAttackOrb().sendRunEnergy();
                player.getPacketSender().updateSpecialAttackOrb().sendRunEnergy();
            });
        }
        if (key === "heal other") return spell.cast(player, () => {
            const transferred = Math.floor(player.getHitpoints() * 0.75);
            player.setHitpoints(Math.max(1, player.getHitpoints() - transferred));
            target.heal(transferred);
        });
        if (key === "stat spy") return spell.cast(player, () => {
            const stats = Skill.values().map(skill => `${skill.getName()}: ${target.getSkillManager().getCurrentLevel(skill)}`).join(", ");
            player.sendMessage(stats);
        });
        if (key === "stat restore pot share" || key === "boost potion share") {
            return spell.cast(player, () => {
                player.setAttribute("lunar:potion-share", { target, type: key === "stat restore pot share" ? "restore" : "boost", expiresAt: Date.now() + 30_000 });
                player.sendMessage("Drink a matching potion within 30 seconds to share its effect.");
            });
        }
        if (target.hasVengeanceReturn() || !target.getVengeanceTimer().finished()) {
            player.sendMessage("That player cannot receive Vengeance right now.");
            return true;
        }
        return spell.cast(player, () => {
            target.setHasVengeance(true);
            target.getVengeanceTimer().start(30);
            target.performAnimation(new Animation(4411));
            target.performGraphic(new Graphic(725, GraphicHeight.HIGH));
            target.getPacketSender().sendEffectTimer(30, EffectTimer.VENGEANCE)
                .sendMessage("You now have Vengeance's effect.");
        });
    }

    public static handleNpcTarget(player: Player, target: any, name: string | undefined): boolean {
        if (name?.trim().toLowerCase() !== "monster examine" || !target ||
            !player.getLocation().isWithinDistance(target.getLocation(), 10)) return false;
        const spell = new LunarSpell({ level: 66, experience: 61, runes: [rune(9075), rune(564), rune(558)] });
        return spell.cast(player, () => {
            const definition = target.getCurrentDefinition?.();
            const name = definition?.getName?.() ?? "This creature";
            const level = definition?.getCombatLevel?.() ?? 0;
            const hitpoints = target.getHitpoints?.() ?? 0;
            player.sendMessage(`${name}: combat level ${level}, ${hitpoints} hitpoints remaining.`);
        });
    }

    public static handleItemTarget(player: Player, itemId: number, slot: number, name: string | undefined): boolean {
        const key = name?.trim().toLowerCase() ?? "";
        const definitions: Record<string, SpellData> = {
            "string jewellery": { level: 80, experience: 83, runes: [rune(9075, 2), rune(556, 5), rune(563)] },
            "recharge dragonstone": { level: 89, experience: 97.5, runes: [rune(9075, 4), rune(557, 10), rune(563, 4)] },
        };
        const data = definitions[key];
        const item = player.getInventory().getItems()[slot];
        if (!data || !item || item.getId() !== itemId) return false;
        if (key === "string jewellery") {
            const unstrung = new Map<number, number>([[1635, 1656], [1637, 1658], [1639, 1660], [1641, 1662], [6571, 6573]]);
            const result = unstrung.get(itemId);
            if (!result) {
                player.sendMessage("This spell can only be cast on an unstrung amulet.");
                return true;
            }
            return new LunarSpell(data).cast(player, () => { item.setId(result); player.getInventory().refreshItems(); });
        }
        const charged = new Map<number, number>([
            [1712, 1710], [1710, 1708], [1708, 1706], [1706, 1704],
            [2552, 2554], [2554, 2556], [2556, 2558], [2558, 2560],
            [11118, 11120], [11120, 11122], [11122, 11124], [11124, 11126],
        ]);
        const result = charged.get(itemId);
        if (!result) {
            player.sendMessage("This spell can only recharge dragonstone jewellery.");
            return true;
        }
        return new LunarSpell(data).cast(player, () => { item.setId(result); player.getInventory().refreshItems(); });
    }

    private static curePoison(player: Player): void {
        player.setPoisonDamage(0);
        player.setVenomed(false);
        player.getCombat().getPoisonImmunityTimer().start(12);
        player.getPacketSender().sendPoisonType(0);
    }

    private static forNearbyPlayers(player: Player, effect: (target: Player) => void): void {
        World.getPlayers().forEach(target => {
            if (target && this.acceptsAid(target) && target.getHitpoints() > 0 && player.getLocation().isWithinDistance(target.getLocation(), 1)) effect(target);
        });
    }

    private static acceptsAid(player: Player): boolean {
        return player.getAttribute("accept-aid") !== false;
    }

    public static expireSpellbookSwap(player: Player): void {
        const swap: any = player.getAttribute("lunar:spellbook-swap");
        if (swap && Date.now() >= swap.expiresAt) {
            player.setAttribute("lunar:spellbook-swap", null);
            MagicSpellbook.changeSpellbook(player, MagicSpellbook.LUNAR, true);
        }
    }

    private static openNpcContact(player: Player): void {
        const contacts = ["Nieve", "Duradel", "Konar quo Maten", "Mazchna"];
        const builder = new DialogueChainBuilder();
        builder.add(new OptionDialogue(0, { executeOption: (option: DialogueOption) => {
            const contact = contacts[(option as number) - 1];
            player.getPacketSender().sendInterfaceRemoval();
            if (contact) player.sendMessage(`You contact ${contact}.`);
        } }, ...contacts));
        player.getDialogueManager().startDialogues(builder);
    }

    private static openSpellbookSwap(player: Player): void {
        const books = [MagicSpellbook.NORMAL, MagicSpellbook.ANCIENT, MagicSpellbook.ARCEUUS];
        const builder = new DialogueChainBuilder();
        builder.add(new OptionDialogue(0, { executeOption: (option: DialogueOption) => {
            const book = books[(option as number) - 1];
            player.getPacketSender().sendInterfaceRemoval();
            if (!book) return;
            player.setAttribute("lunar:spellbook-swap", { expiresAt: Date.now() + 120_000 });
            MagicSpellbook.changeSpellbook(player, book, true);
        } }, "Standard", "Ancient", "Arceuus"));
        player.getDialogueManager().startDialogues(builder);
    }
}
