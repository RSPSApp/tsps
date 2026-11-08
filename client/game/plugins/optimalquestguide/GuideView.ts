/*
 * Copyright (c) 2020, Christopher Oswald <https://github.com/cesoun>
 * All rights reserved.
 *
 * Ported to TypeScript. BSD 2-Clause License, see ./LICENSE.
 */
import type { ConfigOf } from "@runelite/client/config/ConfigItem";
import { QuestState } from "@runelite/api/QuestState";
import type { GuideConfig } from "./GuideConfig";
import type { QuestInfo, QuestRequirement } from "./QuestInfo";

/** A quest as the panel draws it: its state and the player's level for each requirement. */
export type QuestRow = {
    info: QuestInfo;
    /** Per requirement, in order; undefined until there is a local player. */
    levels: (number | undefined)[];
};

/** Everything the panel draws, a new object whenever any of it changes. */
export type GuideView = {
    /** False until the first update after login: every quest shows, uncoloured. */
    updated: boolean;
    rows: QuestRow[];
};

type Config = ConfigOf<typeof GuideConfig>;

/** QuestPanel.update: the name's colour by quest state, or undefined before it is known. */
export function questNameColor(state: QuestState | undefined, config: Config): number | undefined {
    if (state === undefined) return undefined;
    if (state === QuestState.IN_PROGRESS) return config.getInProgressColor();
    if (state === QuestState.FINISHED) return config.getCompletedColor();
    return config.getNotStartedColor();
}

/** QuestPanel.updateRequirement: met, boostable or unmet. */
export function requirementColor(
    requirement: QuestRequirement,
    level: number | undefined,
    config: Config,
): number | undefined {
    if (level === undefined) return undefined;
    if (level >= requirement.level) return config.getRequirementMetColor();
    if (requirement.boostable) return config.getRequirementBoostableColor();
    return config.getRequirementUnmetColor();
}

/** GuidePanel.filterByMet: every requirement met at its real level, boosts not counted. */
function meetsAll(row: QuestRow): boolean {
    return row.info.reqs.every((requirement, i) => {
        const level = row.levels[i];
        // No local player: the plugin leaves the quest as it was, shown.
        return level === undefined || level >= requirement.level;
    });
}

/** GuidePanel.updateQuests: whether a quest shows with the search box empty. */
export function isQuestShown(row: QuestRow, config: Config, updated: boolean): boolean {
    if (!updated) return true;
    const state = row.info.questState;
    if (state === QuestState.NOT_STARTED || state === QuestState.IN_PROGRESS) {
        return !config.filterMetRequirements() || meetsAll(row);
    }
    // Finished, or not a quest RuneLite knows: shown only when requested.
    return config.showCompletedQuests();
}

/**
 * The quests the panel lists. With a search, SearchListener.onSearch: the quests that show,
 * or every quest if "Search completed quests" is on (or none show), by name.
 */
export function visibleRows(view: GuideView, config: Config, search: string): QuestRow[] {
    const shown = view.rows.filter((row) => isQuestShown(row, config, view.updated));
    const needle = search.toLowerCase();
    if (!needle) return shown;
    const pool = config.searchCompletedQuests() || shown.length === 0 ? view.rows : shown;
    return pool.filter((row) => row.info.name.toLowerCase().includes(needle));
}

/** A config colour (0xRRGGBB) as CSS. */
export function cssColor(rgb: number | undefined): string | undefined {
    return rgb === undefined ? undefined : `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`;
}
