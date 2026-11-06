/*
 * Copyright (c) 2016-2017, Seth <Sethtroll3@gmail.com>
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Client } from "@runelite/api/Client";
import * as EnumID from "@runelite/api/EnumID";
import * as ItemID from "@runelite/api/gameval/ItemID";
import type { TagManager } from "../banktags/TagManager";
import type { ClueScrollPlugin } from "./ClueScrollPlugin";
import { CoordinateClue } from "./clues/CoordinateClue";
import { EmoteClue } from "./clues/EmoteClue";
import { FairyRingClue } from "./clues/FairyRingClue";
import { HotColdClue } from "./clues/HotColdClue";
import { MapClue } from "./clues/MapClue";
import { SkillChallengeClue } from "./clues/SkillChallengeClue";

/** The bank tags the plugin registers with Bank Tags (RuneLite's tag names). */
export const CLUE_TAG_NAME = "clue";
export const TREASURE_CHEST_TAG_NAME = "treasure chest";
export const MAGIC_WARDROBE_TAG_NAME = "magic wardrobe";
export const ARMOUR_CASE_TAG_NAME = "armour case";
export const CAPE_RACK_TAG_NAME = "cape rack";
export const TOY_BOX_TAG_NAME = "toy box";

/** The "clue" tag: what the active clue wants (its items, or a spade for a dig). */
export function testClueTag(plugin: ClueScrollPlugin, itemId: number): boolean {
    const clue = plugin.getClue();
    if (!clue) return false;
    if (clue instanceof EmoteClue) return clue.getItemRequirements().some((requirement) => requirement.fulfilledBy(itemId));
    if (clue instanceof CoordinateClue || clue instanceof HotColdClue || clue instanceof FairyRingClue) return itemId === ItemID.SPADE;
    if (clue instanceof MapClue) return clue.getObjectId() === -1 && itemId === ItemID.SPADE;
    if (clue instanceof SkillChallengeClue) return clue.getItemRequirements().some((requirement) => requirement.fulfilledBy(itemId));
    return false;
}

/** The costume-room tags, from [proc,poh_costumes_countmembers] and [proc,poh_costumes_countalternates]. */
export function testTreasureChestTag(client: Client, itemId: number): boolean {
    return testPohCostume(client, itemId, EnumID.POH_COSTUME_CLUE_BEGINNER, EnumID.POH_COSTUME_CLUE_EASY, EnumID.POH_COSTUME_CLUE_MEDIUM, EnumID.POH_COSTUME_CLUE_HARD, EnumID.POH_COSTUME_CLUE_ELITE, EnumID.POH_COSTUME_CLUE_MASTER);
}

export function testMagicWardrobe(client: Client, itemId: number): boolean {
    return testPohCostume(client, itemId, EnumID.POH_COSTUME_WARDROBE);
}

export function testArmourCase(client: Client, itemId: number): boolean {
    return testPohCostume(client, itemId, EnumID.POH_COSTUME_ARMOUR_CASE);
}

export function testCapeRack(client: Client, itemId: number): boolean {
    return testPohCostume(client, itemId, EnumID.POH_CAPE_RACK);
}

export function testToyBox(client: Client, itemId: number): boolean {
    return testPohCostume(client, itemId, EnumID.POH_TOY_BOX);
}

function testPohCostume(client: Client, itemId: number, ...enums: number[]): boolean {
    const members = client.getEnum(EnumID.POH_COSTUME_MEMBERS);
    const alt = client.getEnum(EnumID.POH_COSTUME_ALTERNATE);
    const alts = client.getEnum(EnumID.POH_COSTUME_ALTERNATES);
    if (!members || !alt || !alts) return false;
    for (const tierEnumId of enums) {
        const tierEnum = client.getEnum(tierEnumId);
        if (!tierEnum) continue;
        for (const baseItem of tierEnum.getIntVals()) {
            if (baseItem === itemId) return true;
            const membersEnumId = members.getIntValue(baseItem);
            if (membersEnumId !== -1) {
                // The outfit's members
                const memberEnum = client.getEnum(membersEnumId);
                for (const memberItem of memberEnum?.getIntVals() ?? []) {
                    if (memberItem === itemId) return true;
                    if (checkAlternates(client, alt, alts, itemId, memberItem)) return true;
                }
            } else if (checkAlternates(client, alt, alts, itemId, baseItem)) {
                // A single-member group
                return true;
            }
        }
    }
    return false;
}

function checkAlternates(client: Client, alt: NonNullable<ReturnType<Client["getEnum"]>>, alts: NonNullable<ReturnType<Client["getEnum"]>>, targetItemId: number, checkItemId: number): boolean {
    if (alt.getIntValue(checkItemId) === targetItemId) return true;
    const altsEnumId = alts.getIntValue(checkItemId);
    if (altsEnumId !== -1) {
        const e = client.getEnum(altsEnumId);
        for (const item of e?.getIntVals() ?? []) if (item === targetItemId) return true;
    }
    return false;
}

/** Registers the six tags with Bank Tags' TagManager (RuneLite's startUp). */
export function registerClueTags(plugin: ClueScrollPlugin, tagManager: TagManager): void {
    const client = plugin.getClient();
    tagManager.registerTag(CLUE_TAG_NAME, { contains: (itemId) => testClueTag(plugin, itemId) });
    tagManager.registerTag(TREASURE_CHEST_TAG_NAME, { contains: (itemId) => testTreasureChestTag(client, itemId) });
    tagManager.registerTag(MAGIC_WARDROBE_TAG_NAME, { contains: (itemId) => testMagicWardrobe(client, itemId) });
    tagManager.registerTag(ARMOUR_CASE_TAG_NAME, { contains: (itemId) => testArmourCase(client, itemId) });
    tagManager.registerTag(CAPE_RACK_TAG_NAME, { contains: (itemId) => testCapeRack(client, itemId) });
    tagManager.registerTag(TOY_BOX_TAG_NAME, { contains: (itemId) => testToyBox(client, itemId) });
}

export function unregisterClueTags(tagManager: TagManager): void {
    for (const name of [CLUE_TAG_NAME, TREASURE_CHEST_TAG_NAME, MAGIC_WARDROBE_TAG_NAME, ARMOUR_CASE_TAG_NAME, CAPE_RACK_TAG_NAME, TOY_BOX_TAG_NAME]) tagManager.unregisterTag(name);
}
