/*
 * Copyright (c) 2019, Twiglet1022 <https://github.com/Twiglet1022>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { Color } from "@runelite/awt/Color";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import type { Item } from "@runelite/api/Item";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import * as ItemID from "@runelite/api/gameval/ItemID";
import { LineComponent } from "@runelite/client/ui/overlay/components/LineComponent";
import type { PanelComponent } from "@runelite/client/ui/overlay/components/PanelComponent";
import { TitleComponent } from "@runelite/client/ui/overlay/components/TitleComponent";
import { OverlayUtil } from "@runelite/client/ui/overlay/OverlayUtil";
import { IMAGE_Z_OFFSET, TITLED_CONTENT_COLOR, UNICODE_BALLOT_X, UNICODE_CHECK_MARK } from "../ClueScrollColors";
import type { ClueScrollPlugin } from "../ClueScrollPlugin";
import { javaStringHashCode } from "./ClueKeys";
import { ClueScroll } from "./ClueScroll";
import type { NpcClueScroll } from "./ClueScrollTypes";
import { EmoteClue } from "./EmoteClue";
import type { ItemRequirement } from "./item/ItemRequirement";
import { any, item, range } from "./item/ItemRequirements";

/** Falo's riddle is read off his dialogue, after "Okay, here goes... " or "Here goes... ". */
const CLUE_TEXT_PREFIX = /^(?:Okay, )?here goes\.\.\. /i;
const LOCATION = new WorldPoint(2689, 3550, 0);
const FALO_THE_BARD = "Falo the Bard";

/** RuneLite's FaloTheBardClue: Falo's riddle and the item it asks for. */
export class FaloTheBardClue extends ClueScroll implements NpcClueScroll {
    private readonly itemRequirements: ItemRequirement[];

    constructor(
        private readonly text: string,
        ...itemRequirements: ItemRequirement[]
    ) {
        super();
        this.itemRequirements = itemRequirements;
    }

    getText(): string {
        return this.text;
    }

    getItemRequirements(): ItemRequirement[] {
        return this.itemRequirements;
    }

    makeOverlayHint(panelComponent: PanelComponent, plugin: ClueScrollPlugin): void {
        panelComponent.getChildren().push(TitleComponent.builder().text("Falo the Bard Clue").build());
        panelComponent.getChildren().push(LineComponent.builder().left("NPC:").build());
        panelComponent.getChildren().push(LineComponent.builder().left(FALO_THE_BARD).leftColor(TITLED_CONTENT_COLOR).build());
        panelComponent.getChildren().push(LineComponent.builder().left("Item:").build());
        const inventory: Item[] = plugin.getInventoryItems() ?? [];
        for (const requirement of this.itemRequirements) {
            const fulfilled = requirement.fulfilledBy(inventory);
            panelComponent.getChildren().push(
                LineComponent.builder()
                    .left(requirement.getCollectiveName(plugin.getClient()))
                    .leftColor(TITLED_CONTENT_COLOR)
                    .right(fulfilled ? UNICODE_CHECK_MARK : UNICODE_BALLOT_X)
                    .rightColor(fulfilled ? Color.GREEN : Color.RED)
                    .build(),
            );
        }
        this.renderOverlayNote(panelComponent, plugin);
    }

    makeWorldOverlayHint(graphics: Graphics2D, plugin: ClueScrollPlugin): void {
        if (!LOCATION.isInScene(plugin.getClient())) return;
        for (const npc of plugin.getNpcsToMark()) {
            OverlayUtil.renderActorOverlayImage(plugin.osrsClient, graphics, npc, plugin.getClueScrollImage(), Color.ORANGE, IMAGE_Z_OFFSET);
        }
    }

    getNpcs(_plugin: ClueScrollPlugin): Array<string | null> {
        return [FALO_THE_BARD];
    }

    getConfigKeys(): number[] {
        return [javaStringHashCode(this.text)];
    }

    static forText(text: string): FaloTheBardClue | null {
        const lower = text.toLowerCase();
        for (const clue of FaloTheBardClue.CLUES) if (clue.text.toLowerCase() === lower) return clue;
        return null;
    }

    static forChatboxText(sender: string, dialogText: string): FaloTheBardClue | null {
        if (sender !== FALO_THE_BARD) return null;
        const match = CLUE_TEXT_PREFIX.exec(dialogText);
        if (!match) return null;
        return FaloTheBardClue.forText(dialogText.slice(match[0].length));
    }

    /** RuneLite 1.13.6's table, row for row (a module constant: the rows build instances of this class). */
    static get CLUES(): readonly FaloTheBardClue[] {
        return FALO_THE_BARD_CLUES;
    }
}

export const FALO_THE_BARD_CLUES: readonly FaloTheBardClue[] = [
        new FaloTheBardClue("A blood red weapon, a strong curved sword, found on the island of primate lords.", any("Dragon scimitar", item(ItemID.DRAGON_SCIMITAR), item(ItemID.DRAGON_SCIMITAR_ORNAMENT))),
        new FaloTheBardClue("A book that preaches of some great figure, lending strength, might and vigour.", any("Any completed god book", item(ItemID.SARADOMINBOOK_COMPLETE), item(ItemID.GUTHIXBOOK_COMPLETE), item(ItemID.ZAMORAKBOOK_COMPLETE), item(ItemID.ARMADYLBOOK_COMPLETE), item(ItemID.BANDOSBOOK_COMPLETE), item(ItemID.ZAROSBOOK_COMPLETE), item(ItemID.LEAGUE_3_BOOK_SARADOMIN), item(ItemID.LEAGUE_3_BOOK_GUTHIX), item(ItemID.LEAGUE_3_BOOK_ZAMORAK), item(ItemID.LEAGUE_3_BOOK_ARMADYL), item(ItemID.LEAGUE_3_BOOK_BANDOS), item(ItemID.LEAGUE_3_BOOK_ZAROS))),
        new FaloTheBardClue("A bow of elven craft was made, it shimmers bright, but will soon fade.", any("Crystal Bow", EmoteClue.ACTIVE_CRYSTAL_BOW_OR_BOW_OF_FAERDHINEN)),
        new FaloTheBardClue("A fiery axe of great inferno, when you use it, you'll wonder where the logs go.", any("Infernal axe", item(ItemID.INFERNAL_AXE), item(ItemID.INFERNAL_AXE_EMPTY), item(ItemID.TRAILBLAZER_AXE), item(ItemID.TRAILBLAZER_AXE_EMPTY), item(ItemID.TRAILBLAZER_RELOADED_AXE), item(ItemID.TRAILBLAZER_RELOADED_AXE_EMPTY))),
        new FaloTheBardClue("A mark used to increase one's grace, found atop a seer's place.", item(ItemID.GRACE)),
        new FaloTheBardClue("A molten beast with fiery breath, you acquire these with its death.", item(ItemID.LAVA_DRAGON_BONES)),
        new FaloTheBardClue("A shiny helmet of flight, to obtain this with melee, struggle you might.", item(ItemID.ARMADYL_HELMET)),
        new FaloTheBardClue("A sword held in the other hand, red its colour, Cyclops strength you must withstand.", any("Dragon or Avernic Defender", item(ItemID.DRAGON_PARRYINGDAGGER), item(ItemID.DRAGON_PARRYINGDAGGER_T), item(ItemID.DRAGON_PARRYINGDAGGER_TROUVER), item(ItemID.DRAGON_PARRYINGDAGGER_T_TROUVER), item(ItemID.INFERNAL_DEFENDER), item(ItemID.INFERNAL_DEFENDER_TROUVER), item(ItemID.INFERNAL_DEFENDER_GHOMMAL_5), item(ItemID.INFERNAL_DEFENDER_GHOMMAL_5_TROUVER), item(ItemID.INFERNAL_DEFENDER_GHOMMAL_6), item(ItemID.INFERNAL_DEFENDER_GHOMMAL_6_TROUVER))),
        new FaloTheBardClue("A token used to kill mythical beasts, in hopes of a blade or just for an xp feast.", item(ItemID.WARGUILD_TOKENS)),
        new FaloTheBardClue("Green is my favourite, mature ale I do love, this takes your herblore above.", item(ItemID.MATURE_GREENMANS_ALE)),
        new FaloTheBardClue("It can hold down a boat or crush a goat, this object, you see, is quite heavy.", any("Barrelchest anchor", item(ItemID.BRAIN_ANCHOR), item(ItemID.BH_BRAIN_ANCHOR_IMBUE))),
        new FaloTheBardClue("It comes from the ground, underneath the snowy plain. Trolls aplenty, with what looks like a mane.", item(ItemID.BASALT)),
        new FaloTheBardClue("No attack to wield, only strength is required, made of obsidian, but with no room for a shield.", any("Tzhaar-ket-om", item(ItemID.TZHAAR_MAUL), item(ItemID.TZHAAR_MAUL_T))),
        new FaloTheBardClue("Penance healers runners and more, obtaining this body often gives much deplore.", any("Fighter Torso", item(ItemID.BARBASSAULT_PENANCE_FIGHTER_TORSO), item(ItemID.BARBASSAULT_PENANCE_FIGHTER_TORSO_TROUVER))),
        new FaloTheBardClue("Strangely found in a chest, many believe these gloves are the best.", item(ItemID.HUNDRED_GAUNTLETS_LEVEL_10)),
        new FaloTheBardClue("These gloves of white won't help you fight, but aid in cooking, they just might.", item(ItemID.GAUNTLETS_OF_COOKING)),
        new FaloTheBardClue("They come from some time ago, from a land unto the east. Fossilised they have become, this small and gentle beast.", item(ItemID.FOSSIL_NUMULITE)),
        new FaloTheBardClue("To slay a dragon you must first do, before this chest piece can be put on you.", item(ItemID.RUNE_PLATEBODY)),
        new FaloTheBardClue("Vampyres are agile opponents, damaged best with a weapon of many components.", any("Rod of Ivandis or Ivandis/Blisterwood/Hallowed flail", range(ItemID.BURGH_ROD_COMMAND_FINAL_10, ItemID.BURGH_ROD_COMMAND_FINAL_1), item(ItemID.IVANDIS_FLAIL), item(ItemID.BLISTERWOOD_FLAIL), item(ItemID.HALLOWED_FLAIL))),
        new FaloTheBardClue("You won't bring me to heel, unless you have a bright red keel.", item(ItemID.SAILING_BOAT_KEEL_PART_DRAGON))
];
