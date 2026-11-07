/*
 * Copyright (c) 2019, Hydrox6 <ikada@protonmail.ch>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { Color } from "@runelite/awt/Color";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import * as ItemID from "@runelite/api/gameval/ItemID";
import { LineComponent } from "@runelite/client/ui/overlay/components/LineComponent";
import type { PanelComponent } from "@runelite/client/ui/overlay/components/PanelComponent";
import { TitleComponent } from "@runelite/client/ui/overlay/components/TitleComponent";
import { OverlayUtil } from "@runelite/client/ui/overlay/OverlayUtil";
import { IMAGE_Z_OFFSET, TITLED_CONTENT_COLOR } from "../ClueScrollColors";
import type { ClueScrollPlugin } from "../ClueScrollPlugin";
import { ClueScroll } from "./ClueScroll";
import type { LocationClueScroll, NpcClueScroll } from "./ClueScrollTypes";

const LOCATION = new WorldPoint(2990, 3384, 0);
const CECILIA = "Cecilia";
const SONG_PATTERN = /<col=ffffff>([A-Za-z !&',.]+)<\/col>/;

/** RuneLite's MusicClue: play a song to Cecilia in Falador Park. */
export class MusicClue extends ClueScroll implements NpcClueScroll, LocationClueScroll {
    constructor(
        private readonly itemId: number,
        private readonly song: string,
    ) {
        super();
    }

    getItemId(): number {
        return this.itemId;
    }

    getSong(): string {
        return this.song;
    }

    makeOverlayHint(panelComponent: PanelComponent, _plugin: ClueScrollPlugin): void {
        panelComponent.getChildren().push(TitleComponent.builder().text("Music Clue").build());
        panelComponent.getChildren().push(LineComponent.builder().left("NPC:").build());
        panelComponent.getChildren().push(LineComponent.builder().left(CECILIA).leftColor(TITLED_CONTENT_COLOR).build());
        panelComponent.getChildren().push(LineComponent.builder().left("Location:").build());
        panelComponent.getChildren().push(LineComponent.builder().left("Falador Park").leftColor(TITLED_CONTENT_COLOR).build());
        panelComponent.getChildren().push(LineComponent.builder().left("Song:").build());
        panelComponent.getChildren().push(LineComponent.builder().left(this.song).leftColor(TITLED_CONTENT_COLOR).build());
    }

    makeWorldOverlayHint(graphics: Graphics2D, plugin: ClueScrollPlugin): void {
        if (!LOCATION.isInScene(plugin.getClient())) return;
        for (const npc of plugin.getNpcsToMark()) {
            OverlayUtil.renderActorOverlayImage(plugin.osrsClient, graphics, npc, plugin.getClueScrollImage(), Color.ORANGE, IMAGE_Z_OFFSET);
        }
    }

    static forItemId(itemId: number): MusicClue | null {
        for (const clue of MusicClue.CLUES) if (clue.itemId === itemId) return clue;
        return null;
    }

    static forSong(song: string): MusicClue | null {
        for (const clue of MusicClue.CLUES) if (clue.song === song) return clue;
        return null;
    }

    getNpcs(_plugin: ClueScrollPlugin): Array<string | null> {
        return [CECILIA];
    }

    /** The song named in the scroll's white tag; a song the table lacks still gets a clue. */
    static forText(text: string): MusicClue | null {
        const match = SONG_PATTERN.exec(text);
        if (!match) return null;
        const song = match[1];
        return MusicClue.forSong(song) ?? new MusicClue(-1, song);
    }

    getLocation(_plugin: ClueScrollPlugin): WorldPoint {
        return LOCATION;
    }

    /** RuneLite 1.13.6's table, row for row (a module constant: the rows build instances of this class). */
    static get CLUES(): readonly MusicClue[] {
        return MUSIC_CLUES;
    }
}

export const MUSIC_CLUES: readonly MusicClue[] = [
        new MusicClue(ItemID.TRAIL_CLUE_EASY_MUSIC001, "Vision"),
        new MusicClue(ItemID.TRAIL_CLUE_EASY_MUSIC002, "The Forlorn Homestead"),
        new MusicClue(ItemID.TRAIL_CLUE_EASY_MUSIC003, "Tiptoe"),
        new MusicClue(ItemID.TRAIL_CLUE_EASY_MUSIC004, "Rugged Terrain"),
        new MusicClue(ItemID.TRAIL_CLUE_EASY_MUSIC005, "On the Shore"),
        new MusicClue(ItemID.TRAIL_CLUE_EASY_MUSIC006, "Alone"),
        new MusicClue(ItemID.TRAIL_CLUE_MEDIUM_MUSIC001, "Karamja Jam"),
        new MusicClue(ItemID.TRAIL_CLUE_MEDIUM_MUSIC002, "Faerie"),
        new MusicClue(ItemID.TRAIL_CLUE_MEDIUM_MUSIC003, "Forgotten"),
        new MusicClue(ItemID.TRAIL_CLUE_MEDIUM_MUSIC004, "Catch Me If You Can"),
        new MusicClue(ItemID.TRAIL_CLUE_MEDIUM_MUSIC005, "Cave of Beasts"),
        new MusicClue(ItemID.TRAIL_CLUE_MEDIUM_MUSIC006, "Devils May Care"),
        new MusicClue(ItemID.TRAIL_CLUE_HARD_MUSIC001, "Scorpia Dances"),
        new MusicClue(ItemID.TRAIL_CLUE_HARD_MUSIC002, "Complication"),
        new MusicClue(ItemID.TRAIL_CLUE_HARD_MUSIC003, "Subterranea"),
        new MusicClue(ItemID.TRAIL_CLUE_HARD_MUSIC004, "Little Cave of Horrors"),
        new MusicClue(ItemID.TRAIL_CLUE_HARD_MUSIC005, "Roc and Roll"),
        new MusicClue(ItemID.TRAIL_CLUE_HARD_MUSIC006, "La Mort"),
        new MusicClue(ItemID.TRAIL_CLUE_HARD_MUSIC007, "Fossilised"),
        new MusicClue(ItemID.TRAIL_CLUE_HARD_MUSIC008, "Hells Bells"),
        new MusicClue(ItemID.TRAIL_CLUE_HARD_MUSIC009, "Regal Pomp"),
        new MusicClue(ItemID.TRAIL_HARD_MUSIC_VM01, "The Moons of Ruin"),
        new MusicClue(ItemID.TRAIL_CLUE_ELITE_MUSIC001, "Lament for the Hallowed"),
        new MusicClue(ItemID.TRAIL_CLUE_ELITE_MUSIC002, "The Pharaoh")
];
