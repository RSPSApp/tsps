/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { Color } from "@runelite/awt/Color";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import * as ItemID from "@runelite/api/gameval/ItemID";
import * as ObjectID from "@runelite/api/gameval/ObjectID";
import * as VarbitID from "@runelite/api/gameval/VarbitID";
import { Quest } from "@runelite/api/Quest";
import { QuestState } from "@runelite/api/QuestState";
import { LineComponent } from "@runelite/client/ui/overlay/components/LineComponent";
import type { PanelComponent } from "@runelite/client/ui/overlay/components/PanelComponent";
import { TitleComponent } from "@runelite/client/ui/overlay/components/TitleComponent";
import { OverlayUtil } from "@runelite/client/ui/overlay/OverlayUtil";
import { CLICKBOX_BORDER_COLOR, CLICKBOX_FILL_COLOR, CLICKBOX_HOVER_BORDER_COLOR, IMAGE_Z_OFFSET, TITLED_CONTENT_COLOR } from "../ClueScrollColors";
import type { ClueScrollPlugin } from "../ClueScrollPlugin";
import { javaStringHashCode } from "./ClueKeys";
import { ClueScroll } from "./ClueScroll";
import type { NpcClueScroll, ObjectClueScroll } from "./ClueScrollTypes";

type Provider<T> = (plugin: ClueScrollPlugin) => T;

/** The prefix a hard clue puts before its anagram, and the beginner clue's variant. */
export const ANAGRAM_TEXT = "This anagram reveals who to speak to next: ";
const ANAGRAM_TEXT_BEGINNER = "The anagram reveals who to speak to next: ";

/** How many gravestones the Lumbridge graveyard has: one more once Jarvis is dead (varbit HW17_JARVIS_DEAD). */
function lumbridgeGravestoneCount(plugin: ClueScrollPlugin): string {
    switch (plugin.getClient().getVarbitValue(VarbitID.HW17_JARVIS_DEAD)) {
        case 1:
            return "20";
        default:
            return "19";
    }
}

type AnagramClueOptions = {
    itemId?: number;
    text?: string;
    textProvider?: Provider<string>;
    npc?: string;
    npcProvider?: Provider<string>;
    location?: WorldPoint;
    locationProvider?: Provider<WorldPoint | null>;
    area?: string;
    question?: string;
    answer?: string;
    answerProvider?: Provider<string>;
    objectId?: number;
};

/** Lombok's @Builder for AnagramClue, so the table reads as RuneLite's does. */
export class AnagramClueBuilder {
    private readonly options: AnagramClueOptions = {};

    itemId(id: number): this {
        this.options.itemId = id;
        return this;
    }

    text(text: string): this {
        this.options.text = text;
        return this;
    }

    textProvider(provider: Provider<string>): this {
        this.options.textProvider = provider;
        return this;
    }

    npc(npc: string): this {
        this.options.npc = npc;
        return this;
    }

    npcProvider(provider: Provider<string>): this {
        this.options.npcProvider = provider;
        return this;
    }

    location(location: WorldPoint): this {
        this.options.location = location;
        return this;
    }

    locationProvider(provider: Provider<WorldPoint | null>): this {
        this.options.locationProvider = provider;
        return this;
    }

    area(area: string): this {
        this.options.area = area;
        return this;
    }

    question(question: string): this {
        this.options.question = question;
        return this;
    }

    answer(answer: string): this {
        this.options.answer = answer;
        return this;
    }

    answerProvider(provider: Provider<string>): this {
        this.options.answerProvider = provider;
        return this;
    }

    objectId(id: number): this {
        this.options.objectId = id;
        return this;
    }

    build(): AnagramClue {
        return new AnagramClue(this.options);
    }
}

/** RuneLite's AnagramClue: an anagram of an NPC's name, where they stand, and their question's answer. */
export class AnagramClue extends ClueScroll implements NpcClueScroll, ObjectClueScroll {
    static builder(): AnagramClueBuilder {
        return new AnagramClueBuilder();
    }

    private readonly itemId: number;
    private readonly text: string | null;
    private readonly textProvider: Provider<string>;
    private readonly npcProvider: Provider<string>;
    private readonly locationProvider: Provider<WorldPoint | null> | null;
    private readonly area: string;
    private readonly question: string | null;
    private readonly answerProvider: Provider<string> | null;
    private readonly objectId: number;

    constructor(options: AnagramClueOptions) {
        super();
        this.itemId = options.itemId ?? -1;
        this.text = options.text ?? null;
        this.textProvider = options.textProvider ?? (() => options.text ?? "");
        this.npcProvider = options.npcProvider ?? (() => options.npc ?? "");
        this.locationProvider = options.locationProvider ?? (options.location ? () => options.location! : null);
        this.area = options.area ?? "";
        this.question = options.question ?? null;
        this.answerProvider = options.answerProvider ?? (options.answer !== undefined ? () => options.answer! : null);
        this.objectId = options.objectId ?? -1;
    }

    getItemId(): number {
        return this.itemId;
    }

    getText(): string | null {
        return this.text;
    }

    getArea(): string {
        return this.area;
    }

    getQuestion(): string | null {
        return this.question;
    }

    getLocation(plugin: ClueScrollPlugin): WorldPoint | null {
        return this.locationProvider ? this.locationProvider(plugin) : null;
    }

    getAnswer(plugin: ClueScrollPlugin): string | null {
        return this.answerProvider ? this.answerProvider(plugin) : null;
    }

    makeOverlayHint(panelComponent: PanelComponent, plugin: ClueScrollPlugin): void {
        panelComponent.getChildren().push(TitleComponent.builder().text("Anagram Clue").build());
        panelComponent.getChildren().push(LineComponent.builder().left("NPC:").build());
        panelComponent.getChildren().push(LineComponent.builder().left(this.npcProvider(plugin)).leftColor(TITLED_CONTENT_COLOR).build());
        panelComponent.getChildren().push(LineComponent.builder().left("Location:").build());
        panelComponent.getChildren().push(LineComponent.builder().left(this.getArea()).leftColor(TITLED_CONTENT_COLOR).build());
        const answer = this.getAnswer(plugin);
        if (answer !== null) {
            panelComponent.getChildren().push(LineComponent.builder().left("Answer:").build());
            panelComponent.getChildren().push(LineComponent.builder().left(answer).leftColor(TITLED_CONTENT_COLOR).build());
        }
        this.renderOverlayNote(panelComponent, plugin);
    }

    makeWorldOverlayHint(graphics: Graphics2D, plugin: ClueScrollPlugin): void {
        const location = this.getLocation(plugin);
        if (!location || !location.isInScene(plugin.getClient())) return;
        const scene = plugin.osrsClient;
        // Mark the NPC
        if (this.objectId === -1) {
            for (const npc of plugin.getNpcsToMark()) {
                OverlayUtil.renderActorOverlayImage(scene, graphics, npc, plugin.getClueScrollImage(), Color.ORANGE, IMAGE_Z_OFFSET);
            }
        }
        // Mark the game object
        if (this.objectId !== -1) {
            const mousePosition = plugin.getClient().getMouseCanvasPosition();
            for (const gameObject of plugin.getObjectsToMark()) {
                OverlayUtil.renderHoverableArea(graphics, gameObject.getClickbox(), mousePosition, CLICKBOX_FILL_COLOR, CLICKBOX_BORDER_COLOR, CLICKBOX_HOVER_BORDER_COLOR);
                OverlayUtil.renderImageLocationAt(scene, graphics, gameObject.getWorldLocation(), plugin.getClueScrollImage(), IMAGE_Z_OFFSET);
            }
        }
    }

    static forItemId(itemId: number): AnagramClue | null {
        for (const clue of AnagramClue.CLUES) if (clue.itemId === itemId) return clue;
        return null;
    }

    static forText(plugin: ClueScrollPlugin, text: string): AnagramClue | null {
        const lower = text.toLowerCase();
        for (const clue of AnagramClue.CLUES) {
            const clueText = clue.textProvider(plugin);
            if (
                lower === (ANAGRAM_TEXT + clueText).toLowerCase() ||
                lower === (ANAGRAM_TEXT_BEGINNER + clueText).toLowerCase() ||
                (clue.question !== null && lower === clue.question.toLowerCase())
            ) {
                return clue;
            }
        }
        return null;
    }

    getNpcs(plugin: ClueScrollPlugin): Array<string | null> {
        return [this.npcProvider(plugin)];
    }

    getObjectIds(): number[] {
        return [this.objectId];
    }

    getConfigKeys(): number[] {
        return [this.text !== null ? javaStringHashCode(this.text) : this.objectId];
    }

    /** RuneLite 1.13.6's table, row for row (a module constant: the rows build instances of this class). */
    static get CLUES(): readonly AnagramClue[] {
        return ANAGRAM_CLUES;
    }
}

export const ANAGRAM_CLUES: readonly AnagramClue[] = [
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP2)
            .text("A BAKER")
            .npc("Baraek")
            .location(new WorldPoint(3217, 3434, 0))
            .area("Varrock square")
            .question("How many stalls are there in Varrock Square?")
            .answer("5")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP4)
            .text("A BASIC ANTI POT")
            .npc("Captain Tobias")
            .location(new WorldPoint(3026, 3216, 0))
            .area("Port Sarim")
            .question("How many ships are there docked at Port Sarim currently?")
            .answer("6")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("A ELF KNOWS")
            .npc("Snowflake")
            .location(new WorldPoint(2872, 3934, 0))
            .area("Weiss")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP22)
            .text("A HEART")
            .npc("Aretha")
            .location(new WorldPoint(1814, 3851, 0))
            .area("Soul altar")
            .question("32 - 5x = 22, what is x?")
            .answer("2")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM018)
            .text("AHA JAR")
            .npc("Jaraah")
            .location(new WorldPoint(3359, 3276, 0))
            .area("Emir's Arena hospital")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM024)
            .text("ARC O LINE")
            .npc("Caroline")
            .location(new WorldPoint(2715, 3302, 0))
            .area("North Witchaven next to the row boat")
            .question("How many fishermen are there on the fishing platform?")
            .answer("11")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM007)
            .text("ARE COL")
            .npc("Oracle")
            .location(new WorldPoint(3013, 3501, 0))
            .area("Ice Mountain West of Edgeville")
            .question("If x is 15 and y is 3 what is 3x + y?")
            .answer("48")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP18)
            .text("ARMCHAIR THE PELT")
            .npc("Charlie the Tramp")
            .location(new WorldPoint(3209, 3392, 0))
            .area("South entrance of Varrock")
            .question("How many coins would I have if I have 0 coins and attempt to buy 10 loaves of bread for 3 coins each?")
            .answer("0")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_ELITE_ANAGRAM_EXP9)
            .text("AT HERG")
            .npc("Regath")
            .location(new WorldPoint(1719, 3723, 0))
            .area("General Store, Arceuus, Zeah")
            .question("What is -5 to the power of 2?")
            .answer("25")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM015)
            .text("A BAS")
            .npc("Saba")
            .location(new WorldPoint(2858, 3577, 0))
            .area("Death Plateau")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP16)
            .text("AREA CHEF TREK")
            .npc("Father Aereck")
            .location(new WorldPoint(3243, 3208, 0))
            .area("Lumbridge Church")
            .question("How many gravestones are in the church graveyard?")
            .answerProvider(lumbridgeGravestoneCount)
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM014)
            .text("BAIL TRIMS")
            .npc("Brimstail")
            .location(new WorldPoint(2402, 3419, 0))
            .area("West of Stronghold Slayer Cave")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP13)
            .text("BAKER CLIMB")
            .npc("Brambickle")
            .location(new WorldPoint(2783, 3861, 0))
            .area("Trollweiss mountain")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP9)
            .text("BLUE GRIM GUIDED")
            .npc("Lumbridge Guide")
            .location(new WorldPoint(3238, 3220, 0))
            .area("Lumbridge")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_HARD_ANAGRAM002)
            .text("BY LOOK")
            .npc("Bolkoy")
            .location(new WorldPoint(2526, 3162, 0))
            .area("Tree Gnome Village general store")
            .question("How many flowers are there in the clearing below this platform?")
            .answer("13")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP24)
            .text("CALAMARI MADE MUD")
            .npc("Madame Caldarium")
            .location(new WorldPoint(2553, 2868, 0))
            .area("Corsair Cove")
            .question("What is 3(5-3)?")
            .answer("6")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("CAR IF ICES")
            .npc("Sacrifice")
            .location(new WorldPoint(2209, 3056, 0))
            .area("Zul-Andra")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_ELITE_ANAGRAM_EXP1)
            .text("CAREER IN MOON")
            .npc("Oneiromancer")
            .location(new WorldPoint(2150, 3866, 0))
            .area("Astral altar")
            .question("How many Suqah inhabit Lunar isle?")
            .answer("25")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP23)
            .text("CLASH ION")
            .npc("Nicholas")
            .location(new WorldPoint(1841, 3803, 0))
            .area("North of Port Piscarilius fishing shop")
            .question("How many windows are in Tynan's shop?")
            .answer("4")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_HARD_ANAGRAM001)
            .text("C ON GAME HOC")
            .npc("Gnome Coach")
            .location(new WorldPoint(2395, 3486, 0))
            .area("Gnome Ball course")
            .question("How many gnomes on the Gnome ball field have red patches on their uniforms?")
            .answer("6")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_ELITE_ANAGRAM_EXP7)
            .text("COOL NERD")
            .npc("Old crone")
            .location(new WorldPoint(3462, 3557, 0))
            .area("East of the Slayer Tower")
            .question("What is the combined combat level of each species that live in Slayer tower?")
            .answer("619")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP1)
            .text("COPPER ORE CRYPTS")
            .npc("Prospector Percy")
            .location(new WorldPoint(3061, 3377, 0))
            .area("Motherlode Mine")
            .question("During a party, everyone shook hands with everybody else. There were 66 handshakes. How many people were at the party?")
            .answer("12")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP15)
            .text("DARN DRAKE")
            .npc("Daer Krand")
            .location(new WorldPoint(3728, 3302, 0))
            .area("Sisterhood Sanctuary (Slepe Dungeon, northeast of Nightmare Arena)")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("DED WAR")
            .npc("Edward")
            .location(new WorldPoint(3284, 3943, 0))
            .area("Inside Rogue's Castle")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP10)
            .text("DEKAGRAM")
            .npc("Dark Mage")
            .location(new WorldPoint(3039, 4834, 0))
            .area("Centre of the Abyss")
            .question("How many rifts are found here in the abyss?")
            .answer("13")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP6)
            .text("DO SAY MORE")
            .npc("Doomsayer")
            .location(new WorldPoint(3230, 3230, 0))
            .area("East of Lumbridge Castle")
            .question("What is 40 divided by 1/2 plus 15?")
            .answer("95")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("DIM THARN")
            .npc("Mandrith")
            .location(new WorldPoint(3182, 3946, 0))
            .area("Wilderness Resource Area")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_ELITE_ANAGRAM_EXP3)
            .text("DR HITMAN")
            .npc("Mandrith")
            .location(new WorldPoint(3182, 3946, 0))
            .area("Wilderness Resource Area")
            .question("How many scorpions live under the pit?")
            .answer("28")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP11)
            .text("DR WARDEN FUNK")
            .npc("Drunken Dwarf")
            .location(new WorldPoint(2913, 10221, 0))
            .area("East Side of Keldagrim")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP2)
            .text("DRAGONS LAMENT")
            .npc("Strange Old Man")
            .location(new WorldPoint(3564, 3288, 0))
            .area("Barrows")
            .question("One pipe fills a barrel in 1 hour while another pipe can fill the same barrel in 2 hours. How many minutes will it take to fill the tank if both pipes are used?")
            .answer("40")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM021)
            .text("DT RUN B")
            .npc("Brundt the Chieftain")
            .location(new WorldPoint(2658, 3670, 0))
            .area("Rellekka, main hall")
            .question("How many people are waiting for the next bard to perform?")
            .answer("5")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("DUO PLUG")
            .npc("Dugopul")
            .location(new WorldPoint(2803, 2744, 0))
            .area("Graveyard on Ape Atoll")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM003)
            .text("EEK ZERO OP")
            .npc("Zoo keeper")
            .location(new WorldPoint(2613, 3269, 0))
            .area("Ardougne Zoo")
            .question("How many animals in total are there in the zoo?")
            .answerProvider((plugin) => {
                // The quest state comes from a client script; when the VM is busy this frame, the
                // answer for an unfinished quest shows until it can run.
                let state: QuestState | null = null;
                try {
                    state = Quest.EAGLES_PEAK.getState(plugin.getClient());
                } catch {
                    // Can't run the script right now.
                }
                return state === QuestState.FINISHED ? "51" : "50";
            })
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM004)
            .text("EL OW")
            .npc("Lowe")
            .location(new WorldPoint(3233, 3423, 0))
            .area("Varrock archery store")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("FORLUN")
            .npc("Runolf")
            .location(new WorldPoint(2512, 10256, 0))
            .area("Miscellania & Etceteria Dungeon")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM011)
            .text("GOBLIN KERN")
            .npc("King Bolren")
            .location(new WorldPoint(2541, 3170, 0))
            .area("Tree Gnome Village")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM022)
            .text("GOT A BOY")
            .npc("Gabooty")
            .location(new WorldPoint(2790, 3066, 0))
            .area("Centre of Tai Bwo Wannai")
            .question("How many buildings are in the village?")
            .answer("11")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP1)
            .text("GOBLETS ODD TOES")
            .npc("Otto Godblessed")
            .location(new WorldPoint(2501, 3487, 0))
            .area("Otto's Grotto")
            .question("How many types of dragon are there beneath the whirlpool's cavern?")
            .answer("2")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM012)
            .text("HALT US")
            .npc("Luthas")
            .location(new WorldPoint(2938, 3152, 0))
            .area("Banana plantation, Karamja")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP9)
            .text("HEORIC")
            .npc("Eohric")
            .location(new WorldPoint(2897, 3565, 0))
            .area("Top floor of Burthorpe Castle")
            .question("King Arthur and Merlin sit down at the Round Table with 8 knights. How many degrees does each get?")
            .answer("36")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP14)
            .text("HIS PHOR")
            .npc("Horphis")
            .location(new WorldPoint(1639, 3812, 0))
            .area("Arceuus Library, Zeah")
            .question("On a scale of 1-10, how helpful is Logosia?")
            .answer("1")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP21)
            .text("I AM SIR")
            .npc("Marisi")
            .location(new WorldPoint(1737, 3557, 0))
            .area("Allotment patch, South of Hosidius chapel")
            .question("How many cities form the Kingdom of Great Kourend?")
            .answer("5")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM020)
            .text("ICY FE")
            .npc("Fycie")
            .location(new WorldPoint(2630, 2997, 0))
            .area("East Feldip Hills")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP11)
            .text("I DOOM ICON INN")
            .npc("Dominic Onion")
            .location(new WorldPoint(2609, 3116, 0))
            .area("Nightmare Zone")
            .question("How many reward points does a herb box cost?")
            .answer("9,500")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP3)
            .textProvider((plugin) => plugin.getClient().getVarbitValue(VarbitID.MM2_SLAYER_MASTER) == 0 ? "I EVEN" : "VESTE")
            .npcProvider((plugin) => plugin.getClient().getVarbitValue(VarbitID.MM2_SLAYER_MASTER) == 0 ? "Nieve" : "Steve")
            .location(new WorldPoint(2432, 3422, 0))
            .area("The slayer master in Gnome Stronghold")
            .question("How many farming patches are there in Gnome stronghold?")
            .answer("2")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("IM N ZEZIM")
            .npc("Immenizz")
            .location(new WorldPoint(2592, 4324, 0))
            .area("The Imp inside Puro-Puro")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP8)
            .text("KAY SIR")
            .npc("Sir Kay")
            .location(new WorldPoint(2760, 3496, 0))
            .area("The courtyard in Camelot Castle")
            .question("How many fountains are there within the grounds of Camelot castle?")
            .answer("6")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP6)
            .text("LEAKEY")
            .npc("Kaylee")
            .location(new WorldPoint(2957, 3370, 0))
            .area("Rising Sun Inn in Falador")
            .question("How many chairs are there in the Rising Sun?")
            .answer("18")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM026)
            .text("LARK IN DOG")
            .npc("King Roald")
            .location(new WorldPoint(3220, 3476, 0))
            .area("Ground floor of Varrock castle")
            .question("How many bookcases are there in the palace library?")
            .answer("24")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP12)
            .text("LOW LAG")
            .npc("Gallow")
            .location(new WorldPoint(1805, 3566, 0))
            .area("Vinery southeast of Hosidius")
            .question("How many vine patches can you find in this vinery?")
            .answer("12")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_ELITE_ANAGRAM_EXP8)
            .text("LADDER MEMO GUV")
            .npc("Guard Vemmeldo")
            .location(new WorldPoint(2447, 3418, 1))
            .area("Gnome Stronghold Bank")
            .question("How many magic trees can you find inside the Gnome Stronghold?")
            .answer("3")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("MAL IN TAU")
            .npc("Luminata")
            .location(new WorldPoint(3508, 3237, 0))
            .area("Near Burgh de Rott entrance")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_ELITE_ANAGRAM_EXP5)
            .text("MACHETE CLAM")
            .npc("Cam the Camel")
            .location(new WorldPoint(3300, 3231, 0))
            .area("Outside Emir's Arena")
            .question("How many items can carry water in Gielinor?")
            .answer("6")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM013)
            .text("ME IF")
            .npc("Femi")
            .location(new WorldPoint(2461, 3382, 0))
            .area("Gates of Tree Gnome Stronghold")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("MOLD LA RAN")
            .npc("Old Man Ral")
            .location(new WorldPoint(3602, 3209, 0))
            .area("Meiyerditch")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP5)
            .text("MOTHERBOARD")
            .npc("Brother Omad")
            .location(new WorldPoint(2606, 3211, 0))
            .area("Monastery south of Ardougne")
            .question("What is the next number? 12, 13, 15, 17, 111, 113, 117, 119, 123....?")
            .answer("129")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("MUS KIL READER")
            .npc("Radimus Erkle")
            .location(new WorldPoint(2726, 3368, 0))
            .area("Legends' Guild")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP14)
            .text("MY MANGLE LAL")
            .npc("Lammy Langle")
            .location(new WorldPoint(1688, 3540, 0))
            .area("Hosidius spirit tree patch")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_ELITE_ANAGRAM_EXP4)
            .text("NO OWNER")
            .npc("Oronwen")
            .location(new WorldPoint(2326, 3178, 0))
            .area("Lletya Seamstress shop in Lletya")
            .question("What is the minimum amount of quest points required to reach Lletya?")
            .answer("20")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM025)
            .text("NOD MED")
            .npc("Edmond")
            .location(new WorldPoint(2566, 3332, 0))
            .area("Behind the most NW house in East Ardougne")
            .question("How many pigeon cages are there around the back of Jerico's house?")
            .answer("3")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_HARD_ANAGRAM003)
            .text("O BIRDZ A ZANY EN PC")
            .npc("Cap'n Izzy No-Beard")
            .location(new WorldPoint(2807, 3191, 0))
            .area("Brimhaven Agility Arena")
            .question("How many Banana Trees are there in the plantation?")
            .answer("33")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM002)
            .text("OK CO")
            .npc("Cook")
            .location(new WorldPoint(3207, 3214, 0))
            .area("Ground floor of Lumbridge Castle")
            .question("How many cannons does Lumbridge Castle have?")
            .answer("9")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_ELITE_ANAGRAM_EXP10)
            .text("OUR OWN NEEDS")
            .npc("Nurse Wooned")
            .location(new WorldPoint(1511, 3619, 0))
            .area("Shayzien Infirmary")
            .question("How many wounded soldiers are there in the camp?")
            .answer("16")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP10)
            .text("PACINNG A TAIE")
            .npc("Captain Ginea")
            .location(new WorldPoint(1504, 3632, 0))
            .area("Tent east of Shayzien Encampment war tent")
            .question("1 soldier can deal with 6 lizardmen. How many soldiers do we need for an army of 678 lizardmen?")
            .answer("113")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP19)
            .text("PEAK REFLEX")
            .npc("Flax keeper")
            .location(new WorldPoint(2744, 3444, 0))
            .area("Flax field south of Seers Village")
            .question("If I have 1014 flax, and I spin a third of them into bowstring, how many flax do I have left?")
            .answer("676")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM010)
            .text("PEATY PERT")
            .npc("Party Pete")
            .location(new WorldPoint(3047, 3376, 0))
            .area("Falador Party Room")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP12)
            .text("QUIT HORRIBLE TYRANT")
            .npc("Brother Tranquility")
            .location(new WorldPoint(3681, 2963, 0))
            .area("Mos Le'Harmless or Harmony Island")
            .question("If I have 49 bottles of rum to share between 7 pirates, how many would each pirate get?")
            .answer("7")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP20)
            .text("QUE SIR")
            .npc("Squire")
            .location(new WorldPoint(2975, 3343, 0))
            .area("Falador Castle Courtyard")
            .question("White Knights of Falador are stronger than the Black Knights of the Kinshra. 2 White Knights can handle 3 Kinshra. How many White Knights would we need against an army of 981 Kinshra?")
            .answer("654")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM006)
            .text("R AK MI")
            .npc("Karim")
            .location(new WorldPoint(3273, 3181, 0))
            .area("Al Kharid Kebab shop")
            .question("I have 16 kebabs, I eat one myself and then share the rest equally between 3 friends. How many do they have each?")
            .answer("5")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP3)
            .text("RAT MAT WITHIN")
            .npc("Martin Thwait")
            .location(new WorldPoint(2906, 3537, 0))
            .area("Rogues' Den")
            .question("How many natural fires burn in Rogue's Den?")
            .answer("2")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP5)
            .text("RATAI")
            .npc("Taria")
            .location(new WorldPoint(2940, 3223, 0))
            .area("Rimmington bush patch")
            .question("How many buildings are there in Rimmington?")
            .answer("7")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP13)
            .text("R SLICER")
            .npc("Clerris")
            .location(new WorldPoint(1761, 3850, 0))
            .area("Arceuus mine, Zeah")
            .question("If I have 1,000 blood runes, and cast 131 ice barrage spells, how many blood runes do I have left?")
            .answer("738")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("RIP MAUL")
            .npc("Primula")
            .location(new WorldPoint(2454, 2853, 1))
            .area("Myth's Guild, first floor")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP17)
            .text("SAND NUT")
            .npc("Dunstan")
            .location(new WorldPoint(2919, 3574, 0))
            .area("Anvil in north east Burthorpe")
            .question("How much smithing experience does one receive for smelting a blurite bar?")
            .answer("8")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("SLAM DUSTER GRAIL")
            .npc("Guildmaster Lars")
            .location(new WorldPoint(1649, 3498, 0))
            .area("Woodcutting guild, Zeah")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP4)
            .text("SLIDE WOMAN")
            .npc("Wise Old Man")
            .location(new WorldPoint(3088, 3253, 0))
            .area("Draynor Village")
            .question("How many bookcases are in the Wise Old Man's house?")
            .answer("28")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_ELITE_ANAGRAM_EXP11)
            .text("SNAKES SO I SAIL")
            .npc("Lisse Isaakson")
            .location(new WorldPoint(2351, 3801, 0))
            .area("Neitiznot")
            .question("How many arctic logs are required to make a large fremennik round shield?")
            .answer("2")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP15)
            .text("TAMED ROCKS")
            .npc("Dockmaster")
            .location(new WorldPoint(1822, 3739, 0))
            .area("Port Piscarilius, NE of General store")
            .question("What is the cube root of 125?")
            .answer("5")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("TEN WIGS ON")
            .npc("Wingstone")
            .location(new WorldPoint(3389, 2877, 0))
            .area("Between Nardah & Agility Pyramid")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP7)
            .text("THICKNO")
            .npc("Hickton")
            .location(new WorldPoint(2822, 3442, 0))
            .area("Catherby fletching shop")
            .question("How many ranges are there in Catherby?")
            .answer("2")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("TWENTY CURE IRON")
            .npc("New Recruit Tony")
            .location(new WorldPoint(1503, 3553, 0))
            .area("Shayzien Graveyard")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_ELITE_ANAGRAM_EXP6)
            .text("UNLEASH NIGHT MIST")
            .npc("Sigli the Huntsman")
            .location(new WorldPoint(2660, 3654, 0))
            .area("Rellekka")
            .question("What is the combined slayer requirement of every monster in the slayer cave?")
            .answer("302")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP7)
            .text("VEIL VEDA")
            .npc("Evil Dave")
            .location(new WorldPoint(3079, 9892, 0))
            .area("Doris' basement, Edgeville")
            .question("What is 333 multiplied by 2?")
            .answer("666")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_HARD_ANAGRAM_EXP8)
            .text("WOO AN EGG KIWI")
            .npc("Awowogei")
            .objectId(ObjectID.MM_THRONE)
            .location(new WorldPoint(2802, 2765, 0))
            .area("Ape Atoll")
            .question("If I have 303 bananas, and share them between 31 friends evenly, only handing out full bananas. How many will I have left over?")
            .answer("24")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_ELITE_ANAGRAM_EXP2)
            .text("MAJORS LAVA BADS AIR")
            .npc("Ambassador Alvijar")
            .location(new WorldPoint(2736, 5351, 1))
            .area("Dorgesh-Kaan, NE Middle Level")
            .question("Double the miles before the initial Dorgeshuun veteran.")
            .answer("2505")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_BEGINNER)
            .text("AN EARL")
            .npc("Ranael")
            .location(new WorldPoint(3315, 3163, 0))
            .area("Al Kharid skirt shop")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_BEGINNER)
            .text("CARPET AHOY")
            .npc("Apothecary")
            .location(new WorldPoint(3195, 3404, 0))
            .area("Southwest Varrock")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_BEGINNER)
            .text("CHAR GAME DISORDER")
            .npc("Archmage Sedridor")
            .location(new WorldPoint(3102, 9570, 0))
            .area("Wizards' Tower basement")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_BEGINNER)
            .text("I CORD")
            .npc("Doric")
            .location(new WorldPoint(2951, 3450, 0))
            .area("North of Falador")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_BEGINNER)
            .text("IN BAR")
            .npc("Brian")
            .location(new WorldPoint(3026, 3246, 0))
            .area("Port Sarim battleaxe shop")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_BEGINNER)
            .text("RAIN COVE")
            .npc("Veronica")
            .location(new WorldPoint(3110, 3330, 0))
            .area("Outside Draynor Manor")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_BEGINNER)
            .text("RUG DETER")
            .npc("Gertrude")
            .location(new WorldPoint(3151, 3412, 0))
            .area("West of Varrock, south of the Cooks' Guild")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_BEGINNER)
            .text("SIR SHARE RED")
            .npc("Hairdresser")
            .location(new WorldPoint(2944, 3381, 0))
            .area("Western Falador")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_BEGINNER)
            .text("TAUNT ROOF")
            .npc("Fortunato")
            .location(new WorldPoint(3080, 3250, 0))
            .area("Draynor Village Market")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_ANAGRAM023)
            .text("HICK JET")
            .npc("Jethick")
            .location(new WorldPoint(2541, 3305, 0))
            .area("West Ardougne")
            .question("How many graves are there in the city graveyard?")
            .answer("38")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("RUE GO")
            .npc("Goreu")
            .location(new WorldPoint(2335, 3162, 0))
            .area("Lletya")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MASTER)
            .text("BRUCIE CATNAP")
            .npc("Captain Bruce")
            .location(new WorldPoint(1529, 3567, 0))
            .area("East of Shayzien Graveyard")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_CIPHER007)
            .text("UESNKRL NRIEDDO")
            .npc("Drunken soldier")
            .location(new WorldPoint(1551, 3565, 0))
            .area("Shayzien pub")
            .question("If 13 Shayzien Soldiers kill 46 Lizardmen each in a day, how many Lizardmen have they killed in total in a single day?")
            .answer("598")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_VM01)
            .text("LAME T")
            .npc("Metla")
            .location(new WorldPoint(1742, 2977, 0))
            .area("Stonecutter Outpost")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_ELITE_ANAGRAM_EXP12)
            .text("CIRR JAD")
            .npc("Jardric")
            .locationProvider((plugin) => {
                const q = plugin.getClient().getVarbitValue(VarbitID.DS2);
                return q <= 60
                    ? new WorldPoint(3719, 3810, 0) // Museum camp
                    : new WorldPoint(3661, 3849, 0); // West side of Fossil Island
            })
            .area("Fossil Island")
            .question("What is 3 to the power of 0?")
            .answer("1")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_VM02)
            .text("CUTE HI")
            .npc("Teicuh")
            .location(new WorldPoint(1212, 3119, 0))
            .area("Tal Teklan")
            .question("If a death rune costs 220 coins, an air rune costs 3 coins, and a water rune costs 4 coins, how many coins do I need to cast Water Blast 17 times?")
            .answer("4097")
            .build(),
        AnagramClue.builder()
            .itemId(ItemID.TRAIL_MEDIUM_ANAGRAM_SAIL)
            .text("NOT RAG")
            .npc("Elder Torgan")
            .location(new WorldPoint(3143, 2423, 0))
            .area("The Summer Shore")
            .build()
];
