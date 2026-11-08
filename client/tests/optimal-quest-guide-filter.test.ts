import { strict as assert } from "node:assert";
import { QuestState } from "@runelite/api/QuestState";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { GuideConfig } from "../game/plugins/optimalquestguide/GuideConfig";
import { isQuestShown, visibleRows, type GuideView, type QuestRow } from "../game/plugins/optimalquestguide/GuideView";

assert.equal(typeof window, "undefined", "this fixture requires Node without browser globals");
const manager = new ConfigManager();
const config = manager.getConfig(GuideConfig);
const set = (key: string, value: boolean): void => manager.setConfiguration(GuideConfig.group, key, value);

const met: QuestRow = {
    info: { name: "Met quest", uri: "https://example.com/met", index: 0, questState: QuestState.NOT_STARTED,
        reqs: [{ skill: "Mining", level: 20, boostable: false }] },
    levels: [20],
};
const unmet: QuestRow = {
    info: { name: "Unmet quest", uri: "https://example.com/unmet", index: 1, questState: QuestState.IN_PROGRESS,
        reqs: [{ skill: "Mining", level: 20, boostable: false }] },
    levels: [19],
};
const completed: QuestRow = {
    info: { name: "Completed quest", uri: "https://example.com/completed", index: 2, questState: QuestState.FINISHED,
        reqs: [{ skill: "Mining", level: 20, boostable: false }] },
    levels: [20],
};
const view: GuideView = { updated: true, rows: [met, unmet, completed] };
const names = (): string[] => visibleRows(view, config, "").map((row) => row.info.name);

// Both options off: unfinished quests remain in guide order and completed is hidden.
assert.equal(config.showCompletedQuests(), false);
assert.equal(config.filterMetRequirements(), false);
assert.deepEqual(names(), ["Met quest", "Unmet quest"]);
assert.equal(isQuestShown(met, config, true), true);
assert.equal(isQuestShown(unmet, config, true), true);
assert.equal(isQuestShown(completed, config, true), false);

// The requirements filter retains a met quest and hides an unmet unfinished quest.
set("filterMetRequirements", true);
assert.equal(config.filterMetRequirements(), true);
assert.equal(isQuestShown(met, config, true), true);
assert.equal(isQuestShown(unmet, config, true), false);
assert.deepEqual(names(), ["Met quest"]);

// Showing completed quests includes the completed row when the filter is off.
set("filterMetRequirements", false);
set("showCompletedQuests", true);
assert.equal(config.showCompletedQuests(), true);
assert.deepEqual(names(), ["Met quest", "Unmet quest", "Completed quest"]);
assert.equal(isQuestShown(completed, config, true), true);

// Both options enabled: adding completed quests must not expose unmet unfinished quests.
set("filterMetRequirements", true);
assert.equal(config.showCompletedQuests(), true);
assert.equal(config.filterMetRequirements(), true);
assert.equal(isQuestShown(met, config, true), true);
assert.equal(isQuestShown(completed, config, true), true);
assert.equal(isQuestShown(unmet, config, true), false);
assert.deepEqual(names(), ["Met quest", "Completed quest"]);
