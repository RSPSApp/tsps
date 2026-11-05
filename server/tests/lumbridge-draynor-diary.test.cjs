const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DiaryPlugin = require("../plugins/achievements/diaries/LumbridgeDraynorDiary.plugin");
const DiaryActions = require("../plugins/achievements/diaries/Actions.AchievementDiaries");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const EliteTaskProgress = require("../plugins/achievements/diaries/ArdougneEliteTaskProgress.plugin");

let core;
let emit;
let emitNpcDeath;
const diary = DiaryData.BY_KEY.get("lumbridge");
const { TASKS, AREAS, ATTRIBUTES } = DiaryPlugin._test;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const listeners = new Map();
  const deathHandlers = [];
  emit = (name, event) => (listeners.get(name) ?? []).forEach((handler) => handler(event));
  const api = new Proxy({
    core,
    onCustomEvent(name, handler) {
      const entries = listeners.get(name) ?? [];
      entries.push(handler);
      listeners.set(name, entries);
    },
    emitCustomEvent: emit,
    persistAttribute() {},
    onNpcDeath(handler) { deathHandlers.push(handler); },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  Progress(api);
  EliteTaskProgress.register(api);
  api.onCustomEvent("diary:task", Diaries._test.onTask);
  DiaryActions(api);
  DiaryPlugin.register(api);
  PluginManager.emitCustomEvent = emit;
  emitNpcDeath = (event) => deathHandlers.forEach((handler) => handler(event));
});

function fixture(t, { at = [3220, 3220, 0], privateArea = null } = {}) {
  const player = new Player(null, new core.Location(...at));
  player.setIndex(2200 + Math.floor(Math.random() * 1000));
  player.setUsername("lumbridge-draynor-diary-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.getPrivateArea = () => privateArea;
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  player.setAttribute(ATTRIBUTES.oakChopped, false);
  player.setAttribute(ATTRIBUTES.amuletStage, 0);
  t.after(() => player.setRegistered(false));
  return player;
}

function done(player, task) {
  return Progress.doneTasks(player, diary).has(task);
}

function count(player, tier) {
  return Progress.tierCount(player, diary, tier);
}

test("successful standard essence altar actions count and enforce rune totals", (t) => {
  const player = fixture(t);
  const items = core.ItemIdentifiers;
  emit("runecrafting:success", {
    player, runeId: items.WATER_RUNE, rolls: 1, amountPerEssence: 1,
    objectId: core.ObjectIdentifiers.ALTAR_35, essenceIds: [items.RUNE_ESSENCE],
  });
  assert.equal(done(player, TASKS.waterRunes), true);
  assert.equal(done(player, TASKS.waterRunesElite), false);
  assert.equal(player.getPacketSender().getVarbit(diary.tiers.easy.countVarbit), 1);

  emit("runecrafting:success", {
    player, runeId: items.WATER_RUNE, rolls: 70, amountPerEssence: 2,
    objectId: core.ObjectIdentifiers.ALTAR_35, essenceIds: [items.PURE_ESSENCE],
  });
  assert.equal(done(player, TASKS.waterRunesElite), true);
  assert.equal(player.getPacketSender().getVarbit(diary.tiers.elite.countVarbit), 1);

  const invalid = fixture(t);
  emit("runecrafting:success", {
    player: invalid, runeId: items.WATER_RUNE, rolls: 100, amountPerEssence: 2,
    objectId: core.ObjectIdentifiers.ALTAR_35, essenceIds: [items.SOUL_SHARD],
  });
  assert.equal(done(invalid, TASKS.waterRunes), false);
  assert.equal(done(invalid, TASKS.waterRunesElite), false);

  const ourania = fixture(t);
  emit("runecrafting:success", {
    player: ourania, runeId: items.WATER_RUNE, rolls: 130, amountPerEssence: 1,
    runeAmount: 140, objectId: core.ObjectIdentifiers.ALTAR_31, essenceIds: [items.DAEYALT_ESSENCE],
  });
  assert.equal(done(ourania, TASKS.waterRunesElite), true, "Ourania's actual rune output and daeyalt essence count");
});

test("Lumbridge oak credit requires both a successful local chop and burn", (t) => {
  const player = fixture(t, { at: [3220, 3220, 0] });
  const items = core.ItemIdentifiers;
  emit("firemaking:success", { player, itemId: items.OAK_LOGS });
  assert.equal(done(player, TASKS.oakLogs), false);
  emit("woodcutting:success", { player, logId: items.OAK_LOGS, location: new core.Location(3221, 3220, 0) });
  emit("firemaking:success", { player, itemId: items.OAK_LOGS });
  assert.equal(done(player, TASKS.oakLogs), true);
  const countBefore = count(player, "easy");
  emit("firemaking:success", { player, itemId: items.OAK_LOGS });
  assert.equal(count(player, "easy"), countBefore, "repeated burns remain idempotent");

  const elsewhere = fixture(t, { at: [3000, 3000, 0] });
  emit("woodcutting:success", { player: elsewhere, logId: items.OAK_LOGS, location: new core.Location(3000, 3000, 0) });
  emit("firemaking:success", { player: elsewhere, itemId: items.OAK_LOGS });
  assert.equal(done(elsewhere, TASKS.oakLogs), false);
});

test("chopping a Lumbridge oak interrupts an unfinished Ardougne Elite task", (t) => {
  const player = fixture(t, { at: [3220, 3220, 0] });
  const task = EliteTaskProgress._test.MANTA_TASK;
  const request = { player, task, stage: "caught" };
  emit(EliteTaskProgress._test.STAGE_EVENT, request);
  const query = () => {
    const result = { player, task };
    emit(EliteTaskProgress._test.QUERY_EVENT, result);
    return result.result;
  };
  assert.deepEqual(query(), { stage: "caught" });

  emit("woodcutting:success", {
    player, logId: core.ItemIdentifiers.OAK_LOGS, location: new core.Location(3221, 3220, 0),
  });
  assert.equal(query(), null);
  assert.equal(done(player, TASKS.oakLogs), false);
});

test("fish, cooking and mining credit only the required catch, output and area", (t) => {
  const items = core.ItemIdentifiers;
  const anchovyPlayer = fixture(t, { at: [3270, 3140, 0] });
  emit("fishing:success", { player: anchovyPlayer, itemId: items.RAW_ANCHOVIES });
  assert.equal(done(anchovyPlayer, TASKS.anchovies), true);
  emit("fishing:success", { player: anchovyPlayer, itemId: items.RAW_SARDINE });
  assert.equal(count(anchovyPlayer, "easy"), 1);

  const breadPlayer = fixture(t, { at: [3210, 3215, 0] });
  emit("cooking:success", {
    player: breadPlayer, itemId: items.BREAD,
    objectId: core.ObjectIdentifiers.COOKING_RANGE,
    objectLocation: new core.Location(3210, 3215, 0),
  });
  assert.equal(done(breadPlayer, TASKS.bread), true);

  const minePlayer = fixture(t, { at: [3298, 3310, 0] });
  emit("mining:success", { player: minePlayer, itemId: items.IRON_ORE });
  assert.equal(done(minePlayer, TASKS.iron), true);
  const wrongMine = fixture(t, { at: [3220, 3220, 0] });
  emit("mining:success", { player: wrongMine, itemId: items.IRON_ORE });
  assert.equal(done(wrongMine, TASKS.iron), false);
});

test("the amulet task requires crafting, stringing and enchanting in Lumbridge", (t) => {
  const player = fixture(t, { at: [3220, 3220, 0] });
  const items = core.ItemIdentifiers;
  emit("skills:produced", { player, skill: core.Skill.CRAFTING, itemId: items.DIAMOND_AMULET, kind: "string" });
  emit("magic:enchanted", {
    player, spellName: "Lvl-4 Enchant", itemId: items.DIAMOND_AMULET, productId: items.AMULET_OF_POWER,
  });
  assert.equal(done(player, TASKS.amulet), false, "out-of-order stages do not award credit");

  emit("skills:produced", { player, skill: core.Skill.CRAFTING, itemId: items.DIAMOND_AMULET_U_, kind: "furnace" });
  emit("skills:produced", { player, skill: core.Skill.CRAFTING, itemId: items.DIAMOND_AMULET, kind: "string" });
  emit("magic:enchanted", {
    player, spellName: "Lvl-4 Enchant", itemId: items.DIAMOND_AMULET, productId: items.AMULET_OF_POWER,
  });
  assert.equal(done(player, TASKS.amulet), true);

  const upstairs = fixture(t, { at: [3220, 3220, 1] });
  emit("skills:produced", { player: upstairs, skill: core.Skill.CRAFTING, itemId: items.DIAMOND_AMULET_U_, kind: "furnace" });
  emit("skills:produced", { player: upstairs, skill: core.Skill.CRAFTING, itemId: items.DIAMOND_AMULET, kind: "string" });
  emit("magic:enchanted", {
    player: upstairs, spellName: "Lvl-4 Enchant", itemId: items.DIAMOND_AMULET, productId: items.AMULET_OF_POWER,
  });
  assert.equal(done(upstairs, TASKS.amulet), false);
});

test("private-area and failed-target events never advance diary progress", (t) => {
  const player = fixture(t, { at: [3270, 3140, 0], privateArea: {} });
  emit("fishing:success", { player, itemId: core.ItemIdentifiers.RAW_ANCHOVIES });
  assert.equal(done(player, TASKS.anchovies), false);
  emit("magic:spell-effect-succeeded", { player, spellName: "Bones to peaches", amount: 2 });
  assert.equal(done(player, TASKS.peaches), false);

  const wrongSpell = fixture(t, { at: [3290, 3170, 0] });
  emit("magic:spell-effect-succeeded", { player: wrongSpell, spellName: "Bones to bananas", amount: 2 });
  assert.equal(done(wrongSpell, TASKS.peaches), false);
});

test("only the successful grapple route across the River Lum counts", (t) => {
  const player = fixture(t, { at: [3246, 3179, 0] });
  emit("agility:obstacle", {
    player, shortcut: "Broken Raft", objectId: 17068, method: "grapple",
    location: { x: 3252, y: 3179, z: 0 },
  });
  assert.equal(done(player, TASKS.riverLumGrapple), true);

  const barehanded = fixture(t, { at: [3246, 3179, 0] });
  emit("agility:obstacle", {
    player: barehanded, shortcut: "Broken Raft", objectId: 17068, method: "barehanded",
    location: { x: 3252, y: 3179, z: 0 },
  });
  assert.equal(done(barehanded, TASKS.riverLumGrapple), false);
});

test("the cave bug and Draynor sewer zombie deaths retain their exact easy task checks", (t) => {
  const player = fixture(t, { at: [3170, 9560, 0] });
  const npc = (id, name, at) => ({
    getId: () => id,
    getPrivateArea: () => null,
    getLocation: () => new core.Location(...at),
    getCurrentDefinition: () => ({ getName: () => name }),
  });
  emitNpcDeath({ killer: player, npc: npc(core.NpcIdentifiers.CAVE_BUG, "Cave bug", [3170, 9560, 0]) });
  assert.equal(done(player, "slay-a-cave-bug-beneath-lumbridge-swamp"), true);

  const wrongBug = fixture(t, { at: [3170, 9560, 0] });
  emitNpcDeath({ killer: wrongBug, npc: npc(core.NpcIdentifiers.CAVE_BUG_2, "Cave bug", [3170, 9560, 0]) });
  assert.equal(done(wrongBug, "slay-a-cave-bug-beneath-lumbridge-swamp"), true);

  const larva = fixture(t, { at: [3170, 9560, 0] });
  emitNpcDeath({ killer: larva, npc: npc(core.NpcIdentifiers.CAVE_BUG_LARVA, "Cave bug larva", [3170, 9560, 0]) });
  assert.equal(done(larva, "slay-a-cave-bug-beneath-lumbridge-swamp"), false);

  const zombie = fixture(t, { at: [3100, 9700, 0] });
  emitNpcDeath({ killer: zombie, npc: npc(core.NpcIdentifiers.ZOMBIE, "Zombie", [3100, 9700, 0]) });
  assert.equal(done(zombie, "kill-a-zombie-in-draynor-sewers"), true);
});
