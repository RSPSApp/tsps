import assert from "node:assert/strict";
import { before, test } from "node:test";
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions as cache } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";
const { nativeQuestIndex, questRowById } = require("../plugins/quests/QuestList.QuestRuntime");
before(async () => CachePipeline.initialize(process.cwd()));
const pirate = { key: "pirate", name: "Pirate's Treasure" };
const elemental = { key: "elemental", name: "Elemental Workshop I" };
const rfd = { key: "rfd", name: "Recipe for Disaster" };
// Matching cache 242 / OpenRS2 2757: quest IDs 1..219, then generated headers.
// https://github.com/Joshua-F/osrs-dumps/tree/853150e3f75e1463391b470f98caf5d3bf796339
// config/dump.dbrow + dump.dbtable; script/[proc,questlist_draw].cs2.
const LAST_QUEST_ROW = 219;
const FIRST_HEADER_ROW = 220;
const RELEASED_MAIN_QUESTS = 187;
const RELEASED_QUEST_POINTS = 346;

test("canonical cache identities select quests independently of registration or visual order", () => {
    for (const quests of [[pirate, elemental], [elemental, pirate]]) {
        const rows = nativeQuestIndex(quests, cache);
        assert.equal(rows.get(16), pirate);
        assert.equal(rows.get(55), elemental);
        assert.equal(rows.has(17), false, "unregistered native rows cannot select a neighbouring quest");
        assert.equal(rows.has(FIRST_HEADER_ROW), false, "native header children are not quests");
    }
});
test("RFD subrows resolve to the combined quest unless registered separately", () => {
    const rows = nativeQuestIndex([rfd], cache);
    assert.deepEqual([...rows.keys()].sort((a,b) => a-b), [106,171,172,173,174,175,176,177,178,179,180]);
    assert.ok([...rows.values()].every(quest => quest === rfd));
    const child = { key: "pete", name: "Recipe for Disaster - Pirate Pete" };
    const distinct = nativeQuestIndex([rfd, child], cache);
    assert.equal(distinct.get(174), child);
    assert.equal(distinct.get(175), rfd);
    assert.equal(nativeQuestIndex([], cache).size, 0);
});


test("native row ops use canonical journals, metadata map/wiki actions and the live event mask", () => {
    assert.equal(questRowById(218, cache).displayname[0], "Mudfoot's Big Adventure", "the former header slot is now a quest");
    assert.equal(questRowById(LAST_QUEST_ROW, cache).displayname[0], "The Writing's on the Wall");
    assert.equal(questRowById(FIRST_HEADER_ROW, cache), undefined, "header control is outside the native quest IDs");
    const buttons = new Map<number, Function>();
    const Q = require("../plugins/quests/QuestRuntime");
    const api = new Proxy({
        core: { CacheDefinitions: cache },
        onInterfaceActionButton: (ids: number | number[], handler: Function) => {
            for (const id of Array.isArray(ids) ? ids : [ids]) buttons.set(id, handler);
        },
    }, { get: (target: any, key) => target[key] ?? (() => {}) });
    Q.registerQuest(api, { ...pirate, varpId: 71, buildJournal: () => ["Pirate journal"] });
    Q.registerQuest(api, { ...elemental, varpId: 299, buildJournal: () => ["Elemental journal"] });
    const goblin = Q.registerQuest(api, {key: "goblin_count", name: "Goblin Diplomacy", varpId: 144, completionValue: 7, buildJournal: () => []});
    const strings: any[] = [], scripts: any[] = [], flags: any[] = [], varbits = new Map<number, number>(), messages: string[] = [];
    const varps = new Map<number, number>([[144, 6]]); // Captured native completion can precede the gameplay reward.
    const sender: any = new Proxy({
        sendString: (text: string, uid: number) => strings.push([text, uid]),
        sendInterfaceScript: (...args: any[]) => scripts.push(args),
        sendInterfaceFlagsRange: (...args: any[]) => flags.push(args),
        sendVarbit: (id: number, value: number) => varbits.set(id, value),
        getVarp: (id: number) => varps.get(id) ?? 0,
        getVarbit: (id: number) => varbits.get(id) ?? 0,
        isWorldMapOpen: () => false,
        toggleWorldMap: () => scripts.push(["map"]),
    }, {get: (target, key) => target[key] ?? (() => sender)});
    const player = {getPacketSender: () => sender, getAttribute: () => 0, sendMessage: (text: string) => messages.push(text)};
    Q.refreshQuestList(player);
    assert.deepEqual(flags, [[(399<<16)|7, 0, LAST_QUEST_ROW, 0x3e]]);
    assert.equal(varbits.get(11877), RELEASED_MAIN_QUESTS, "main total excludes miniquests, subquests and unreleased rows");
    assert.equal(varbits.get(1782), RELEASED_QUEST_POINTS, "QP maximum includes RFD's ten canonical rewards and excludes unreleased rows");
    assert.equal(varbits.get(14162), 0);
    assert.equal(goblin.isComplete(player), false);
    assert.equal(varbits.get(6347), 1, "header follows the native-published completion, not internal reward timing");
    Q.refreshQuestList(player);
    assert.equal(flags.length, 1, "stable events are not rebroadcast on progress updates");
    const click = buttons.get((399<<16)|7)!;
    for (const [slot, title] of [[16, "Pirate's Treasure"], [55, "Elemental Workshop I"]] as const) {
        strings.length = 0;
        click({player, slot, opId: 2});
        assert.ok(strings.some(([text, uid]) => uid === ((119<<16)|5) && text.includes(title)));
    }
    strings.length = 0;
    click({player, slot: FIRST_HEADER_ROW, opId: 2});
    click({player, slot: 16, opId: 6});
    assert.equal(strings.length, 0, "headers and dormant Pin never open journals");
    click({player, slot: 23, opId: 2});
    assert.ok(strings.some(([text, uid]) => uid === ((782<<16)|5) && text.includes("Alfred Grimhand")));
    click({player, slot: 89, opId: 2});
    assert.equal(messages.length, 0, "missing unsupported content introduces no invented native response");
    scripts.length = 0;
    click({player, slot: 23, opId: 4});
    click({player, slot: 23, opId: 5});
    assert.deepEqual(scripts, [
        [3300, ["Search", "", "", "", "Alfred Grimhand's Barcrawl"]],
        [3300, ["Search", "", "", "", "Alfred Grimhand's Barcrawl/Quick guide"]],
    ]);
    scripts.length = 0;
    click({player, slot: 16, opId: 3});
    assert.equal(scripts[0][0], "map");
    assert.equal(scripts[1][1][1], require("../plugins/quests/QuestList.QuestRuntime").questRowById(16, cache).startcoord[0]);
});

test("journal callbacks retain their quest argument and receive the selected native row", () => {
    const Q = require("../plugins/quests/QuestRuntime");
    const { questRowById } = require("../plugins/quests/QuestList.QuestRuntime");
    const calls: any[] = [], strings: any[] = [], configs = new Map<number, number>();
    const api = new Proxy({ core: { CacheDefinitions: cache } }, { get: (target: any, key) => target[key] ?? (() => {}) });
    const quest = Q.registerQuest(api, { ...rfd, varpId: 678,
        buildJournal: (player: any, handle: any, context: any) => {
            calls.push([player, handle, context?.row]);
            return [`Row ${context?.row?.id?.[0] ?? "default"}`];
        },
    });
    const sender: any = new Proxy({
        sendString: (text: string, uid: number) => strings.push([text, uid]),
        sendConfig: (id: number, value: number) => configs.set(id, value),
    }, { get: (target, key) => target[key] ?? (() => sender) });
    const player = { getAttribute: () => 1, getPacketSender: () => sender };
    // The helper route and ordinary Read journal route must agree, including native metadata.
    for (const open of [Q.openJournalById, Q.openQuestJournal]) {
        for (const id of [171, 172, 174, 180]) {
            strings.length = 0;
            open(player, id);
            const row = questRowById(id, cache);
            assert.deepEqual(calls[calls.length - 1], [player, quest, row]);
            assert.equal(configs.get(3679), row.rowId, "latest journal uses the DB row, not the quest id");
            assert.equal(configs.get(4398), 1);
            assert.ok(strings.some(([text, uid]) => uid === ((119 << 16) | 5) && text.includes(row.displayname[0])));
            assert.ok(strings.some(([text, uid]) => uid === ((119 << 16) | 11) && text.includes(`Row ${id}`)));
        }
    }
    Q.openJournal(player, quest);
    assert.equal(calls[calls.length - 1][2], questRowById(106, cache), "direct calls default to the registered parent row");
    Q.journalWidgets(quest, player);
    assert.deepEqual(calls[calls.length - 1], [player, quest, undefined], "headless helper default remains available");
    const count = calls.length;
    Q.openQuestJournal(player, 65535);
    Q.openJournalById(player, -1);
    assert.equal(calls.length, count, "unknown rows do not invoke a registered journal");
});
