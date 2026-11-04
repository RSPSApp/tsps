import assert from "node:assert/strict";
import { before, test } from "node:test";
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions as cache } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";
const { nativeQuestRows, questListGroups, metadata } = require("../plugins/quests/QuestList.QuestRuntime");

before(async () => CachePipeline.initialize(process.cwd()));
const pirate = { key: "pirate", name: "Pirate's Treasure" };
const elemental = { key: "elemental", name: "Elemental Workshop I" };
const rfd = { key: "rfd", name: "Recipe for Disaster" };

test("cache identities survive all twelve sorts and status/type filters", () => {
    const mini = () => ({ key: "mini", name: [...metadata(cache).values()].find((row: any) => row.type?.[0] === 1).displayname[0] });
    for (let sort = 0; sort < 12; sort++) {
        for (const hide of [0, 13773, 13774, 13776]) {
            const player = {
                getPacketSender: () => ({ getVarbit: (id: number) => id === 13772 ? sort : id === hide ? 1 : 0 }),
                getAttribute: () => 999,
                getSkillManager: () => ({ getMaxLevels: () => 99, getCombatLevel: () => 126 }),
            };
            const slots: any[] = [];
            for (const group of questListGroups([pirate, elemental, rfd, mini()], player, cache, () => 1)) {
                if (group.title) slots.push(null);
                slots.push(...group.quests.map((entry: any) => entry.quest));
            }
            const rows = nativeQuestRows(slots, cache);
            assert.equal(new Set(rows.map((row: any) => row.nativeSlot)).size, rows.length);
            for (const [quest, nativeSlot] of [[pirate, 16], [elemental, 55], [rfd, 106]] as const) {
                const expected = slots.indexOf(quest);
                assert.equal(rows.find((row: any) => row.nativeSlot === nativeSlot)?.slot, expected < 0 ? undefined : expected);
            }
            assert.equal(rows.some((row: any) => row.nativeSlot === 17), false, "unregistered Prince Ali Rescue cannot select another quest");
        }
    }
});

test("RFD subrows resolve to its combined journal, with an exact registration taking precedence", () => {
    assert.deepEqual(nativeQuestRows([null, rfd], cache).map((row: any) => row.nativeSlot),
        [106, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180]);
    const child = { key: "pete", name: "Recipe for Disaster - Pirate Pete" };
    const rows = nativeQuestRows([null, rfd, child], cache);
    assert.equal(rows.find((row: any) => row.nativeSlot === 174)?.slot, 2);
    assert.equal(rows.find((row: any) => row.nativeSlot === 175)?.slot, 1);
    assert.deepEqual(nativeQuestRows([], cache), [], "filtered or absent registrations have no native click target");
});
