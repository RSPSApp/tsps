// Run after `yarn build`: node --test tests/kourend-skills-finish-diary.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Finish = require("../plugins/achievements/diaries/KourendDiarySkillsFinish.plugin");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Dormant = require("../plugins/npcs/DormantNpcs.plugin");
const Mining = require("../plugins/skills/Mining.plugin");
const Saltpetre = require("../plugins/skills/mining/Saltpetre.Mining");
const SulphurMine = require("../plugins/areas/SulphurMine.plugin");
let Lectern;

let core;
let emit;
const diary = DiaryData.BY_KEY.get("kourend");
const { TASKS, FARMING_GUILD } = Finish._test;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const listeners = new Map();
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
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  Progress(api);
  api.onCustomEvent("diary:task", Diaries._test.onTask);
  Finish.register(api);
  PluginManager.emitCustomEvent = emit;
  SulphurMine.register({ core, registerArea() {} });
  require("../plugins/skills/construction/Core.Construction").init({ core, emitCustomEvent: emit });
  Lectern = require("../plugins/skills/construction/Lectern.Construction");
});

function fixture(t, { at = [1750, 3470, 0], privateArea = null } = {}) {
  const player = new Player(null, new core.Location(...at));
  player.setIndex(2600 + Math.floor(Math.random() * 1000));
  player.setUsername("kourend-skills-finish-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.getPrivateArea = () => privateArea;
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  t.after(() => player.setRegistered(false));
  return player;
}

function done(player, task) {
  return Progress.doneTasks(player, diary).has(task);
}

test("saltpetre, volcanic sulphur, the Ape Atoll tablet and the guild battlestaff each credit their own task", (t) => {
  const player = fixture(t);
  emit("mining:saltpetre", { player, amount: 2 });
  assert.equal(done(player, TASKS.saltpetre), true);

  emit("mining:success", { player, skill: core.Skill.MINING, itemId: core.ItemIdentifiers.VOLCANIC_SULPHUR });
  assert.equal(done(player, TASKS.sulphur), true);

  emit("construction:tablet-made", { player, itemId: core.ItemIdentifiers.APE_ATOLL_TELEPORT, amount: 1, lectern: "arceuus" });
  assert.equal(done(player, TASKS.apeAtollTablet), true);

  const guild = fixture(t, { at: [1243, 3749, 0] });
  emit("fletching:made", { player: guild, itemId: core.ItemIdentifiers.BATTLESTAFF, amount: 1 });
  assert.equal(done(guild, TASKS.battlestaff), true);
  assert.deepEqual(Finish._test.inside(new Location(1243, 3749, 0), FARMING_GUILD), true);
});

test("other ores, tablets and products, and a battlestaff outside the Farming Guild, do not credit", (t) => {
  const player = fixture(t);
  emit("mining:success", { player, itemId: core.ItemIdentifiers.LOVAKITE_ORE });
  emit("mining:saltpetre", { player, amount: 0 });
  emit("construction:tablet-made", { player, itemId: core.ItemIdentifiers.BARROWS_TELEPORT });
  const outside = fixture(t, { at: [1250, 3800, 0] });
  emit("fletching:made", { player: outside, itemId: core.ItemIdentifiers.BATTLESTAFF, amount: 1 });
  emit("fletching:made", { player: fixture(t, { at: [1243, 3749, 0] }), itemId: core.ItemIdentifiers.MAGIC_LONGBOW });
  assert.deepEqual(Progress.doneTasks(player, diary).size, 0);
  assert.equal(done(outside, TASKS.battlestaff), false);
});

test("private areas do not earn credit", (t) => {
  const player = fixture(t, { privateArea: {} });
  emit("mining:saltpetre", { player, amount: 1 });
  emit("mining:success", { player, itemId: core.ItemIdentifiers.VOLCANIC_SULPHUR });
  emit("construction:tablet-made", { player, itemId: core.ItemIdentifiers.APE_ATOLL_TELEPORT });
  emit("fletching:made", { player, itemId: core.ItemIdentifiers.BATTLESTAFF });
  assert.equal(Progress.doneTasks(player, diary).size, 0);
});

test("the Sand Crab task accepts Kourend kills but not Varlamore ones", () => {
  const task = require("../data/definitions/dormant-npcs.json").diary.find((entry) => entry.task === "kill-a-sandcrab");
  assert.equal(Dormant._test.inTaskArea(task, new Location(1750, 3470, 0)), true);
  assert.equal(Dormant._test.inTaskArea(task, new Location(2066, 2597, 0)), false);
  assert.equal(Dormant._test.inTaskArea(task, new Location(1670, 9830, 0)), false);
});

test("the volcanic sulphur rock needs 42 Mining, gives 35 XP and a breathing-filter gate", () => {
  const rock = Mining.ROCKS.find((entry) => entry.objectName === "Volcanic sulphur");
  assert.deepEqual(rock.objectIds, [28496, 28497, 28498]);
  assert.equal(rock.level, 42);
  assert.equal(rock.xp, 35);
  assert.equal(rock.requiresBreathingFilter, true);
  assert.deepEqual(rock.chance, [100, 220]);
});

test("the Arceuus lectern lists the Ape Atoll tablet with its Wiki recipe", () => {
  const tablet = Lectern._test.TABLETS.get(core.ItemIdentifiers.APE_ATOLL_TELEPORT);
  assert.deepEqual(tablet.runes, [
    [core.ItemIdentifiers.BLOOD_RUNE, 2],
    [core.ItemIdentifiers.SOUL_RUNE, 2],
    [core.ItemIdentifiers.LAW_RUNE, 2],
  ]);
  assert.equal(tablet.level, 90);
  assert.equal(tablet.experience, 100);
  assert.equal(Lectern._test.wrongSpellbook(fakePlayer(core.MagicSpellbook.NORMAL), { spellbook: core.MagicSpellbook.ARCEUUS }), true);
  assert.equal(Lectern._test.wrongSpellbook(fakePlayer(core.MagicSpellbook.ARCEUUS), { spellbook: core.MagicSpellbook.ARCEUUS }), false);
});

test("saltpetre digging takes one of the three spades and doubles on a low roll", () => {
  Saltpetre.attach({ core, onObjectInteraction() {} });
  const spade = fakeInventory([core.ItemIdentifiers.SPADE]);
  assert.equal(Saltpetre._test.hasSpade({ getInventory: () => spade }), true);
  assert.equal(Saltpetre._test.hasSpade({ getInventory: () => fakeInventory([]) }), false);
  const player = { getSkillManager: () => ({ getCurrentLevel: () => 42 }) };
  assert.equal(Saltpetre._test.amount(player, () => 0.1), 2);
  assert.equal(Saltpetre._test.amount(player, () => 0.9), 1);
});

test("sulphur gas clouds damage a 3x3 square, stacking per cloud and sparing the bank chest", () => {
  assert.equal(SulphurMine._test.damage(true), 1);
  assert.equal(SulphurMine._test.damage(false, () => 0), 1);
  assert.equal(SulphurMine._test.damage(false, () => 0.999), 3);
  assert.equal(SulphurMine._test.inside(new Location(1454, 3859, 0), SulphurMine._test.BANK_CHEST_SAFE), true);

  const cloud = (x, y, index) => ({
    isPlayer: () => false,
    isNpc: () => true,
    getAsNpc() { return this; },
    getArea: () => null,
    getIndex: () => index,
    getId: () => 7070,
    getLocation: () => new Location(x, y, 0),
  });
  const clouds = [cloud(1440, 3869, 1), cloud(1441, 3869, 2), cloud(1444, 3869, 3)];
  const beside = SulphurMine._test.cloudsBeside(new Location(1440, 3869, 0), clouds);
  assert.equal(beside.length, 2, "the cloud four tiles east is out of its 3x3 square");

  const hits = [];
  const player = {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    isRegistered: () => true,
    getHitpoints: () => 99,
    getLocation: () => new Location(1440, 3869, 0),
    getEquipment: () => ({ get: () => ({ getId: () => core.ItemIdentifiers.GAS_MASK }) }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (damage) => hits.push(...damage) }) }),
  };
  const area = SulphurMine._test.sulphurMineArea();
  for (const cloud of clouds) area.enter(cloud);
  area.process(player);
  assert.equal(hits.length, 2, "one hit per cloud beside the player");
  assert.ok(hits.every((hit) => hit.getDamage() === 1), "a breathing filter caps each cloud at 1");
});

function fakePlayer(spellbook) {
  return { getSpellbook: () => spellbook, sendMessage() {} };
}

function fakeInventory(ids) {
  return {
    getItems: () => ids.map((id) => ({ getId: () => id, getAmount: () => 1 })),
  };
}
