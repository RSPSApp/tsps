/*
 * Copyright (c) 2016-2017, Seth <Sethtroll3@gmail.com>
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import type { ChatboxPanelManager } from "@runelite/client/game/chatbox/ChatboxPanelManager";
import { ClueScrollConfig } from "./ClueScrollConfig";

/** RuneLite's CLUE_NOTE_KEY_PREFIX: notes live at `cluescroll.note_<key>`. */
export const CLUE_NOTE_KEY_PREFIX = "note_";

/** The player's notes on clues, saved in the plugin's config group under each clue's key. */
export class ClueScrollNotes {
    constructor(
        private readonly configManager: ConfigManager,
        private readonly chatboxPanelManager: ChatboxPanelManager,
    ) {}

    getClueNote(key: number): string | null {
        const note = this.configManager.getConfiguration(ClueScrollConfig.group, CLUE_NOTE_KEY_PREFIX + key);
        return typeof note === "string" && note.length > 0 ? note : null;
    }

    setClueNote(key: number, note: string): void {
        this.configManager.setConfiguration(ClueScrollConfig.group, CLUE_NOTE_KEY_PREFIX + key, note);
    }

    unsetClueNote(key: number): void {
        this.configManager.unsetConfiguration(ClueScrollConfig.group, CLUE_NOTE_KEY_PREFIX + key);
    }

    /** The "Set note" overlay entry: a chatbox prompt that saves (or, when emptied, removes) the note. */
    setNoteConsumer(key: number): () => void {
        return () => {
            this.chatboxPanelManager
                .openTextInput("Enter note")
                .value(this.getClueNote(key) ?? "")
                .onDone((value: string) => {
                    if (!value) this.unsetClueNote(key);
                    else this.setClueNote(key, value);
                })
                .build();
        };
    }
}
