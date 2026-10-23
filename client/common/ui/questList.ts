export const QUEST_LIST_STATUS_IN_PROGRESS = 0;
export const QUEST_LIST_STATUS_NOT_STARTED = 1;
export const QUEST_LIST_STATUS_COMPLETE = 2;
export const QUEST_LIST_STATUS_UNAVAILABLE = 3;

export type QuestListStatus =
    | typeof QUEST_LIST_STATUS_IN_PROGRESS
    | typeof QUEST_LIST_STATUS_NOT_STARTED
    | typeof QUEST_LIST_STATUS_COMPLETE
    | typeof QUEST_LIST_STATUS_UNAVAILABLE;

export interface QuestListConfigQuest {
    key: string;
    displayName: string;
    status: QuestListStatus;
}

export interface QuestListConfigGroup {
    title: string;
    quests: readonly QuestListConfigQuest[];
}

export interface QuestListWidgetQuest {
    key: string;
    slot: number;
    displayName: string;
    status: QuestListStatus;
}

export interface QuestListWidgetGroup {
    title: string;
    quests: QuestListWidgetQuest[];
}

export function buildQuestListWidgetGroups(
    groups: readonly QuestListConfigGroup[],
): QuestListWidgetGroup[] {
    const widgetGroups: QuestListWidgetGroup[] = [];
    let slot = 0;

    for (const group of groups) {
        const title = String(group.title ?? "").trim();
        const quests = Array.isArray(group.quests) ? group.quests : [];
        if (quests.length === 0) continue;

        if (title.length > 0) {
            slot++;
        }

        const widgetQuests: QuestListWidgetQuest[] = [];
        for (const quest of quests) {
            const key = String(quest.key ?? "").trim();
            const displayName = String(quest.displayName ?? "").trim();
            if (key.length === 0 || displayName.length === 0) continue;
            widgetQuests.push({
                key,
                slot,
                displayName,
                status: quest.status,
            });
            slot++;
        }

        if (widgetQuests.length === 0) continue;
        widgetGroups.push({ title, quests: widgetQuests });
    }

    return widgetGroups;
}

export function getQuestListWidgetMaxSlot(groups: readonly QuestListWidgetGroup[]): number {
    let maxSlot = -1;
    for (const group of groups) {
        if (group.title.trim().length > 0) {
            const firstQuestSlot = group.quests[0]?.slot;
            if (firstQuestSlot !== undefined) {
                maxSlot = Math.max(maxSlot, firstQuestSlot - 1);
            }
        }
        for (const quest of group.quests) {
            maxSlot = Math.max(maxSlot, quest.slot);
        }
    }
    return maxSlot;
}
