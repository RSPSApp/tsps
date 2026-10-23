import * as assert from "node:assert/strict";

const { registerQuest, openJournalBySlot } = require("../plugins/quests/QuestRuntime.js");

const attributes = new Map<string, unknown>();
const questPreferences = new Map<number, number>([[13772, 1]]);
const sent = {
    configs: [] as Array<[number, number]>,
    jingles: [] as number[],
    questLists: [] as any[],
    flagRanges: [] as Array<[number, number, number]>,
    strings: [] as Array<[string, number]>,
    items: [] as Array<[number, number, number]>,
    interfaces: [] as number[],
    messages: [] as string[],
    granted: [] as Array<[number, number]>,
    rewarded: false,
};
const player = {
    getAttribute: (key: string) => attributes.get(key),
    setAttribute: (key: string, value: unknown) => attributes.set(key, value),
    sendMessage: (message: string) => sent.messages.push(message),
    getInventory: () => ({
        isFull: () => false,
        adds: (id: number, amount: number) => sent.granted.push([id, amount]),
    }),
    getPacketSender: () => ({
        sendConfig: (id: number, value: number) => sent.configs.push([id, value]),
        sendVarbit: () => {},
        getVarbit: (id: number) => questPreferences.get(id) ?? 0,
        sendJingle: (id: number) => sent.jingles.push(id),
        sendQuestList: (groups: any) => sent.questLists.push(groups),
        sendInterfaceFlagsRange: (uid: number, from: number, to: number) => sent.flagRanges.push([uid, from, to]),
        sendString: (text: string, uid: number) => sent.strings.push([text, uid]),
        sendInterfaceRemoval: () => {},
        sendInterface: (id: number) => sent.interfaces.push(id),
        sendItemOnInterfaces: (uid: number, item: number, amount: number) => sent.items.push([uid, item, amount]),
        sendInterfaceScript: () => {},
        sendSubInterface: () => {},
        closeSubInterface: () => {},
    }),
};

const persisted: string[] = [];
const api = {
    persistAttribute: (key: string) => persisted.push(key),
    onInterfaceActionButton: () => {},
    onCustomEvent: () => {},
    onPlayerLogin: () => {},
};

const quest = registerQuest(api, {
    key: "test_quest",
    name: "Test Quest",
    varpId: 29,
    startedValue: 1,
    completionValue: 2,
    questPoints: 1,
    xpRewards: [{ skillId: 7, amount: 300, label: "Cooking" }],
    rewardItemId: 1891,
    buildJournal: () => ["line one", "line two"],
    onReward: () => {
        sent.rewarded = true;
    },
});

assert.deepEqual([...persisted].sort(), ["quest.points", "quest.test_quest.stage"], "persists stage + points");

assert.equal(quest.getStage(player), 0, "new players start at stage 0");
assert.equal(quest.isComplete(player), false);

quest.setStage(player, 1);
assert.equal(quest.getStage(player), 1);
assert.equal(quest.isStarted(player), true);
assert.ok(sent.configs.some(([id, value]) => id === 29 && value === 1), "stage mirrors to the quest varp");

assert.equal(quest.complete(player), true);
assert.equal(quest.isComplete(player), true);
assert.equal(quest.getStage(player), 2);
assert.ok(sent.configs.some(([id, value]) => id === 101 && value === 1), "quest points varp");
assert.equal(sent.rewarded, true, "reward hook runs");
assert.deepEqual(sent.granted, [[1891, 1]], "reward item is added to the inventory");
assert.ok(sent.jingles.length > 0, "plays the completion jingle");
assert.ok(sent.interfaces.includes(153), "opens the completion scroll");
assert.ok(sent.items.some(([uid, item]) => uid === ((153 << 16) | 5) && item === 1891), "scroll shows the reward item");
assert.equal(quest.complete(player), false, "completing twice is a no-op");

const groups = sent.questLists.at(-1);
assert.equal(groups[0].quests[0].key, "test_quest");
assert.equal(groups[0].quests[0].status, 2, "quest list shows complete");
assert.equal(groups[0].quests[0].displayName, "Test Quest");

// A group title occupies the row before its quests (slot 0 is the "T" header),
// so the journal lookup must index the produced slot map, not slot - 1.
const journalTitleUid = (119 << 16) | 5;
sent.strings.length = 0;
openJournalBySlot(player, 1);
assert.ok(
    sent.strings.some(([text, uid]) => uid === journalTitleUid && text.includes("Test Quest")),
    "slot 1 opens the first quest's journal"
);
sent.strings.length = 0;
openJournalBySlot(player, 0);
assert.equal(
    sent.strings.filter(([, uid]) => uid === journalTitleUid).length,
    0,
    "the header slot opens no journal"
);

// The list groups by leading letter, ignoring a leading "The", and each group
// gets its own header row.
registerQuest(api, {
    key: "alpha_quest", name: "Alpha Quest", varpId: 30,
    startedValue: 1, completionValue: 2, questPoints: 1, buildJournal: () => [],
});
registerQuest(api, {
    key: "the_beta_quest", name: "The Beta Quest", varpId: 31,
    startedValue: 1, completionValue: 2, questPoints: 1, buildJournal: () => [],
});
require("../plugins/quests/QuestRuntime").refreshQuestList(player);
const grouped = sent.questLists.at(-1);
assert.deepEqual(
    grouped.map((group: any) => group.title),
    ["A", "B", "T"],
    "quest list is grouped by leading letter (The ignored)"
);
assert.equal(grouped[0].quests[0].slot, 1, "Alpha Quest follows its A header");
assert.equal(grouped[1].quests[0].slot, 3, "The Beta Quest follows its B header");
sent.strings.length = 0;
openJournalBySlot(player, 3);
assert.ok(
    sent.strings.some(([text, uid]) => uid === journalTitleUid && text.includes("The Beta Quest")),
    "a later group's slot opens the right journal"
);

// Every quest row gets its "Read journal:" flags, however long the list (#625).
for (let i = 0; i < 250; i++) {
    registerQuest(api, {
        key: `zz_quest_${i}`, name: `Zz Quest ${i}`, varpId: 32,
        startedValue: 1, completionValue: 2, questPoints: 0, buildJournal: () => [],
    });
}
sent.flagRanges.length = 0;
require("../plugins/quests/QuestRuntime").refreshQuestList(player);
const lastSlot = Math.max(...sent.questLists.at(-1).flatMap((group: any) => group.quests.map((q: any) => q.slot)));
assert.ok(lastSlot > 199, "list extends past slot 199");
assert.ok(
    sent.flagRanges.some(([uid, from, to]) => uid === ((399 << 16) | 7) && from <= lastSlot && lastSlot <= to),
    "the last quest row gets its journal flags"
);

// Click mapping belongs to the snapshot rendered on the client, even if a preference
// has changed before a refresh packet is sent.
questPreferences.set(13889, 1);
sent.strings.length = 0;
openJournalBySlot(player, 3);
assert.ok(sent.strings.some(([text, uid]) => uid === journalTitleUid && text.includes("The Beta Quest")));
require("../plugins/quests/QuestRuntime").refreshQuestList(player);
const withoutHeaders = sent.questLists.at(-1);
assert.equal(withoutHeaders[0].title, "");
assert.equal(withoutHeaders[0].quests[0].slot, 0);
sent.strings.length = 0;
openJournalBySlot(player, 0);
assert.ok(sent.strings.some(([text, uid]) => uid === journalTitleUid && text.includes("Alpha Quest")));
questPreferences.set(13776, 1);
questPreferences.set(13777, 1);
require("../plugins/quests/QuestRuntime").refreshQuestList(player);
assert.deepEqual(sent.questLists.at(-1), []);
sent.strings.length = 0;
openJournalBySlot(player, 0);
assert.equal(sent.strings.length, 0, "filtered entries cannot open stale journals");
console.info("quest runtime smoke passed");
