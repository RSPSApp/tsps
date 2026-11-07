/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import { LineComponent } from "@runelite/client/ui/overlay/components/LineComponent";
import type { PanelComponent } from "@runelite/client/ui/overlay/components/PanelComponent";
import { TITLED_CONTENT_COLOR } from "../ClueScrollColors";
import type { ClueScrollPlugin } from "../ClueScrollPlugin";
import type { Enemy } from "./Enemy";

/** What `renderOverlayNote` needs from the plugin: the player's saved note for a clue key. */
export interface ClueNoteSource {
    getClueNote(key: number): string | null;
}

/**
 * A clue the plugin can solve (RuneLite's ClueScroll): what it needs (a spade, a light), the
 * enemy it may spawn, and how it draws its panel and world hints.
 */
export abstract class ClueScroll {
    private requiresSpade = false;
    private requiresLight = false;
    private firePitVarbitId = -1;
    private enemy: Enemy | null = null;

    isRequiresSpade(): boolean {
        return this.requiresSpade;
    }

    protected setRequiresSpade(requiresSpade: boolean): void {
        this.requiresSpade = requiresSpade;
    }

    isRequiresLight(): boolean {
        return this.requiresLight;
    }

    protected setRequiresLight(requiresLight: boolean): void {
        this.requiresLight = requiresLight;
    }

    /** The varbit of a fire pit that lights the area, or -1 (the light is then needed in the inventory). */
    getFirePitVarbitId(): number {
        return this.firePitVarbitId;
    }

    protected setFirePitVarbitId(varbitId: number): void {
        this.firePitVarbitId = varbitId;
    }

    getEnemy(): Enemy | null {
        return this.enemy;
    }

    protected setEnemy(enemy: Enemy | null): void {
        this.enemy = enemy;
    }

    abstract makeOverlayHint(panelComponent: PanelComponent, plugin: ClueScrollPlugin): void;

    abstract makeWorldOverlayHint(graphics: Graphics2D, plugin: ClueScrollPlugin): void;

    /** The config keys this clue's notes are saved under, or null when it takes no notes. */
    getConfigKeys(): number[] | null {
        return null;
    }

    /** Adds the player's note for this clue to the panel, when there is one. */
    renderOverlayNote(panelComponent: PanelComponent, plugin: ClueNoteSource): void {
        const keys = this.getConfigKeys();
        if (!keys) return;
        const note = plugin.getClueNote(keys[0]);
        if (!note) return;
        panelComponent.getChildren().push(LineComponent.builder().left("Note:").build());
        panelComponent.getChildren().push(LineComponent.builder().left(note).leftColor(TITLED_CONTENT_COLOR).build());
    }
}
