/*
 * Copyright (c) 2018, Tomas Slusny <slusnucky@gmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import type { WidgetOverlayDrawContext } from "../ClientPluginManager";
import { ClueScrollDynamicOverlay } from "./ClueScrollDynamicOverlay";
import type { ClueScrollPlugin } from "./ClueScrollPlugin";

/**
 * The scene overlay (RuneLite's ClueScrollWorldOverlay, ABOVE_SCENE): the clue's world hint, and
 * the STASH unit the player last used when it is not the active clue's.
 */
export class ClueScrollWorldOverlay extends ClueScrollDynamicOverlay {
    /** Under the interfaces, over the scene (RuneLite's ABOVE_SCENE layer). */
    drawBelowWidgets = true;

    constructor(private readonly plugin: ClueScrollPlugin) {
        super("ClueScrollWorldOverlay");
    }

    draw(context: WidgetOverlayDrawContext): ReturnType<ClueScrollDynamicOverlay["draw"]> {
        // Item images (the clue scroll and spade markers) come from the GL context's item renderer.
        if (context.itemImage) this.plugin.setItemImageSource(context.itemImage);
        return super.draw(context);
    }

    protected render(graphics: Graphics2D): void {
        const clue = this.plugin.getClue();
        if (clue !== null) clue.makeWorldOverlayHint(graphics, this.plugin);
        const activeSTASHClue = this.plugin.getActiveSTASHClue();
        if (activeSTASHClue !== null && activeSTASHClue !== clue) activeSTASHClue.makeSTASHOverlay(graphics, this.plugin);
    }
}
