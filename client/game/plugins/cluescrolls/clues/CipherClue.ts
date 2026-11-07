/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { Color } from "@runelite/awt/Color";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import type { NPCComposition } from "@runelite/api/Client";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import * as ItemID from "@runelite/api/gameval/ItemID";
import * as NpcID from "@runelite/api/gameval/NpcID";
import { Quest } from "@runelite/api/Quest";
import { QuestState } from "@runelite/api/QuestState";
import { LineComponent } from "@runelite/client/ui/overlay/components/LineComponent";
import type { PanelComponent } from "@runelite/client/ui/overlay/components/PanelComponent";
import { TitleComponent } from "@runelite/client/ui/overlay/components/TitleComponent";
import { OverlayUtil } from "@runelite/client/ui/overlay/OverlayUtil";
import { IMAGE_Z_OFFSET, TITLED_CONTENT_COLOR } from "../ClueScrollColors";
import type { ClueScrollPlugin } from "../ClueScrollPlugin";
import { javaStringHashCode } from "./ClueKeys";
import { ClueScroll } from "./ClueScroll";
import type { LocationClueScroll, NpcClueScroll } from "./ClueScrollTypes";

type Provider<T> = (plugin: ClueScrollPlugin) => T;

/** Eluned moves to Prifddinas once Song of the Elves is done. */
function isElunedInPrifddinas(plugin: ClueScrollPlugin): boolean {
    // The quest state comes from a client script; when the VM is busy this frame, Lletya it is.
    try {
        return Quest.SONG_OF_THE_ELVES.getState(plugin.getClient()) === QuestState.FINISHED;
    } catch {
        return false;
    }
}

type CipherClueOptions = {
    itemId?: number;
    text?: string;
    npc?: number;
    location?: WorldPoint;
    locationProvider?: Provider<WorldPoint>;
    area?: string;
    areaProvider?: Provider<string>;
    question?: string;
    answer?: string;
};

/** Lombok's @Builder for CipherClue, so the table reads as RuneLite's does. */
export class CipherClueBuilder {
    private readonly options: CipherClueOptions = {};

    itemId(id: number): this {
        this.options.itemId = id;
        return this;
    }

    text(text: string): this {
        this.options.text = text;
        return this;
    }

    npc(npcId: number): this {
        this.options.npc = npcId;
        return this;
    }

    location(location: WorldPoint): this {
        this.options.location = location;
        return this;
    }

    locationProvider(provider: Provider<WorldPoint>): this {
        this.options.locationProvider = provider;
        return this;
    }

    area(area: string): this {
        this.options.area = area;
        return this;
    }

    areaProvider(provider: Provider<string>): this {
        this.options.areaProvider = provider;
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

    build(): CipherClue {
        return new CipherClue(this.options);
    }
}

/** RuneLite's CipherClue: a Caesar cipher of an NPC's name, who they are, where, and their question's answer. */
export class CipherClue extends ClueScroll implements NpcClueScroll, LocationClueScroll {
    static builder(): CipherClueBuilder {
        return new CipherClueBuilder();
    }

    private readonly itemId: number;
    private readonly text: string;
    private readonly npc: number;
    private readonly locationProvider: Provider<WorldPoint | null>;
    private readonly areaProvider: Provider<string>;
    private readonly question: string | null;
    private readonly answer: string | null;

    constructor(options: CipherClueOptions) {
        super();
        this.itemId = options.itemId ?? -1;
        this.text = `The cipher reveals who to speak to next: ${options.text ?? ""}`;
        this.npc = options.npc ?? -1;
        this.locationProvider = options.locationProvider ?? (() => options.location ?? null);
        this.areaProvider = options.areaProvider ?? (() => options.area ?? "");
        this.question = options.question ?? null;
        this.answer = options.answer ?? null;
    }

    getItemId(): number {
        return this.itemId;
    }

    getText(): string {
        return this.text;
    }

    getQuestion(): string | null {
        return this.question;
    }

    getAnswer(): string | null {
        return this.answer;
    }

    getLocation(plugin: ClueScrollPlugin): WorldPoint | null {
        return this.locationProvider(plugin);
    }

    getArea(plugin: ClueScrollPlugin): string {
        return this.areaProvider(plugin);
    }

    makeOverlayHint(panelComponent: PanelComponent, plugin: ClueScrollPlugin): void {
        panelComponent.getChildren().push(TitleComponent.builder().text("Cipher Clue").build());
        const npc = this.getNpcComposition(plugin);
        if (npc) {
            panelComponent.getChildren().push(LineComponent.builder().left("NPC:").build());
            panelComponent.getChildren().push(LineComponent.builder().left(npc.getName()).leftColor(TITLED_CONTENT_COLOR).build());
        }
        panelComponent.getChildren().push(LineComponent.builder().left("Location:").build());
        panelComponent.getChildren().push(LineComponent.builder().left(this.getArea(plugin)).leftColor(TITLED_CONTENT_COLOR).build());
        if (this.answer !== null) {
            panelComponent.getChildren().push(LineComponent.builder().left("Answer:").build());
            panelComponent.getChildren().push(LineComponent.builder().left(this.answer).leftColor(TITLED_CONTENT_COLOR).build());
        }
        this.renderOverlayNote(panelComponent, plugin);
    }

    makeWorldOverlayHint(graphics: Graphics2D, plugin: ClueScrollPlugin): void {
        const location = this.getLocation(plugin);
        if (!location || !location.isInScene(plugin.getClient())) return;
        for (const npc of plugin.getNpcsToMark()) {
            OverlayUtil.renderActorOverlayImage(plugin.osrsClient, graphics, npc, plugin.getClueScrollImage(), Color.ORANGE, IMAGE_Z_OFFSET);
        }
    }

    static forItemId(itemId: number): CipherClue | null {
        for (const clue of CipherClue.CLUES) if (clue.itemId === itemId) return clue;
        return null;
    }

    static forText(text: string): CipherClue | null {
        const lower = text.toLowerCase();
        for (const clue of CipherClue.CLUES) {
            if (lower === clue.text.toLowerCase() || (clue.question !== null && lower === clue.question.toLowerCase())) return clue;
        }
        return null;
    }

    getNpcs(plugin: ClueScrollPlugin): Array<string | null> {
        return [this.getNpcComposition(plugin)?.getName() ?? null];
    }

    getConfigKeys(): number[] {
        return [javaStringHashCode(this.text)];
    }

    /** The NPC's type after the player's var transforms (a base multi-NPC becomes who they see). */
    private getNpcComposition(plugin: ClueScrollPlugin): NPCComposition | null {
        if (this.npc === -1) return null;
        return plugin.getClient().getNpcDefinition(this.npc);
    }

    /** RuneLite 1.13.6's table, row for row (a module constant: the rows build instances of this class). */
    static get CLUES(): readonly CipherClue[] {
        return CIPHER_CLUES;
    }
}

export const CIPHER_CLUES: readonly CipherClue[] = [
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_CIPHER004)
            .text("BMJ UIF LFCBC TFMMFS")
            .npc(NpcID.FEUD_KEBABMAN_MULTI) // base npc for Ali or Isma'il the Kebab seller
            .location(new WorldPoint(3354, 2974, 0))
            .area("Pollnivneach")
            .question("How many coins would you need to purchase 133 kebabs from me?")
            .answer("399")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_CIPHER006)
            .text("GUHCHO")
            .npc(NpcID.PRIESTPERILTRAPPEDMONK_VIS)
            .location(new WorldPoint(3440, 9895, 0))
            .area("Paterdomus")
            .question("Please solve this for x: 7x - 28=21")
            .answer("7")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_CIPHER005)
            .text("HQNM LZM STSNQ")
            .npc(NpcID.IRONMAN_TUTOR_1)
            .location(new WorldPoint(3227, 3227, 0))
            .area("Outside Lumbridge castle")
            .question("How many snakeskins are needed in order to craft 44 boots, 29 vambraces and 34 bandanas?")
            .answer("666")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_HARD_CIPHER004)
            .text("ZHLUG ROG PDQ")
            .npc(NpcID.KALPHITE_OLDMAN)
            .location(new WorldPoint(3224, 3112, 0))
            .area("Kalphite Lair entrance. Fairy ring BIQ")
            .question("SIX LEGS! All of them have 6! There are 25 of them! How many legs?")
            .answer("150")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_CIPHER003)
            .text("ECRVCKP MJCNGF")
            .npc(NpcID.PISCARILIUS_CAPTAIN_KHALED_DEFAULT)
            .location(new WorldPoint(1845, 3754, 0))
            .area("Large eastern building in Port Piscarilius")
            .question("How many fishing cranes can you find around here?")
            .answer("5")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_HARD_CIPHER001)
            .text("OVEXON")
            .npc(NpcID.ROVING_FEMALE_WOODELF_TEMP_1)
            .locationProvider((plugin) => isElunedInPrifddinas(plugin) ? new WorldPoint(3229, 6062, 0) : new WorldPoint(2289, 3144, 0))
            .areaProvider((plugin) => isElunedInPrifddinas(plugin) ? "Prifddinas" : "Outside Lletya")
            .question("A question on elven crystal math. I have 5 and 3 crystals, large and small respectively. A large crystal is worth 10,000 coins and a small is worth but 1,000. How much are all my crystals worth?")
            .answer("53,000")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_HARD_CIPHER005)
            .text("VTYR APCNTGLW")
            .npc(NpcID.KING_PERCIVAL)
            .location(new WorldPoint(2634, 4682, 1))
            .area("Fisher Realm, first floor. Fairy ring BJR")
            .question("How many cannons are on this here castle?")
            .answer("5")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_HARD_CIPHER002)
            .text("UZZU MUJHRKYYKJ")
            .npc(NpcID.BRUT_OTTO)
            .location(new WorldPoint(2501, 3487, 0))
            .area("Otto's Grotto")
            .question("How many pyre sites are found around this lake?")
            .answer("3")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_CIPHER002)
            .text("XJABSE USBJCPSO")
            .npc(NpcID.TRAIBORN)
            .location(new WorldPoint(3112, 3162, 0))
            .area("First floor of Wizards Tower. Fairy ring DIS")
            .question("How many air runes would I need to cast 630 wind waves?")
            .answer("3150")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_HARD_CIPHER006)
            .text("HCKTA IQFHCVJGT")
            .npc(NpcID.FAIRY_GODFATHER2)
            .location(new WorldPoint(2446, 4428, 0))
            .area("Zanaris throne room")
            .question("There are 3 inputs and 4 letters on each ring How many total individual fairy ring codes are possible?")
            .answer("64")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_HARD_CIPHER003)
            .text("ZSBKDO ZODO")
            .npc(NpcID.DEAL_PETE)
            .location(new WorldPoint(3680, 3537, 0))
            .area("Dock northeast of the Ectofuntus")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_HARD_CIPHER007)
            .text("GBJSZ RVFFO")
            .npc(NpcID.FAIRY_QUEEN)
            .location(new WorldPoint(2347, 4435, 0))
            .area("Fairy Resistance Hideout")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_MEDIUM_CIPHER001)
            .text("QSPGFTTPS HSBDLMFCPOF")
            .npc(NpcID.ARCEUUS_LIBRARY_CUSTOMER_3)
            .location(new WorldPoint(1625, 3802, 0))
            .area("Ground floor of Arceuus Library")
            .question("How many round tables can be found on this floor of the library?")
            .answer("9")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_HARD_CIPHER009)
            .text("IWPPLQTP")
            .npc(NpcID.GUNNJORN)
            .location(new WorldPoint(2541, 3548, 0))
            .area("Barbarian Outpost Agility course")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_CLUE_HARD_CIPHER008)
            .text("BSOPME MZETQPS")
            .npc(NpcID.SWAN_ARNOLD)
            .location(new WorldPoint(2329, 3689, 0))
            .area("Piscatoris Fishing Colony general store/bank")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.CLUEQUEST_CLUE1)
            .text("ESBZOPS QJH QFO")
            .location(new WorldPoint(3077, 3260, 0))
            .area("Inside of Martin the Master Gardener's pig pen in Draynor Village.")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_HARD_CIPHER_VM01)
            .text("BXJA UNJMNA YRCAR")
            .npc(NpcID.HUNTER_GUILD_PITRI)
            .location(new WorldPoint(1559, 3045, 0))
            .area("Top of the Hunter Guild")
            .build(),
        CipherClue.builder()
            .itemId(ItemID.TRAIL_HARD_CIPHER_VM02)
            .text("YAROYGR")
            .npc(NpcID.KASTORI_FISHING_TRADER)
            .location(new WorldPoint(1376, 3037, 0))
            .area("Kastori")
            .question("If a fish can feed four people, and I'm hosting 15 guests, how many whole fish will I need?")
            .answer("4")
            .build()
];
