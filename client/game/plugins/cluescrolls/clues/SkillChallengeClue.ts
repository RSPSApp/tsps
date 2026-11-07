/*
 * Copyright (c) 2019 Hydrox6 <ikada@protonmail.ch>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { Color } from "@runelite/awt/Color";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import type { Item } from "@runelite/api/Item";
import * as ItemID from "@runelite/api/gameval/ItemID";
import { getVariations } from "@runelite/client/game/ItemVariationMapping";
import { LineComponent } from "@runelite/client/ui/overlay/components/LineComponent";
import type { PanelComponent } from "@runelite/client/ui/overlay/components/PanelComponent";
import { TitleComponent } from "@runelite/client/ui/overlay/components/TitleComponent";
import { OverlayUtil } from "@runelite/client/ui/overlay/OverlayUtil";
import { CLICKBOX_BORDER_COLOR, CLICKBOX_FILL_COLOR, CLICKBOX_HOVER_BORDER_COLOR, IMAGE_Z_OFFSET, TITLED_CONTENT_COLOR, UNICODE_BALLOT_X, UNICODE_CHECK_MARK } from "../ClueScrollColors";
import type { ClueScrollPlugin } from "../ClueScrollPlugin";
import { javaStringHashCode } from "./ClueKeys";
import { ClueScroll } from "./ClueScroll";
import type { NamedObjectClueScroll, NpcClueScroll } from "./ClueScrollTypes";
import { EquipmentInventorySlot } from "./EquipmentInventorySlot";
import type { ItemRequirement } from "./item/ItemRequirement";
import { all, any, emptySlot, item, range, xOfItem } from "./item/ItemRequirements";
import type { SingleItemRequirement } from "./item/SingleItemRequirement";

/** Who sets the challenge, and where they stand (RuneLite's ChallengeType). */
export class ChallengeType {
    private constructor(
        private readonly name: string,
        private readonly location: string,
    ) {}

    getName(): string {
        return this.name;
    }

    getLocation(): string {
        return this.location;
    }

    static readonly CHARLIE = new ChallengeType("Charlie the Tramp", "Southern Entrance to Varrock");
    static readonly SHERLOCK = new ChallengeType("Sherlock", "East of the Sorcerer's Tower in Seers' Village");
}

const variations = (...itemIds: number[]): SingleItemRequirement[] => itemIds.flatMap((id) => [...getVariations(id)]).map(item);

const ANY_PICKAXE = any("Any Pickaxe",
    item(ItemID.BRONZE_PICKAXE), item(ItemID.IRON_PICKAXE), item(ItemID.STEEL_PICKAXE), item(ItemID.BLACK_PICKAXE), item(ItemID.MITHRIL_PICKAXE), item(ItemID.ADAMANT_PICKAXE), item(ItemID.RUNE_PICKAXE),
    item(ItemID.DRAGON_PICKAXE), item(ItemID.DRAGON_PICKAXE_PRETTY), item(ItemID.ZALCANO_PICKAXE), item(ItemID.TRAILBLAZER_PICKAXE_NO_INFERNAL), item(ItemID.TRAILBLAZER_RELOADED_PICKAXE_NO_INFERNAL),
    item(ItemID.INFERNAL_PICKAXE), item(ItemID.TRAILBLAZER_PICKAXE), item(ItemID.TRAILBLAZER_RELOADED_PICKAXE), item(ItemID.INFERNAL_PICKAXE_EMPTY), item(ItemID.TRAILBLAZER_PICKAXE_EMPTY),
    item(ItemID.TRAILBLAZER_RELOADED_PICKAXE_EMPTY), item(ItemID.TRAIL_GILDED_PICKAXE), item(ItemID._3A_PICKAXE), item(ItemID.CRYSTAL_PICKAXE), item(ItemID.CRYSTAL_PICKAXE_INACTIVE), item(ItemID.LEAGUE_TRAILBLAZER_PICKAXE),
);
const ANY_AXE = any("Any Axe",
    item(ItemID.BRONZE_AXE), item(ItemID.BRONZE_AXE_2H), item(ItemID.IRON_AXE), item(ItemID.IRON_AXE_2H), item(ItemID.STEEL_AXE), item(ItemID.STEEL_AXE_2H), item(ItemID.BLACK_AXE), item(ItemID.BLACK_AXE_2H),
    item(ItemID.MITHRIL_AXE), item(ItemID.MITHRIL_AXE_2H), item(ItemID.ADAMANT_AXE), item(ItemID.ADAMANT_AXE_2H), item(ItemID.RUNE_AXE), item(ItemID.RUNE_AXE_2H), item(ItemID.DRAGON_AXE),
    item(ItemID.TRAILBLAZER_AXE_NO_INFERNAL), item(ItemID.TRAILBLAZER_RELOADED_AXE_NO_INFERNAL), item(ItemID.DRAGON_AXE_2H), item(ItemID.INFERNAL_AXE), item(ItemID.TRAILBLAZER_AXE), item(ItemID.TRAILBLAZER_RELOADED_AXE),
    item(ItemID.INFERNAL_AXE_EMPTY), item(ItemID.TRAILBLAZER_AXE_EMPTY), item(ItemID.TRAILBLAZER_RELOADED_AXE_EMPTY), item(ItemID.TRAIL_GILDED_AXE), item(ItemID._3A_AXE), item(ItemID._3A_AXE_2H),
    item(ItemID.CRYSTAL_AXE), item(ItemID.CRYSTAL_AXE_INACTIVE), item(ItemID.CRYSTAL_AXE_2H), item(ItemID.CRYSTAL_AXE_2H_INACTIVE), item(ItemID.LEAGUE_TRAILBLAZER_AXE),
);
const ANY_HARPOON = any("Harpoon",
    item(ItemID.HARPOON), item(ItemID.HUNTING_BARBED_HARPOON), item(ItemID.DRAGON_HARPOON), item(ItemID.TRAILBLAZER_HARPOON_NO_INFERNAL), item(ItemID.TRAILBLAZER_RELOADED_HARPOON_NO_INFERNAL),
    item(ItemID.INFERNAL_HARPOON), item(ItemID.TRAILBLAZER_HARPOON), item(ItemID.TRAILBLAZER_RELOADED_HARPOON), item(ItemID.INFERNAL_HARPOON_EMPTY), item(ItemID.TRAILBLAZER_HARPOON_EMPTY),
    item(ItemID.TRAILBLAZER_RELOADED_HARPOON_EMPTY), item(ItemID.CRYSTAL_HARPOON), item(ItemID.CRYSTAL_HARPOON_INACTIVE), item(ItemID.LEAGUE_TRAILBLAZER_HARPOON),
);
const ANY_HAMMER = any("Hammer", item(ItemID.HAMMER), item(ItemID.IMCANDO_HAMMER), item(ItemID.IMCANDO_HAMMER_OFFHAND));
const A_FULL_GRACEFUL_SET = all("A full Graceful set",
    any("" /* graceful hood   */, ...variations(ItemID.GRACEFUL_HOOD)),
    any("" /* graceful top    */, ...variations(ItemID.GRACEFUL_TOP)),
    any("" /* graceful legs   */, ...variations(ItemID.GRACEFUL_LEGS)),
    any("" /* graceful gloves */, ...variations(ItemID.GRACEFUL_GLOVES)),
    any("" /* graceful boots  */, ...variations(ItemID.GRACEFUL_BOOTS)),
    any("" /* graceful cape   */, ...variations(ItemID.GRACEFUL_CAPE, ItemID.SKILLCAPE_AGILITY, ItemID.SKILLCAPE_MAX)),
);
void range;
void xOfItem;
void ANY_PICKAXE; void ANY_AXE; void ANY_HARPOON; void ANY_HAMMER; void A_FULL_GRACEFUL_SET;

/** RuneLite's SkillChallengeClue: Sherlock's and Charlie's tasks, what they need, and the line that says one is done. */
export class SkillChallengeClue extends ClueScroll implements NpcClueScroll, NamedObjectClueScroll {
    private readonly type: ChallengeType;
    private readonly challenge: string;
    private readonly chatboxChallenge: string | null;
    private readonly rawChallenge: string;
    private readonly returnText: string;
    private readonly itemRequirements: ItemRequirement[];
    private readonly returnItem: SingleItemRequirement | null;
    private readonly requireEquip: boolean;
    private readonly objectNames: string[];
    private readonly objectRegions: number[] | null;
    private challengeCompleted: boolean;

    /**
     * RuneLite's constructors in one. Charlie: (CHARLIE, clue text, Charlie's line, the item to
     * return). Sherlock: the task, then optionally its raw scroll text, whether the items must be
     * worn, the object names and regions to highlight, then the item requirements.
     */
    constructor(first: ChallengeType | string, ...rest: Array<string | boolean | string[] | number[] | null | ItemRequirement>) {
        super();
        if (first instanceof ChallengeType) {
            if (first !== ChallengeType.CHARLIE) throw new Error("only Charlie's tasks name their type");
            const [clueText, chatboxChallenge, returnItem] = rest as [string, string, SingleItemRequirement];
            this.type = first;
            this.challenge = "";
            this.rawChallenge = clueText;
            this.returnText = clueText;
            this.chatboxChallenge = chatboxChallenge;
            this.itemRequirements = [];
            this.returnItem = returnItem;
            this.challengeCompleted = true;
            this.requireEquip = false;
            this.objectNames = [];
            this.objectRegions = null;
            return;
        }
        let i = 0;
        const rawChallenge = typeof rest[i] === "string" ? (rest[i++] as string) : first.toLowerCase();
        const requireEquip = typeof rest[i] === "boolean" ? (rest[i++] as boolean) : false;
        let objectNames: string[] = [];
        let objectRegions: number[] | null = null;
        if (Array.isArray(rest[i]) || rest[i] === null) {
            objectNames = (rest[i++] as string[] | null) ?? [];
            objectRegions = (rest[i++] as number[] | null) ?? null;
        }
        this.type = ChallengeType.SHERLOCK;
        this.challenge = first;
        this.chatboxChallenge = null;
        this.rawChallenge = rawChallenge;
        this.itemRequirements = rest.slice(i) as ItemRequirement[];
        this.challengeCompleted = false;
        this.requireEquip = requireEquip;
        this.objectNames = objectNames;
        this.objectRegions = objectRegions;
        this.returnText = `<str>${rawChallenge}</str>`;
        this.returnItem = null;
    }

    getType(): ChallengeType {
        return this.type;
    }

    getChallenge(): string {
        return this.challenge;
    }

    getChatboxChallenge(): string | null {
        return this.chatboxChallenge;
    }

    getRawChallenge(): string {
        return this.rawChallenge;
    }

    getReturnItem(): SingleItemRequirement | null {
        return this.returnItem;
    }

    getItemRequirements(): ItemRequirement[] {
        return this.itemRequirements;
    }

    isChallengeCompleted(): boolean {
        return this.challengeCompleted;
    }

    setChallengeCompleted(completed: boolean): void {
        this.challengeCompleted = completed;
    }

    makeOverlayHint(panelComponent: PanelComponent, plugin: ClueScrollPlugin): void {
        panelComponent.getChildren().push(TitleComponent.builder().text("Skill Challenge Clue").build());
        if (!this.challengeCompleted) {
            panelComponent.getChildren().push(LineComponent.builder().left("Challenge:").build());
            panelComponent.getChildren().push(LineComponent.builder().left(this.challenge).leftColor(TITLED_CONTENT_COLOR).build());
            if (this.itemRequirements.length > 0) {
                panelComponent.getChildren().push(LineComponent.builder().left(this.requireEquip ? "Equipment:" : "Items Required:").build());
                for (const line of getRequirements(plugin, this.requireEquip, ...this.itemRequirements)) panelComponent.getChildren().push(line);
            }
        } else {
            panelComponent.getChildren().push(LineComponent.builder().left("NPC:").build());
            panelComponent.getChildren().push(LineComponent.builder().left(this.type.getName()).leftColor(TITLED_CONTENT_COLOR).build());
            panelComponent.getChildren().push(LineComponent.builder().left("Location:").build());
            panelComponent.getChildren().push(LineComponent.builder().left(this.type.getLocation()).leftColor(TITLED_CONTENT_COLOR).build());
            if (this.returnItem) {
                panelComponent.getChildren().push(LineComponent.builder().left("Item:").build());
                for (const line of getRequirements(plugin, false, this.returnItem)) panelComponent.getChildren().push(line);
            }
        }
        this.renderOverlayNote(panelComponent, plugin);
    }

    makeWorldOverlayHint(graphics: Graphics2D, plugin: ClueScrollPlugin): void {
        const scene = plugin.osrsClient;
        for (const npc of plugin.getNpcsToMark()) {
            OverlayUtil.renderActorOverlayImage(scene, graphics, npc, plugin.getClueScrollImage(), Color.ORANGE, IMAGE_Z_OFFSET);
        }
        if (!this.challengeCompleted && this.objectNames.length > 0) {
            const mousePosition = plugin.getClient().getMouseCanvasPosition();
            for (const object of plugin.getNamedObjectsToMark()) {
                if (plugin.getClient().getPlane() !== object.getPlane()) continue;
                OverlayUtil.renderHoverableArea(graphics, object.getClickbox(), mousePosition, CLICKBOX_FILL_COLOR, CLICKBOX_BORDER_COLOR, CLICKBOX_HOVER_BORDER_COLOR);
                OverlayUtil.renderImageLocationAt(scene, graphics, object.getWorldLocation(), plugin.getClueScrollImage(), IMAGE_Z_OFFSET);
            }
        }
    }

    /** A task by its scroll text: struck through means done, plain means to do. */
    static forText(text: string, rawText: string): SkillChallengeClue | null {
        const lowerRaw = rawText.toLowerCase();
        for (const clue of SkillChallengeClue.CLUES) {
            if (lowerRaw === clue.returnText.toLowerCase()) {
                clue.setChallengeCompleted(true);
                return clue;
            }
            if (text === clue.rawChallenge) {
                clue.setChallengeCompleted(false);
                return clue;
            }
        }
        return null;
    }

    /** Charlie's task from his dialogue line. */
    static forChatboxText(sender: string, dialogText: string): SkillChallengeClue | null {
        if (sender !== ChallengeType.CHARLIE.getName()) return null;
        const lower = dialogText.toLowerCase();
        for (const clue of SkillChallengeClue.CLUES) {
            if (clue.chatboxChallenge !== null && clue.chatboxChallenge.toLowerCase() === lower) return clue;
        }
        return null;
    }

    getNpcs(_plugin: ClueScrollPlugin): Array<string | null> {
        return [this.type.getName()];
    }

    getObjectNames(): string[] {
        return this.objectNames;
    }

    getObjectRegions(): number[] | null {
        return this.objectRegions;
    }

    getConfigKeys(): number[] {
        return [javaStringHashCode(this.rawChallenge)];
    }

    /** RuneLite 1.13.6's table, row for row (a module constant: the rows build instances of this class). */
    static get CLUES(): readonly SkillChallengeClue[] {
        return SKILL_CHALLENGE_CLUES;
    }
}

/** Requirement lines: green when worn (or carried and wearing is not required), orange when only carried, red when missing. */
function getRequirements(plugin: ClueScrollPlugin, requireEquipped: boolean, ...requirements: ItemRequirement[]): LineComponent[] {
    const equipment: Item[] = plugin.getEquippedItems() ?? [];
    const inventory: Item[] = plugin.getInventoryItems() ?? [];
    const combined = [...equipment, ...inventory];
    return requirements.map((requirement) => {
        const equipmentFulfilled = requirement.fulfilledBy(equipment);
        const combinedFulfilled = requirement.fulfilledBy(combined);
        return LineComponent.builder()
            .left(requirement.getCollectiveName(plugin.getClient()))
            .leftColor(TITLED_CONTENT_COLOR)
            .right(combinedFulfilled ? UNICODE_CHECK_MARK : UNICODE_BALLOT_X)
            .rightColor(equipmentFulfilled || (combinedFulfilled && !requireEquipped) ? Color.GREEN : combinedFulfilled ? Color.ORANGE : Color.RED)
            .build();
    });
}

export const SKILL_CHALLENGE_CLUES: readonly SkillChallengeClue[] = [
        // Charlie Tasks
        new SkillChallengeClue(ChallengeType.CHARLIE,
            "i need to give charlie a cooked pike.",
            "I really need a cooked pike.",
            item(ItemID.PIKE)),
        new SkillChallengeClue(
            ChallengeType.CHARLIE,
            "i need to give charlie a cooked trout.",
            "I really need a cooked trout.",
            item(ItemID.TROUT)),
        new SkillChallengeClue(
            ChallengeType.CHARLIE,
            "i need to give charlie a leather body.",
            "I really need a leather body.",
            item(ItemID.LEATHER_ARMOUR)),
        new SkillChallengeClue(
            ChallengeType.CHARLIE,
            "i need to give charlie some leather chaps.",
            "I really need some leather chaps.",
            item(ItemID.LEATHER_CHAPS)),
        new SkillChallengeClue(
            ChallengeType.CHARLIE,
            "i need to give charlie a raw herring.",
            "I really need a raw herring.",
            item(ItemID.RAW_HERRING)),
        new SkillChallengeClue(
            ChallengeType.CHARLIE,
            "i need to give charlie a raw trout.",
            "I really need a raw trout.",
            item(ItemID.RAW_TROUT)),
        new SkillChallengeClue(
            ChallengeType.CHARLIE,
            "i need to give charlie a piece of iron ore.",
            "I really need a piece of iron ore.",
            item(ItemID.IRON_ORE)),
        new SkillChallengeClue(
            ChallengeType.CHARLIE,
            "i need to give charlie one iron dagger.",
            "I really need an iron dagger.",
            item(ItemID.IRON_DAGGER)),
        // Elite Sherlock Tasks
        new SkillChallengeClue("Equip a Dragon Scimitar.", true, any("Any Dragon Scimitar", item(ItemID.DRAGON_SCIMITAR), item(ItemID.DRAGON_SCIMITAR_ORNAMENT))),
        new SkillChallengeClue("Enchant some Dragonstone Jewellery.", "enchant a piece of dragonstone jewellery.",
            any("Cosmic Rune x1", xOfItem(ItemID.COSMICRUNE, 1), xOfItem(ItemID.AETHERRUNE, 1)),
            any("Water Rune x15", xOfItem(ItemID.WATERRUNE, 15), xOfItem(ItemID.MISTRUNE, 15), xOfItem(ItemID.MUDRUNE, 15), xOfItem(ItemID.STEAMRUNE, 15), item(ItemID.STAFF_OF_WATER), item(ItemID.WATER_BATTLESTAFF), item(ItemID.MYSTIC_WATER_STAFF), item(ItemID.MUD_BATTLESTAFF), item(ItemID.MYSTIC_MUD_STAFF), item(ItemID.MIST_BATTLESTAFF), item(ItemID.MYSTIC_MIST_BATTLESTAFF), item(ItemID.STEAM_BATTLESTAFF), item(ItemID.MYSTIC_STEAM_BATTLESTAFF), item(ItemID.STEAM_BATTLESTAFF_PRETTY), item(ItemID.MYSTIC_STEAM_BATTLESTAFF_PRETTY), item(ItemID.KODAI_WAND), item(ItemID.TOME_OF_WATER)),
            any("Earth Rune x15", xOfItem(ItemID.EARTHRUNE, 15), xOfItem(ItemID.DUSTRUNE, 15), xOfItem(ItemID.MUDRUNE, 15), xOfItem(ItemID.LAVARUNE, 15), item(ItemID.STAFF_OF_EARTH), item(ItemID.EARTH_BATTLESTAFF), item(ItemID.MYSTIC_EARTH_STAFF), item(ItemID.MUD_BATTLESTAFF), item(ItemID.MYSTIC_MUD_STAFF), item(ItemID.DUST_BATTLESTAFF), item(ItemID.MYSTIC_DUST_BATTLESTAFF), item(ItemID.LAVA_BATTLESTAFF), item(ItemID.MYSTIC_LAVA_STAFF), item(ItemID.LAVA_BATTLESTAFF_PRETTY), item(ItemID.MYSTIC_LAVA_STAFF_PRETTY)),
            any("Unenchanted Dragonstone Jewellery", item(ItemID.DRAGONSTONE_RING), item(ItemID.DRAGONSTONE_NECKLACE), item(ItemID.JEWL_DRAGONSTONE_BRACELET), item(ItemID.STRUNG_DRAGONSTONE_AMULET))),
        new SkillChallengeClue("Craft a nature rune.", any("Pure essence or Daeyalt essence", item(ItemID.BLANKRUNE_HIGH), item(ItemID.BLANKRUNE_DAEYALT))),
        new SkillChallengeClue("Catch a mottled eel with aerial fishing in Lake Molch.", any("Fish offcuts or King worms", item(ItemID.BRUT_FISH_CUTS), item(ItemID.KING_WORM)), emptySlot("No Gloves", EquipmentInventorySlot.GLOVES), any("No Weapon", emptySlot("",  EquipmentInventorySlot.WEAPON), item(ItemID.AERIAL_FISHING_GLOVES_NO_BIRD), item(ItemID.AERIAL_FISHING_GLOVES_BIRD)), emptySlot("No Shield", EquipmentInventorySlot.SHIELD)),
        new SkillChallengeClue("Score a goal in skullball.", true, any("Ring of Charos", item(ItemID.RING_OF_CHAROS), item(ItemID.RING_OF_CHAROS_UNLOCKED))),
        new SkillChallengeClue("Complete a lap of Ape atoll agility course.", true, any("Ninja Monkey Greegree", item(ItemID.MM_MONKEY_GREEGREE_FOR_SMALL_NINJA_MONKEY), item(ItemID.MM_MONKEY_GREEGREE_FOR_MEDIUM_NINJA_MONKEY), item(ItemID.MM2_KRUK_GREEGREE))),
        new SkillChallengeClue("Create a super defence potion.", item(ItemID.CADANTINEVIAL), item(ItemID.WHITE_BERRIES)),
        new SkillChallengeClue("Steal from a chest in Ardougne Castle."),
        new SkillChallengeClue("Craft a green dragonhide body.", xOfItem(ItemID.DRAGON_LEATHER, 3), any("Needle", item(ItemID.NEEDLE), item(ItemID.COSTUMENEEDLE)), any("Thread", item(ItemID.THREAD), item(ItemID.COSTUMENEEDLE))),
        new SkillChallengeClue("String a yew longbow.", item(ItemID.UNSTRUNG_YEW_LONGBOW), item(ItemID.BOW_STRING)),
        new SkillChallengeClue("Kill a Dust Devil.", "slay a dust devil.", true,
            any("Facemask or Slayer Helmet", ...variations(ItemID.SLAYER_HELM), item(ItemID.SLAYER_FACEMASK))),
        new SkillChallengeClue("Catch a black warlock.", any("Butterfly Net", item(ItemID.HUNTING_BUTTERFLY_NET), item(ItemID.II_MAGIC_BUTTERFLY_NET))),
        new SkillChallengeClue("Catch a red chinchompa.", item(ItemID.HUNTING_BOX_TRAP)),
        new SkillChallengeClue("Mine a mithril ore.", ANY_PICKAXE),
        new SkillChallengeClue("Smith a mithril 2h sword.", ANY_HAMMER, xOfItem(ItemID.MITHRIL_BAR, 3)),
        new SkillChallengeClue("Catch a raw shark.", ANY_HARPOON),
        new SkillChallengeClue("Cut a yew log.", ANY_AXE),
        new SkillChallengeClue("Fix a magical lamp in Dorgesh-Kaan.", [ "Broken lamp" ], [ 10834, 10835 ], item(ItemID.DORGESH_LIGHT_BULB)),
        new SkillChallengeClue("Burn a yew log.", item(ItemID.YEW_LOGS), item(ItemID.TINDERBOX)),
        new SkillChallengeClue("Cook a swordfish", "cook a swordfish", item(ItemID.RAW_SWORDFISH)),
        new SkillChallengeClue("Craft multiple cosmic runes from a single essence.", any("Pure essence or Daeyalt essence", item(ItemID.BLANKRUNE_HIGH), item(ItemID.BLANKRUNE_DAEYALT))),
        new SkillChallengeClue("Plant a watermelon seed.", item(ItemID.RAKE), item(ItemID.DIBBER), xOfItem(ItemID.WATERMELON_SEED, 3)),
        new SkillChallengeClue("Activate the Chivalry prayer."),
        new SkillChallengeClue("Smith a tier 2 or above Shayzien platebody.", "smith a tier 2 or above shayzien platebody.", ANY_HAMMER, xOfItem(ItemID.LOVAKITE_BAR, 4)),
        new SkillChallengeClue("Mine some nickel.", ANY_PICKAXE),
        // Master Sherlock Tasks
        new SkillChallengeClue("Equip an abyssal whip in front of the abyssal demons of the Slayer Tower.", true, any("Abyssal Whip", item(ItemID.ABYSSAL_WHIP), item(ItemID.ABYSSAL_WHIP_ICE), item(ItemID.ABYSSAL_WHIP_LAVA), item(ItemID.LEAGUE_3_WHIP), item(ItemID.ABYSSAL_TENTACLE), item(ItemID.LEAGUE_3_WHIP_TENTACLE))),
        new SkillChallengeClue("Smith a runite med helm.", ANY_HAMMER, item(ItemID.RUNITE_BAR)),
        new SkillChallengeClue("Teleport to a spirit tree you planted yourself."),
        new SkillChallengeClue("Create a Barrows teleport tablet.", item(ItemID.ARCEUUS_ESSENCE_BLOCK_DARK), xOfItem(ItemID.BLOODRUNE, 1), xOfItem(ItemID.LAWRUNE, 2), any("Soul Rune x2", xOfItem(ItemID.SOULRUNE, 2), xOfItem(ItemID.AETHERRUNE, 2))),
        new SkillChallengeClue("Kill a Nechryael in the Slayer Tower.", "slay a nechryael in the slayer tower."),
        new SkillChallengeClue("Kill a Spiritual Mage while wearing something from their god.", "kill the spiritual, magic and godly whilst representing their own god."),
        new SkillChallengeClue("Create an unstrung dragonstone amulet at a furnace.", item(ItemID.GOLD_BAR), item(ItemID.DRAGONSTONE), item(ItemID.AMULET_MOULD)),
        new SkillChallengeClue("Burn a magic log.", item(ItemID.MAGIC_LOGS), item(ItemID.TINDERBOX)),
        new SkillChallengeClue("Burn a redwood log.", item(ItemID.REDWOOD_LOGS), item(ItemID.TINDERBOX)),
        new SkillChallengeClue("Complete a lap of Rellekka's Rooftop Agility Course", "complete a lap of the rellekka rooftop agility course whilst sporting the finest amount of grace.", true, A_FULL_GRACEFUL_SET),
        new SkillChallengeClue("Mix an anti-venom potion.", item(ItemID.ANTIDOTE__4), xOfItem(ItemID.SNAKEBOSS_SCALE, 20)),
        new SkillChallengeClue("Mine a piece of Runite ore", "mine a piece of runite ore whilst sporting the finest mining gear.", true, ANY_PICKAXE,
            all("Prospector kit",
                any("", item(ItemID.MOTHERLODE_REWARD_HAT), item(ItemID.MOTHERLODE_REWARD_HAT_GOLD)),
                any("", item(ItemID.MOTHERLODE_REWARD_TOP), item(ItemID.VARROCK_ARMOUR_ELITE), item(ItemID.MOTHERLODE_REWARD_TOP_GOLD)),
                any("", item(ItemID.MOTHERLODE_REWARD_LEGS), item(ItemID.MOTHERLODE_REWARD_LEGS_GOLD)),
                any("", item(ItemID.MOTHERLODE_REWARD_BOOTS), item(ItemID.MOTHERLODE_REWARD_BOOTS_GOLD)))),
        new SkillChallengeClue("Steal a gem from the Ardougne market."),
        new SkillChallengeClue("Pickpocket an elf."),
        new SkillChallengeClue("Bind a blood rune at the blood altar.", item(ItemID.BIGBLANKRUNE)),
        new SkillChallengeClue("Create a ranging mix potion.", "mix a ranging mix potion.", item(ItemID._2DOSERANGERSPOTION), item(ItemID.BRUT_CAVIAR)),
        new SkillChallengeClue("Fletch a rune dart.", item(ItemID.RUNE_DART_TIP), item(ItemID.FEATHER)),
        new SkillChallengeClue("Cremate a set of fiyr remains.", any("Magic or Redwood Pyre Logs", item(ItemID.MAGIC_LOGS_PYRE), item(ItemID.REDWOOD_LOGS_PYRE)), item(ItemID.TINDERBOX), item(ItemID.SHADE_BONES5)),
        new SkillChallengeClue("Dissect a sacred eel.", item(ItemID.KNIFE), any("Fishing rod", item(ItemID.FISHING_ROD), item(ItemID.FISHINGROD_PEARL)), item(ItemID.FISHING_BAIT)),
        new SkillChallengeClue("Kill a lizardman shaman."),
        new SkillChallengeClue("Catch an Anglerfish.", "angle for an anglerfish whilst sporting the finest fishing gear.", true,
            any("Fishing rod", item(ItemID.FISHING_ROD), item(ItemID.FISHINGROD_PEARL)),
            any("Worms", item(ItemID.PISCARILIUS_SANDWORMS), item(ItemID.DIABOLIC_WORMS)),
            all("Angler's outfit",
                any("", item(ItemID.TRAWLER_REWARD_HAT), item(ItemID.SPIRIT_ANGLER_HAT)),
                any("", item(ItemID.TRAWLER_REWARD_TOP), item(ItemID.SPIRIT_ANGLER_TOP)),
                any("", item(ItemID.TRAWLER_REWARD_LEGS), item(ItemID.SPIRIT_ANGLER_LEGS)),
                any("", item(ItemID.TRAWLER_REWARD_BOOTS), item(ItemID.SPIRIT_ANGLER_BOOTS)))),
        new SkillChallengeClue("Chop a redwood log.", "chop a redwood log whilst sporting the finest lumberjack gear.", true, ANY_AXE,
            all("Lumberjack outfit",
                any("", item(ItemID.RAMBLE_LUMBERJACK_HAT), item(ItemID.FORESTRY_LUMBERJACK_HAT)),
                any("", item(ItemID.RAMBLE_LUMBERJACK_TOP), item(ItemID.FORESTRY_LUMBERJACK_TOP)),
                any("", item(ItemID.RAMBLE_LUMBERJACK_LEGS), item(ItemID.FORESTRY_LUMBERJACK_LEGS)),
                any("", item(ItemID.RAMBLE_LUMBERJACK_BOOTS), item(ItemID.FORESTRY_LUMBERJACK_BOOTS)))),
        new SkillChallengeClue("Craft a light orb in the Dorgesh-Kaan bank.", item(ItemID.DORGESH_WIRE), item(ItemID.DORGESH_LIGHTBULB_NOFILAMENT)),
        new SkillChallengeClue("Kill a reanimated Abyssal Demon.", "kill a reanimated abyssal.", any("Soul Rune x4", xOfItem(ItemID.SOULRUNE, 4), xOfItem(ItemID.AETHERRUNE, 4)), xOfItem(ItemID.BLOODRUNE, 2), any("Nature Rune x4", xOfItem(ItemID.NATURERUNE, 4), item(ItemID.NATURE_STAFF_CHARGED)), range("Ensouled abyssal head", ItemID.ARCEUUS_CORPSE_ABYSSAL_INITIAL, ItemID.ARCEUUS_CORPSE_ABYSSAL)),
        new SkillChallengeClue("Kill a Fiyr shade inside Mort'tons shade catacombs.",
            any("Any Gold or Silver Shade Key",
                item(ItemID.SHADEKEY_GOLD_BLOODRED), item(ItemID.SHADEKEY_GOLD_BROWN), item(ItemID.SHADEKEY_GOLD_CRIMSON), item(ItemID.SHADEKEY_GOLD_BLACK), item(ItemID.SHADEKEY_GOLD_PURPLE),
                item(ItemID.SHADEKEY_SILVER_BLOODRED), item(ItemID.SHADEKEY_SILVER_BROWN), item(ItemID.SHADEKEY_SILVER_CRIMSON), item(ItemID.SHADEKEY_SILVER_BLACK), item(ItemID.SHADEKEY_SILVER_PURPLE))),
        new SkillChallengeClue("Catch a tecu salamander.", item(ItemID.ROPE), item(ItemID.NET))
];
