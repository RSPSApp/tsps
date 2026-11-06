"use strict";

const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Item } = require("../dist/game/model/Item");
const plugin = require("../plugins/achievements/diaries/KandarinDiaryFinish.plugin");
const core = PluginManager.getCoreApi();
const T = plugin._test;

before(async () => {
  await CachePipeline.initialize(process.cwd());
});

function fixture(t) {
  const player = new Player(null);
  player.setRegistered(true);
  t.mock.method(player, "getSession", () => ({ sendClientPacket: () => true, write: () => true }));
  player.setLocation(new core.Location(2700, 3460, 0));
  const tasks = [];
  const handlers = new Map();
  const api = {
    core,
    persistAttribute() {},
    onCustomEvent(name, handler) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
    emitCustomEvent(name, event) {
      for (const handler of handlers.get(name) ?? []) handler(event);
    },
    onObjectInteraction() {},
    onItemOnItem() {},
    registerArea(area) { this.area = area; },
    sendMultiChatboxPrompt() {},
  };
  plugin.register(api);
  api.onCustomEvent("diary:task", (event) => {
    if (event.diary === "kandarin") tasks.push(event.task);
  });
  return { player, api, tasks };
}

function add(player, id, amount = 1) {
  player.getInventory().add(new Item(id, amount), false);
}

function at(player, x, y, z = 0) {
  player.setLocation(new core.Location(x, y, z));
}

test("Seers' pub stew takes 20 coins and credits only after the stew is received", (t) => {
  const f = fixture(t);
  at(f.player, 2690, 3493);
  add(f.player, core.ItemIdentifiers.COINS, 20);

  T.foresterArms({ player: f.player, pages: [{ page: "Bartender (Forester's Arms)" }], action: "give", stepId: "vK7RXN", handled: false });
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(f.tasks.length, 0);

  T.foresterArms({ player: f.player, pages: [{ page: "Bartender (Forester's Arms)" }], action: "receive", stepId: "EKnotq", handled: false });
  assert.equal(f.player.getInventory().getAmount(T.STEW), 1);
  assert.deepEqual(f.tasks, [T.TASK.stew]);

  const poor = fixture(t);
  T.foresterArms({ player: poor.player, pages: [{ page: "Bartender (Forester's Arms)" }], action: "give", stepId: "vK7RXN", handled: false });
  assert.equal(poor.tasks.length, 0);
});

test("bass must be caught and then cooked in Catherby; another diary task resets it", (t) => {
  const f = fixture(t);
  at(f.player, 2840, 3430);
  T.fishingSuccess({ player: f.player, itemId: T.RAW_BASS });
  T.cookingSuccess({ player: f.player, itemId: T.BASS });
  assert.deepEqual(f.tasks, [T.TASK.bass]);

  const reset = fixture(t);
  at(reset.player, 2840, 3430);
  T.fishingSuccess({ player: reset.player, itemId: T.RAW_BASS });
  reset.api.emitCustomEvent("diary:task", { player: reset.player, diary: "varrock", task: "x", completed: true });
  T.cookingSuccess({ player: reset.player, itemId: T.BASS });
  assert.equal(reset.tasks.length, 0);
});

function progressFixture() {
  const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
  const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
  const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  const diary = Data.BY_KEY.get("kandarin");
  const attributes = new Map();
  const sender = { sendVarbit: () => sender, sendConfig: () => sender };
  const player = {
    isRegistered: () => true,
    getHitpoints: () => 99,
    isDyingReturn: () => false,
    getLocation: () => new core.Location(2840, 3430, 0),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage() {},
    getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues() {} }),
    getEquipment: () => ({ get: () => null }),
  };
  const handlers = new Map();
  const emitted = [];
  const api = {
    core,
    persistAttribute() {},
    onPlayerLogin() {},
    getTaskManager: () => ({ submit() {} }),
    onCustomEvent(name, handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    emitCustomEvent(name, event) {
      for (const handler of handlers.get(name) ?? []) handler(event);
    },
    onObjectInteraction() {},
    onItemOnItem() {},
    registerArea(area) { this.area = area; },
    sendMultiChatboxPrompt() {},
  };
  Progress(api);
  // Production order: AchievementDiaries marks `completed` before this plugin reads it.
  api.onCustomEvent("diary:task", Diaries._test.onTask);
  plugin.register(api);
  api.onCustomEvent("diary:task", (event) => emitted.push({ ...event }));
  return { api, player, diary, Progress, emitted };
}

test("only a newly completed diary task resets an ordered Kandarin sequence; repeats and rejects do not", () => {
  const repeatTask = "catch-a-mackerel-at-catherby";
  const interveningTask = "complete-a-lap-of-the-barbarian-agility-course";

  const repeated = progressFixture();
  repeated.Progress.completeTask(repeated.player, repeated.diary, repeatTask);
  T.fishingSuccess({ player: repeated.player, itemId: T.RAW_BASS });
  repeated.api.emitCustomEvent("diary:task", { player: repeated.player, diary: "kandarin", task: repeatTask });
  T.cookingSuccess({ player: repeated.player, itemId: T.BASS });
  assert.equal(repeated.emitted.some((event) => event.task === T.TASK.bass && event.completed === true), true,
    "an already-completed repeat must not reset the catch-then-cook sequence");

  const rejected = progressFixture();
  T.fishingSuccess({ player: rejected.player, itemId: T.RAW_BASS });
  rejected.api.emitCustomEvent("diary:task", { player: rejected.player, diary: "not-a-diary", task: repeatTask });
  T.cookingSuccess({ player: rejected.player, itemId: T.BASS });
  assert.equal(rejected.emitted.some((event) => event.task === T.TASK.bass && event.completed === true), true,
    "a rejected task must not reset the catch-then-cook sequence");

  const interrupted = progressFixture();
  T.fishingSuccess({ player: interrupted.player, itemId: T.RAW_BASS });
  interrupted.api.emitCustomEvent("diary:task", { player: interrupted.player, diary: "kandarin", task: interveningTask });
  assert.equal(interrupted.emitted.some((event) => event.task === interveningTask && event.completed === true), true);
  T.cookingSuccess({ player: interrupted.player, itemId: T.BASS });
  assert.equal(interrupted.emitted.some((event) => event.task === T.TASK.bass), false,
    "a newly completed intervening task resets the catch-then-cook sequence");
});

test("super antipoison starts with mixing a clean irit into water, without an extra cleaning step", (t) => {
  const f = fixture(t);
  at(f.player, 2700, 3460);
  T.herbloreMade({ player: f.player, itemId: T.IRIT_POTION_UNF });
  T.herbloreMade({ player: f.player, itemId: T.SUPERANTIPOISON_3 });
  assert.deepEqual(f.tasks, [T.TASK.superAntipoison]);
});

test("yew longbow needs a Seers yew log, an unstrung bow and stringing, all around Seers", (t) => {
  const f = fixture(t);
  at(f.player, 2700, 3460);
  T.woodcuttingSuccess({ player: f.player, logId: T.YEW_LOGS });
  T.fletchingMade({ player: f.player, itemId: T.YEW_LONGBOW_U });
  assert.equal(f.tasks.length, 0);
  T.fletchingMade({ player: f.player, itemId: T.YEW_LONGBOW });
  assert.deepEqual(f.tasks, [T.TASK.yewLongbow]);
});

test("five sharks need five Catherby catches, five gauntlet cooks and reset on another task", (t) => {
  const f = fixture(t);
  at(f.player, 2840, 3430);
  f.player.getEquipment().setItem(core.Equipment.HANDS_SLOT, new Item(T.COOKING_GAUNTLETS, 1));
  for (let i = 0; i < 5; i++) T.fishingSuccess({ player: f.player, itemId: T.RAW_SHARK });
  for (let i = 0; i < 4; i++) T.cookingSuccess({ player: f.player, itemId: T.SHARK });
  assert.equal(f.tasks.length, 0);
  T.cookingSuccess({ player: f.player, itemId: T.SHARK });
  assert.deepEqual(f.tasks, [T.TASK.sharks]);

  const noGauntlets = fixture(t);
  at(noGauntlets.player, 2840, 3430);
  T.fishingSuccess({ player: noGauntlets.player, itemId: T.RAW_SHARK });
  T.cookingSuccess({ player: noGauntlets.player, itemId: T.SHARK });
  assert.equal(noGauntlets.tasks.length, 0);
});

test("water obelisk grapple credits only the grapple landing on the Catherby shore", (t) => {
  const f = fixture(t);
  at(f.player, 2840, 3434);
  T.agilityObstacle({ player: f.player, shortcut: "Crossbow Tree", method: "grapple" });
  assert.deepEqual(f.tasks, [T.TASK.waterObelisk]);

  const barehanded = fixture(t);
  at(barehanded.player, 2840, 3434);
  T.agilityObstacle({ player: barehanded.player, shortcut: "Crossbow Tree", method: "barehanded" });
  assert.equal(barehanded.tasks.length, 0);

  const reverse = fixture(t);
  at(reverse.player, 2843, 3434);
  T.agilityObstacle({ player: reverse.player, shortcut: "Crossbow Tree", method: "grapple" });
  assert.equal(reverse.tasks.length, 0, "landing on the obelisk side is not the diary task");
});

test("Hemenster chest needs the right chest, 47 Thieving and a lockpick", (t) => {
  const f = fixture(t);
  f.player.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 47);
  add(f.player, core.ItemIdentifiers.LOCKPICK);
  T.hemensterChest({ player: f.player, objectId: T.HEMENSTER_CHEST_ID, object: { getLocation: () => new core.Location(T.HEMENSTER_CHEST.x, T.HEMENSTER_CHEST.y, 0) } });
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.STEEL_ARROWTIPS), 5);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 20);
  assert.deepEqual(f.tasks, [T.TASK.hemensterChest]);

  const wrongChest = fixture(t);
  wrongChest.player.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 47);
  add(wrongChest.player, core.ItemIdentifiers.LOCKPICK);
  T.hemensterChest({ player: wrongChest.player, objectId: T.HEMENSTER_CHEST_ID, object: { getLocation: () => new core.Location(2650, 3659, 0) } });
  assert.equal(wrongChest.tasks.length, 0);
});

test("Fancy stone redecorating by the Seers estate agent credits; other styles do not", (t) => {
  const f = fixture(t);
  T.houseRedecorated({ player: f.player, style: T.FANCY_STONE_STYLE, npc: { getLocation: () => new core.Location(T.SEERS_AGENT.x, T.SEERS_AGENT.y, 0) } });
  assert.deepEqual(f.tasks, [T.TASK.estateAgent]);

  const other = fixture(t);
  T.houseRedecorated({ player: other.player, style: "Basic wood", npc: { getLocation: () => new core.Location(T.SEERS_AGENT.x, T.SEERS_AGENT.y, 0) } });
  assert.equal(other.tasks.length, 0);
});

test("Barbarian Assault blackboard needs level 5 in every role", (t) => {
  const f = fixture(t);
  T.blackboardRead({ player: f.player, objectId: T.BA_BLACKBOARD[0], handled: false });
  assert.equal(f.tasks.length, 0);
  for (const role of ["attacker", "collector", "defender", "healer"]) f.player.setAttribute(`barbarian-assault:level-${role}`, 5);
  T.blackboardRead({ player: f.player, objectId: T.BA_BLACKBOARD[0], handled: false });
  assert.deepEqual(f.tasks, [T.TASK.blackboard]);
});

test("granite body credits only after buying it from the Assault and equipping it", (t) => {
  const f = fixture(t);
  T.graniteBodyBought({ player: f.player });
  f.player.getEquipment().setItem(core.Equipment.BODY_SLOT, new Item(T.GRANITE_BODY, 1));
  T.equipmentChanged({ player: f.player });
  assert.deepEqual(f.tasks, [T.TASK.graniteBody]);

  const plain = fixture(t);
  plain.player.getEquipment().setItem(core.Equipment.BODY_SLOT, new Item(T.GRANITE_BODY, 1));
  T.equipmentChanged({ player: plain.player });
  assert.equal(plain.tasks.length, 0);
});

test("a stamina mix made on top of the Seers bank counts, one made below does not", (t) => {
  const f = fixture(t);
  at(f.player, 2729, 3491, 3);
  T.staminaMix({ player: f.player, itemId: T.STAMINA_MIX_2 });
  assert.deepEqual(f.tasks, [T.TASK.staminaMix]);

  const other = fixture(t);
  at(other.player, 2729, 3491, 3);
  T.staminaMix({ player: other.player, itemId: T.STAMINA_POTION_2 });
  assert.equal(other.tasks.length, 0);

  const ground = fixture(t);
  at(ground.player, 2700, 3460, 0);
  T.staminaMix({ player: ground.player, itemId: T.STAMINA_MIX_2 });
  assert.equal(ground.tasks.length, 0);
});

test("pet fish needs a tiny net and a fishbowl with water and seaweed in Harry's shop", (t) => {
  const f = fixture(t);
  add(f.player, T.TINY_NET);
  add(f.player, 6669);
  f.player.getSkillManager().setCurrentLevels(core.Skill.FISHING, 10);
  T.fishPet({ player: f.player, objectId: T.AQUARIUM_ID });
  assert.equal(f.player.getInventory().getAmount(6669), 0);
  assert.equal(T.PET_FISH_IDS.some((id) => f.player.getInventory().contains(id)), true);
  assert.deepEqual(f.tasks, [T.TASK.petFish]);
});

test("a candle bought from the Candle Shop credits the easy task", (t) => {
  const f = fixture(t);
  T.setCandleShopId(1495);
  T.candlePurchased({ player: f.player, shopId: 1495, itemId: T.CANDLE });
  assert.deepEqual(f.tasks, [T.TASK.candle]);
  T.resetCandleShop();
});

test("the candle shop opens on the tick after the dialogue closes, not under it", (t) => {
  const f = fixture(t);
  T.setCandleShopId(1495);
  f.player.setInterfaceId(-1);
  let opened = null;
  t.mock.method(core.ShopManager, "open", (...args) => { opened = args; return true; });
  let submitted = null;
  t.mock.method(core.TaskManager, "submit", (task) => { submitted = task; });
  const event = { player: f.player, action: "open_interface", target: "Candle Shop", handled: false };
  T.openCandleShop(event);
  assert.equal(event.handled, true);
  assert.equal(event.end, true);
  assert.equal(opened, null, "the closing dialogue would close a shop opened under it");
  assert.ok(submitted, "the shop open is deferred");
  submitted.execute();
  assert.deepEqual(opened, [f.player, 1495, true]);
  T.resetCandleShop();
});


test("bow Firemaking credits Maple logs lit in Seers only", (t) => {
  const f = fixture(t);
  at(f.player, 2700, 3460);
  T.firemakingSuccess({ player: f.player, itemId: T.MAPLE_LOGS, bow: true });
  assert.deepEqual(f.tasks, [T.TASK.bowFiremaking]);

  const noBow = fixture(t);
  at(noBow.player, 2700, 3460);
  T.firemakingSuccess({ player: noBow.player, itemId: T.MAPLE_LOGS, bow: false });
  assert.equal(noBow.tasks.length, 0);
});

test("pyre ship credits only chewed bones on a magic-log pyre", (t) => {
  const f = fixture(t);
  T.pyreBuilt({ player: f.player, logsId: T.MAGIC_LOGS, bonesId: T.CHEWED_BONES });
  assert.deepEqual(f.tasks, [T.TASK.pyreShip]);

  const mangled = fixture(t);
  T.pyreBuilt({ player: mangled.player, logsId: T.MAGIC_LOGS, bonesId: 11337 });
  assert.equal(mangled.tasks.length, 0);
});

test("entering the cache-derived courthouse with Piety credits the task", (t) => {
  const f = fixture(t);
  f.player.getPrayerActive = () => ({ [core.PrayerHandler.PIETY]: true });
  f.api.area.postEnter({ isPlayer: () => true, getAsPlayer: () => f.player });
  assert.deepEqual(f.tasks, [T.TASK.courthouse]);

  const noPrayer = fixture(t);
  noPrayer.player.getPrayerActive = () => ({ 26: false });
  noPrayer.api.area.postEnter({ isPlayer: () => true, getAsPlayer: () => noPrayer.player });
  assert.equal(noPrayer.tasks.length, 0);
});


test("Hemenster chest keeps all loot available when two new stacks do not fit", (t) => {
  const f = fixture(t);
  f.player.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 47);
  add(f.player, core.ItemIdentifiers.LOCKPICK);
  add(f.player, 1511, 26);
  assert.equal(f.player.getInventory().getFreeSlots(), 1);
  const event = { player: f.player, objectId: T.HEMENSTER_CHEST_ID, object: { getLocation: () => new core.Location(T.HEMENSTER_CHEST.x, T.HEMENSTER_CHEST.y, 0) } };
  T.hemensterChest(event);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.STEEL_ARROWTIPS), 0);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(f.tasks.length, 0);
  f.player.getInventory().deleteNumber(1511, 1);
  T.hemensterChest(event);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 20);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.STEEL_ARROWTIPS), 5);
  assert.deepEqual(f.tasks, [T.TASK.hemensterChest]);
});

test("Hemenster chest refuses a capped reward stack before granting either reward", (t) => {
  const f = fixture(t);
  f.player.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 47);
  add(f.player, core.ItemIdentifiers.LOCKPICK);
  add(f.player, core.ItemIdentifiers.COINS, 2147483647);
  T.hemensterChest({ player: f.player, objectId: T.HEMENSTER_CHEST_ID, object: { getLocation: () => new core.Location(T.HEMENSTER_CHEST.x, T.HEMENSTER_CHEST.y, 0) } });
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.STEEL_ARROWTIPS), 0);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 2147483647);
  assert.equal(f.tasks.length, 0);
});


test("a pre-made unfinished irit potion alone does not satisfy the from-scratch task", (t) => {
  const f = fixture(t);
  at(f.player, 2700, 3460);
  T.herbloreMade({ player: f.player, itemId: T.SUPERANTIPOISON_3 });
  assert.equal(f.tasks.length, 0);
});
