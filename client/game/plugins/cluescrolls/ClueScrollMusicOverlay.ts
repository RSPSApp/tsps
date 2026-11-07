/*
 * Copyright (c) 2018, Tomas Slusny <slusnucky@gmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Widget } from "@runelite/api/widgets/Widget";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import { Rectangle } from "@runelite/awt/Shapes";
import { ClueScrollDynamicOverlay } from "./ClueScrollDynamicOverlay";
import { MUSIC_JUKEBOX, MUSIC_SCROLLABLE, MUSIC_SCROLLBAR, MUSIC_UNIVERSE } from "./ClueScrollInterfaces";
import type { ClueScrollPlugin } from "./ClueScrollPlugin";
import { MusicClue } from "./clues/MusicClue";

const PADDING = new Rectangle(2, 1, 0, 1);

/** Highlights the clue's song on the music tab and scrolls to it once (RuneLite's ClueScrollMusicOverlay). */
export class ClueScrollMusicOverlay extends ClueScrollDynamicOverlay {
    private hasScrolled = false;

    constructor(private readonly plugin: ClueScrollPlugin) {
        super("ClueScrollMusicOverlay");
    }

    protected render(graphics: Graphics2D, live: boolean): void {
        const clue = this.plugin.getClue();
        if (!(clue instanceof MusicClue)) {
            this.hasScrolled = false;
            return;
        }
        const client = this.plugin.getClient();
        const musicContainer = client.getWidget(MUSIC_UNIVERSE);
        if (musicContainer === null || musicContainer.isHidden()) return;
        const trackList = client.getWidget(MUSIC_JUKEBOX);
        const trackToFind = clue.getSong();
        let found: Widget | null = null;
        if (trackList === null) return;
        for (const track of trackList.getDynamicChildren()) {
            if (track.getText() === trackToFind) {
                found = track;
                break;
            }
        }
        if (found === null) return;

        if (live && !this.hasScrolled) {
            // Not yet scrolled when the client script VM is busy this frame: try again next frame.
            this.hasScrolled = this.plugin.scrollToWidget(MUSIC_SCROLLABLE, MUSIC_SCROLLBAR, found);
        }
        this.plugin.highlightWidget(graphics, found, trackList, PADDING, null);
    }
}
