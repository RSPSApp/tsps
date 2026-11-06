/*
 * Copyright (c) 2018, Tomas Slusny <slusnucky@gmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Widget } from "@runelite/api/widgets/Widget";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import { ClueScrollDynamicOverlay } from "./ClueScrollDynamicOverlay";
import { EMOTE_CONTENTS, EMOTE_SCROLLABLE, EMOTE_SCROLLBAR, EMOTE_UNIVERSE } from "./ClueScrollInterfaces";
import type { ClueScrollPlugin } from "./ClueScrollPlugin";
import { EmoteClue } from "./clues/EmoteClue";

/** Highlights the clue's emotes on the emote tab and scrolls to them once (RuneLite's ClueScrollEmoteOverlay). */
export class ClueScrollEmoteOverlay extends ClueScrollDynamicOverlay {
    private hasScrolled = false;

    constructor(private readonly plugin: ClueScrollPlugin) {
        super("ClueScrollEmoteOverlay");
    }

    protected render(graphics: Graphics2D, live: boolean): void {
        const clue = this.plugin.getClue();
        if (!(clue instanceof EmoteClue)) {
            this.hasScrolled = false;
            return;
        }
        const emoteClue = clue;
        if (!emoteClue.getFirstEmote().hasSprite()) return;

        const client = this.plugin.getClient();
        const emoteContainer = client.getWidget(EMOTE_CONTENTS);
        if (emoteContainer === null || emoteContainer.isHidden()) return;
        const emoteWindow = client.getWidget(EMOTE_UNIVERSE);
        if (emoteWindow === null) return;

        let firstEmoteWidget: Widget | null = null;
        let secondEmoteWidget: Widget | null = null;
        const secondEmote = emoteClue.getSecondEmote();
        for (const emoteWidget of emoteContainer.getDynamicChildren()) {
            if (emoteWidget.getSpriteId() === emoteClue.getFirstEmote().getSpriteId()) {
                firstEmoteWidget = emoteWidget;
                this.plugin.highlightWidget(graphics, emoteWidget, emoteWindow, null, secondEmote !== null ? "1st" : null);
            } else if (secondEmote !== null && emoteWidget.getSpriteId() === secondEmote.getSpriteId()) {
                secondEmoteWidget = emoteWidget;
                this.plugin.highlightWidget(graphics, emoteWidget, emoteWindow, null, "2nd");
            }
        }

        if (live && !this.hasScrolled) {
            // Not yet scrolled when the client script VM is busy this frame: try again next frame.
            this.hasScrolled = this.plugin.scrollToWidget(EMOTE_SCROLLABLE, EMOTE_SCROLLBAR, firstEmoteWidget, secondEmoteWidget);
        }
    }
}
