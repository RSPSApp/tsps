/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
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
import { TITLED_CONTENT_COLOR } from "../ClueScrollColors";
import type { ClueScrollPlugin } from "../ClueScrollPlugin";
import { javaStringHashCode } from "./ClueKeys";
import { ClueScroll } from "./ClueScroll";
import type { LocationClueScroll } from "./ClueScrollTypes";

/** RuneLite's FairyRingClue: a fairy ring code and the tile to dig on after it. */
export class FairyRingClue extends ClueScroll implements LocationClueScroll {
    constructor(
        private readonly itemId: number,
        private readonly text: string,
        private readonly location: WorldPoint,
    ) {
        super();
        this.setRequiresSpade(true);
    }

    getItemId(): number {
        return this.itemId;
    }

    getText(): string {
        return this.text;
    }

    getLocation(_plugin: ClueScrollPlugin): WorldPoint {
        return this.location;
    }

    makeOverlayHint(panelComponent: PanelComponent, plugin: ClueScrollPlugin): void {
        panelComponent.getChildren().push(TitleComponent.builder().text("Fairy Ring Clue").build());
        panelComponent.getChildren().push(LineComponent.builder().left("Code:").build());
        panelComponent.getChildren().push(LineComponent.builder().left(this.text.slice(0, 5)).leftColor(TITLED_CONTENT_COLOR).build());
        panelComponent.getChildren().push(LineComponent.builder().left("Travel to the fairy ring to see where to dig.").build());
        this.renderOverlayNote(panelComponent, plugin);
    }

    makeWorldOverlayHint(graphics: Graphics2D, plugin: ClueScrollPlugin): void {
        if (!this.location.isInScene(plugin.getClient())) return;
        OverlayUtil.renderTileOverlay(plugin.osrsClient, graphics, this.location, plugin.getSpadeImage(), Color.ORANGE);
    }

    static forItemId(itemId: number): FairyRingClue | null {
        for (const clue of FairyRingClue.CLUES) if (clue.itemId === itemId) return clue;
        return null;
    }

    getConfigKeys(): number[] {
        return [javaStringHashCode(this.text)];
    }

    static forText(text: string): FairyRingClue | null {
        const lower = text.toLowerCase();
        for (const clue of FairyRingClue.CLUES) if (clue.text.toLowerCase() === lower) return clue;
        return null;
    }

    /** RuneLite 1.13.6's table, row for row (a module constant: the rows build instances of this class). */
    static get CLUES(): readonly FairyRingClue[] {
        return FAIRY_RING_CLUES;
    }
}

export const FAIRY_RING_CLUES: readonly FairyRingClue[] = [
        new FairyRingClue(ItemID.TRAIL_CLUE_HARD_FAIRY002, "A I R 2 3 3 1", new WorldPoint(2702, 3246, 0)),
        new FairyRingClue(ItemID.TRAIL_CLUE_HARD_FAIRY001, "A I Q 0 4 4 0", new WorldPoint(3000, 3110, 0)),
        new FairyRingClue(ItemID.TRAIL_HARD_FAIRY_VM01, "A J P 3 0 1 5", new WorldPoint(1646, 3012, 0)),
        new FairyRingClue(ItemID.TRAIL_CLUE_HARD_FAIRY003, "A L P 1 1 4 0", new WorldPoint(2504, 3633, 0)),
        new FairyRingClue(ItemID.TRAIL_CLUE_HARD_FAIRY006, "B L P 6 2 0 0", new WorldPoint(2439, 5132, 0)),
        new FairyRingClue(ItemID.TRAIL_CLUE_HARD_FAIRY005, "B J R 1 1 2 3", new WorldPoint(2648, 4729, 0)),
        new FairyRingClue(ItemID.TRAIL_CLUE_HARD_FAIRY004, "B I P 7 0 1 3", new WorldPoint(3407, 3330, 0)),
        new FairyRingClue(ItemID.TRAIL_CLUE_HARD_FAIRY010, "C I S 0 0 0 9", new WorldPoint(1630, 3868, 0)),
        new FairyRingClue(ItemID.TRAIL_CLUE_HARD_FAIRY007, "C K P 0 2 2 4", new WorldPoint(2073, 4846, 0)),
        new FairyRingClue(ItemID.TRAIL_CLUE_HARD_FAIRY008, "D I P 8 5 1 1", new WorldPoint(3041, 4770, 0)),
        new FairyRingClue(ItemID.TRAIL_CLUE_HARD_FAIRY009, "D K S 2 3 1 0", new WorldPoint(2747, 3720, 0))
];
