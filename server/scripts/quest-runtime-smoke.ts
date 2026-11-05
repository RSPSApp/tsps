import * as assert from "node:assert/strict";

const { registerQuest, openJournalById } = require("../plugins/quests/QuestRuntime.js");

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
const nativeRows = [
    ["Test Quest", 42], ["Alpha Quest", 16], ["The Beta Quest", 55],
    ...Array.from({length: 250}, (_, i) => [`Zz Quest ${i}`, 1000 + i]),
].map(([name, id], i) => ({ id: i + 3000, column: (column: string) => column === "id" ? [id] : column === "displayname" ? [name] : [] }));
const api = {
    core: { CacheDefinitions: {
        getDbColumns: () => ["id", "displayname"],
        getDbColumn: (_table: number, name: string) => name,
        getDbTableRows: () => nativeRows,
    } },
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

assert.deepEqual([...persisted].sort(), ["quest.experience-withheld", "quest.points", "quest.test_quest.stage"], "persists stage, points and withheld experience");

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

// A native child is the cache id, independent of visual order or a group header.
const journalTitleUid = (119 << 16) | 5;
sent.strings.length = 0;
openJournalById(player, 42);
assert.ok(sent.strings.some(([text, uid]) => uid === journalTitleUid && text.includes("Test Quest")));
assert.ok(sent.strings.some(([text, uid]) => uid === ((119 << 16) | 11) && text === "<col=000080>line one"));
sent.strings.length = 0;
openJournalById(player, 0);
assert.equal(sent.strings.length, 0, "an unmapped native id opens no journal");

// Native identities survive registration order, sorting and filtering.
registerQuest(api, {
    key: "alpha_quest", name: "Alpha Quest", varpId: 30,
    startedValue: 1, completionValue: 2, questPoints: 1, buildJournal: () => [],
});
registerQuest(api, {
    key: "the_beta_quest", name: "The Beta Quest", varpId: 31,
    startedValue: 1, completionValue: 2, questPoints: 1, buildJournal: () => [],
});
require("../plugins/quests/QuestRuntime").refreshQuestList(player);
assert.equal(sent.questLists.length, 0, "the server no longer sends custom list rows");
sent.strings.length = 0;
openJournalById(player, 55);
assert.ok(sent.strings.some(([text, uid]) => uid === journalTitleUid && text.includes("The Beta Quest")));

// Every quest row gets its "Read journal:" flags, however long the list (#625).
for (let i = 0; i < 250; i++) {
    registerQuest(api, {
        key: `zz_quest_${i}`, name: `Zz Quest ${i}`, varpId: 32,
        startedValue: 1, completionValue: 2, questPoints: 0, buildJournal: () => [],
    });
}
require("../plugins/quests/QuestRuntime").refreshQuestList(player);
const lastId = 1249;
assert.ok(sent.flagRanges.some(([uid, from, to]) => uid === ((399 << 16) | 7) && from <= lastId && lastId <= to),
    "canonical identities above 199 get journal events");
questPreferences.set(13889, 1);
questPreferences.set(13776, 1);
questPreferences.set(13777, 1);
require("../plugins/quests/QuestRuntime").refreshQuestList(player);
sent.strings.length = 0;
openJournalById(player, 55);
assert.ok(sent.strings.some(([text, uid]) => uid === journalTitleUid && text.includes("The Beta Quest")),
    "native identity does not depend on client sorting or filtering");
assert.equal(sent.questLists.length, 0);
console.info("quest runtime smoke passed");
