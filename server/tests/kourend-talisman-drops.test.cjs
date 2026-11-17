// Run after yarn build: node --test tests/kourend-talisman-drops.test.cjs
const assert = require("node:assert/strict");
const { test, before, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Drops = require("../plugins/npcs/NpcDrops.plugin");
const perk = require("../plugins/achievements/KourendTalismanDrops.plugin");
const tables = require("../data/definitions/npc-drops.json").tables;
const diaryPlugin = require("../plugins/achievements/AchievementDiaries.plugin");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const easyTasks = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("kourend").tiers.easy.tasks.map(task => task.key);
const custom = {};
const originalRandom = Math.random;
let player;

before(() => {
  const api = {
    core: PluginManager.getCoreApi(),
    onCustomEvent(name, handler) { (custom[name] ??= []).push(handler); },
    emitCustomEvent(name, event) {
      if (name === "diary:is-complete") {
        assert.equal(event.diary, "kourend");
        assert.equal(event.tier, "easy");
        diaryPlugin._test.onIsComplete(event);
      }
      for (const handler of custom[name] ?? []) handler(event);
    },
    getPluginConfig: (_name, fallback) => fallback,
    getItemOnGroundManager() {}, onNpcDeath() {}, registerCommand() {}, log() {},
  };
  perk.register(api);
  Drops.register(api);
  player = new Player(null);
});

afterEach(() => { Math.random = originalRandom; player.setAttribute(Progress.TASKS_ATTRIBUTE, {}); });

function completeEasy() {
  player.setAttribute(Progress.TASKS_ATTRIBUTE, { kourend: easyTasks });
}

function roll(table, name, value) {
  Math.random = () => value;
  const npc = name === null ? null : { getId: () => 1, getDefinition: () => ({ getName: () => name }) };
  return Drops.__internals.rollTable(table, player, npc, {}).map(drop => drop.itemId);
}

test("lizardmen and brutes double the actual independent talisman roll only after easy completion", () => {
  for (const [key, name] of [["lizardman_drop_table53", "Lizardman"], ["lizardman_drop_table62", "Lizardman"], ["lizardman_brute", "Lizardman brute"]]) {
    const row = tables[key].entries.find(entry => entry.item_id === 13392);
    assert.equal(row.separate_roll, true);
    const table = { entries: [row] };
    assert.deepEqual(roll(table, name, 0.006), [], `${key} before`);
    player.setAttribute(Progress.TASKS_ATTRIBUTE, { kourend: easyTasks.slice(1) });
    assert.deepEqual(roll(table, name, 0.006), [], `${key} incomplete`);
    completeEasy();
    assert.deepEqual(roll(table, name, 0.006), [13392], `${key} after`);
    assert.deepEqual(roll(table, name, 0.0081), [], `${key} beyond 1/125`);
    player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  }
});

test("shaman transfers two of 500 fang slots to the talisman without changing the other slots", () => {
  const rows = tables.lizardman_shaman.entries;
  const fang = rows.find(entry => entry.item_id === 13391);
  const talisman = rows.find(entry => entry.item_id === 13392);
  const table = { main_max_roll: 500, entries: [fang, talisman, { item_id: 995, name: "Coins", weight: 458, out_of: 500, quantity: [1, 1] }] };
  const count = () => {
    const counts = new Map();
    for (let slot = 0; slot < 500; slot++) {
      const [item] = roll(table, "Lizardman shaman", (slot + 0.5) / 500);
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    return [...counts.entries()];
  };
  assert.deepEqual(count(), [[13391, 40], [13392, 2], [995, 458]]);
  completeEasy();
  assert.deepEqual(count(), [[13391, 38], [13392, 4], [995, 458]]);
});

test("no NPC or an unrelated NPC never boosts a talisman roll", () => {
  completeEasy();
  const table = { entries: [tables.lizardman_brute.entries.find(entry => entry.item_id === 13392)] };
  assert.deepEqual(roll(table, null, 0.006), []);
  assert.deepEqual(roll(table, "Goblin", 0.006), []);
});
