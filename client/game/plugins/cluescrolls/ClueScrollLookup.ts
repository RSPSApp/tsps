/*
 * Copyright (c) 2016-2017, Seth <Sethtroll3@gmail.com>
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import * as ItemID from "@runelite/api/gameval/ItemID";
import { Text } from "@runelite/client/util/Text";
import type { ClueScrollPlugin } from "./ClueScrollPlugin";
import { AnagramClue } from "./clues/AnagramClue";
import { CipherClue } from "./clues/CipherClue";
import type { ClueScroll } from "./clues/ClueScroll";
import { CoordinateClue } from "./clues/CoordinateClue";
import { CrypticClue } from "./clues/CrypticClue";
import { EmoteClue } from "./clues/EmoteClue";
import { FairyRingClue } from "./clues/FairyRingClue";
import { FaloTheBardClue } from "./clues/FaloTheBardClue";
import { HotColdClue } from "./clues/HotColdClue";
import { MapClue } from "./clues/MapClue";
import { MusicClue } from "./clues/MusicClue";
import { SkillChallengeClue } from "./clues/SkillChallengeClue";
import { ThreeStepCrypticClue } from "./clues/ThreeStepCrypticClue";

/** The clue a scroll's text describes, trying each family in RuneLite's order. */
export function findClueScrollForText(plugin: ClueScrollPlugin, rawText: string, clueItemId: number | null): ClueScroll | null {
    // Line breaks (and the rare double ones) become spaces.
    const text = Text.sanitizeMultilineText(rawText).toLowerCase();
    if (text.startsWith("i'd like to hear some music.")) return MusicClue.forText(rawText);
    if (text.includes("degrees") && text.includes("minutes")) return coordinatesToWorldPoint(text);
    return (
        AnagramClue.forText(plugin, text) ??
        CipherClue.forText(text) ??
        CrypticClue.forText(text) ??
        EmoteClue.forText(text) ??
        FairyRingClue.forText(text) ??
        FaloTheBardClue.forText(text) ??
        HotColdClue.forText(text, clueItemId ?? -1) ??
        SkillChallengeClue.forText(text, rawText) ??
        // Three-step cryptics need the raw text to see which steps are struck through.
        ThreeStepCrypticClue.forText(text, rawText)
    );
}

/** The clue an item is, for the per-step clue items; beginner and master scrolls are one item each. */
export function findClueScrollForItem(itemId: number): ClueScroll | null {
    if (itemId === ItemID.TRAIL_CLUE_BEGINNER || itemId === ItemID.TRAIL_CLUE_MASTER) return null;
    return (
        MapClue.forItemId(itemId) ??
        MusicClue.forItemId(itemId) ??
        CoordinateClue.forItemId(itemId) ??
        AnagramClue.forItemId(itemId) ??
        CipherClue.forItemId(itemId) ??
        CrypticClue.forItemId(itemId) ??
        EmoteClue.forItemId(itemId) ??
        FairyRingClue.forItemId(itemId)
    );
}

/** A clue set by an NPC's dialogue line: Charlie's tasks and Falo's riddles. */
export function findNpcChatClueScroll(sender: string, rawText: string): ClueScroll | null {
    const text = Text.sanitizeMultilineText(rawText).toLowerCase();
    return SkillChallengeClue.forChatboxText(sender, text) ?? FaloTheBardClue.forChatboxText(sender, text);
}

/**
 * "00 degrees 00 minutes north 07 degrees 13 minutes west" to the coordinate clue at that tile.
 * Some clues say "1 degree" instead of "01 degrees". Null for anything malformed.
 */
export function coordinatesToWorldPoint(text: string): CoordinateClue | null {
    const parts = text.split(" ");
    if (parts.length !== 10) return null;
    if (!parts[1].startsWith("degree") || !parts[3].startsWith("minute")) return null;
    let degY = parseInt(parts[0], 10);
    let minY = parseInt(parts[2], 10);
    if (parts[4] === "south") {
        degY *= -1;
        minY *= -1;
    }
    let degX = parseInt(parts[5], 10);
    let minX = parseInt(parts[7], 10);
    if (parts[9] === "west") {
        degX *= -1;
        minX *= -1;
    }
    if ([degY, minY, degX, minX].some((n) => Number.isNaN(n))) return null;
    return CoordinateClue.forLocation(coordinatesToTile(degX, minX, degY, minY));
}

/** The tile a sextant reading names: offsets from the Observatory's centre, 32 tiles a degree and 1.875 minutes a tile. */
export function coordinatesToTile(degX: number, minX: number, degY: number, minY: number): WorldPoint {
    const x2 = 2440 + degX * 32 + Math.round(minX / 1.875);
    const y2 = 3161 + degY * 32 + Math.round(minY / 1.875);
    return new WorldPoint(x2, y2, 0);
}
