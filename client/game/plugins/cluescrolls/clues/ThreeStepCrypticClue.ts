/*
 * Copyright (c) 2018, Eadgars Ruse <https://github.com/Eadgars-Ruse>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import type { WorldPoint } from "@runelite/api/coords/WorldPoint";
import type { ItemContainer } from "@runelite/api/Item";
import * as InventoryID from "@runelite/api/gameval/InventoryID";
import * as ItemID from "@runelite/api/gameval/ItemID";
import { LineComponent } from "@runelite/client/ui/overlay/components/LineComponent";
import type { PanelComponent } from "@runelite/client/ui/overlay/components/PanelComponent";
import { TitleComponent } from "@runelite/client/ui/overlay/components/TitleComponent";
import { Text } from "@runelite/client/util/Text";
import { TITLED_CONTENT_COLOR } from "../ClueScrollColors";
import type { ClueScrollPlugin } from "../ClueScrollPlugin";
import { ClueScroll } from "./ClueScroll";
import type { LocationsClueScroll, NpcClueScroll, ObjectClueScroll } from "./ClueScrollTypes";
import { CrypticClue } from "./CrypticClue";

/** One part of the master clue: the cryptic it is, and whether its torn part has been found. */
export type ClueStep = { clue: CrypticClue; done: boolean };

/**
 * The master clue's three cryptics on one scroll (RuneLite's ThreeStepCrypticClue): struck-through
 * parts are done; finding a torn part in the inventory ticks its step off.
 */
export class ThreeStepCrypticClue extends ClueScroll implements ObjectClueScroll, NpcClueScroll, LocationsClueScroll {
    /** The three cryptics from the raw scroll text, or null when fewer than three are recognised. */
    static forText(plainText: string, text: string): ThreeStepCrypticClue | null {
        const steps: ClueStep[] = [];
        for (const part of text.split(/<br>\s*<br>/)) {
            const isDone = part.includes("<str>");
            const rawText = Text.sanitizeMultilineText(part).toLowerCase();
            for (const clue of CrypticClue.CLUES) {
                if (rawText !== clue.getText().toLowerCase()) continue;
                steps.push({ clue, done: isDone });
                break;
            }
        }
        if (steps.length < 3) return null;
        return new ThreeStepCrypticClue(steps, plainText);
    }

    private constructor(
        private readonly clueSteps: ClueStep[],
        private readonly text: string,
    ) {
        super();
    }

    getClueSteps(): ClueStep[] {
        return this.clueSteps;
    }

    getText(): string {
        return this.text;
    }

    makeOverlayHint(panelComponent: PanelComponent, plugin: ClueScrollPlugin): void {
        panelComponent.setPreferredSize({ width: 200, height: 0 });
        this.clueSteps.forEach((step, i) => {
            if (step.done) return;
            panelComponent.getChildren().push(TitleComponent.builder().text(`Cryptic Clue #${i + 1}`).build());
            panelComponent.getChildren().push(LineComponent.builder().left("Solution:").build());
            panelComponent.getChildren().push(LineComponent.builder().left(step.clue.getSolution(plugin)).leftColor(TITLED_CONTENT_COLOR).build());
            step.clue.renderOverlayNote(panelComponent, plugin);
        });
    }

    makeWorldOverlayHint(graphics: Graphics2D, plugin: ClueScrollPlugin): void {
        for (const step of this.clueSteps) if (!step.done) step.clue.makeWorldOverlayHint(graphics, plugin);
    }

    /** Ticks off the step whose torn part is in the backpack; true when one changed. */
    update(containerId: number, itemContainer: ItemContainer): boolean {
        if (containerId !== InventoryID.INV) return false;
        return this.checkForPart(itemContainer, ItemID.TRAIL_MASTER_PART1, 0) || this.checkForPart(itemContainer, ItemID.TRAIL_MASTER_PART2, 1) || this.checkForPart(itemContainer, ItemID.TRAIL_MASTER_PART3, 2);
    }

    private checkForPart(itemContainer: ItemContainer, clueScrollPart: number, index: number): boolean {
        if (!itemContainer.contains(clueScrollPart)) return false;
        const step = this.clueSteps[index];
        if (step.done) return false;
        step.done = true;
        return true;
    }

    reset(): void {
        for (const step of this.clueSteps) step.done = false;
    }

    getLocation(_plugin: ClueScrollPlugin): WorldPoint | null {
        return null;
    }

    getLocations(plugin: ClueScrollPlugin): WorldPoint[] {
        return this.clueSteps.filter((s) => !s.done).map((s) => s.clue.getLocation(plugin)).filter((p): p is WorldPoint => p !== null);
    }

    getNpcs(plugin: ClueScrollPlugin): Array<string | null> {
        return this.clueSteps.filter((s) => !s.done).map((s) => s.clue.getNpc(plugin));
    }

    getObjectIds(): number[] {
        return this.clueSteps.filter((s) => !s.done).map((s) => s.clue.getObjectId());
    }

    getConfigKeys(): number[] {
        return this.clueSteps.flatMap((s) => s.clue.getConfigKeys());
    }
}
