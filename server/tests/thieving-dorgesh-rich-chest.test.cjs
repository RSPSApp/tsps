// Run after yarn build: node --test tests/thieving-dorgesh-rich-chest.test.cjs
const assert = require("node:assert/strict");
const { before, beforeEach, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Chest = require("../plugins/skills/thieving/DorgeshKaanRichChest.Thieving");

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const CHEST_TILE = [2700, 5348, 1];
let ids;
let hooks;
let tasks;
let objects;
let events;
let eliteDone;
let playerIndex = 28700;
const startXp = new WeakMap();

function advance(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const task of [...tasks]) if (task.isRunning()) task.tick();
  }
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.ObjectDefinition.init();
  ids = {
    chest: core.CacheDefinitions.getLocId("dorgesh_rich_chest_closed"),
    open: core.CacheDefinitions.getLocId("dorgesh_rich_chest_open"),
    empty: core.CacheDefinitions.getLocId("dorgesh_rich_chest_closed_empty"),
    seq: core.CacheDefinitions.getSeqId("human_lockedchest"),
    busy: core.CacheDefinitions.getVarbitId("busy"),
  };
  assert.deepEqual(core.ObjectDefinition.forId(ids.chest).getInteractions().slice(0, 2), ["Open", "Pick-lock"]);
  hooks = new Map();
  Chest({
    core: {
      ...core,
      TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); } },
      ObjectManager: {
        register: (object) => objects.push(["add", object.getId()]),
        deregister: (object) => objects.push(["remove", object.getId()]),
      },
    },
    onObjectInteraction: (name, actions) => hooks.set(name, actions),
    emitCustomEvent: (name, request) => {
      events.push([name, request]);
      if (name === "diary:is-complete" && request.diary === "lumbridge" && request.tier === "elite") request.complete = eliteDone;
    },
  });
});

beforeEach(() => {
  Chest._test.reset();
  tasks = [];
  objects = [];
  events = [];
  eliteDone = false;
});

function playerFixture(t, { level = 78, base = level, lockpick = "LOCKPICK", filledSlots = 0 } = {}) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null, new core.Location(2700, 5349, 1));
  player.setIndex(playerIndex++);
  player.setUsername(`dorgesh-rich-chest-${playerIndex}`);
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  player.getSkillManager().setExperiences(core.Skill.THIEVING, SkillManager.getExperienceForLevel(base), false);
  player.getSkillManager().setCurrentLevel(core.Skill.THIEVING, level, false);
  startXp.set(player, player.getSkillManager().getExperience(core.Skill.THIEVING));
  player.getPrivateArea = () => null;
  const log = { messages: [], spam: [], sounds: [], varbits: [], animations: [] };
  player.sendMessage = (message) => log.messages.push(message);
  player.performAnimation = (animation) => log.animations.push(animation.getId());
  const sender = new Proxy({}, {
    get: (_target, key) => {
      if (key === "sendTypedMessage") return (type, text) => { (type === core.ChatType.SPAM ? log.spam : log.messages).push(text); return sender; };
      if (key === "sendSound") return (...args) => { log.sounds.push(args); return sender; };
      if (key === "sendVarbit") return (id, value) => { log.varbits.push([id, value]); return sender; };
      return () => sender;
    },
  });
  player.getPacketSender = () => sender;
  if (lockpick) player.getInventory().add(new core.Item(I[lockpick], 1), false);
  for (let slot = 0; slot < filledSlots; slot++) player.getInventory().add(new core.Item(I.WHIP, 1), false);
  t.after(() => player.setRegistered(false));
  return { player, log };
}

function chestObject(id = ids.chest) {
  return new core.GameObject(id, new core.Location(...CHEST_TILE), 10, 0, null);
}

function pick(player, object = chestObject()) {
  const event = { player, object, objectId: object.getId(), option: "pick-lock", handled: false };
  const result = hooks.get("Chest")["Pick-lock"](event);
  return { event, result, object };
}

const xp = (player) => player.getSkillManager().getExperience(core.Skill.THIEVING) - startXp.get(player);
/** What TaskManager.cancelTasks does on a walk or object click: stop the player's tasks. */
const cancelTasks = (player) => { for (const task of tasks) if (task.getKey?.() === player.getIndex() || task.key === player.getIndex()) task.stop(); };
const diaryTasks = () => events.filter(([name]) => name === "diary:task").map(([, request]) => request.task);

test("a pick-lock plays the captured timeline, loots once and credits the Lumbridge elite task", (t) => {
  Chest._test.setRandom(() => 11 / 15); // row 12: iron bar
  const { player, log } = playerFixture(t);
  const { event } = pick(player);
  assert.equal(event.handled, true);
  assert.deepEqual(log.spam, ["You attempt to pick the lock.", "You manage to pick the lock."]);
  assert.deepEqual(log.sounds, [[2419, 1, 0]]);

  advance(1);
  assert.deepEqual(log.varbits, [[ids.busy, 1]]);
  advance(1);
  assert.equal(log.spam.at(-1), "You open the chest.");
  assert.deepEqual(log.sounds.at(-1), [52, 1, 0]);
  advance(1);
  assert.equal(player.getInventory().getAmount(I.IRON_BAR), 0);
  advance(1);
  assert.equal(log.spam.at(-1), "You find treasure inside!");
  assert.deepEqual(log.animations, [ids.seq]);
  assert.equal(player.getInventory().getAmount(I.IRON_BAR), 1);
  assert.equal(xp(player), Chest._test.XP);
  assert.deepEqual(diaryTasks(), ["steal-from-a-dorgesh-kaan-rich-chest"]);
  assert.deepEqual(objects, [["remove", ids.chest], ["add", ids.open]]);

  advance(2);
  assert.equal(objects.length, 2);
  assert.deepEqual(log.varbits, [[ids.busy, 1]]);
  advance(1);
  assert.deepEqual(objects.slice(2), [["remove", ids.open], ["add", ids.empty]]);
  assert.deepEqual(log.varbits, [[ids.busy, 1], [ids.busy, 0]]);

  advance(Chest._test.RESPAWN_TICKS - 1);
  assert.equal(objects.length, 4);
  advance(1);
  assert.deepEqual(objects.slice(4), [["remove", ids.empty], ["add", ids.chest]]);
  advance(20);
  assert.equal(player.getInventory().getAmount(I.IRON_BAR), 1);
  assert.equal(xp(player), Chest._test.XP);
});

test("the loot table has the Wiki's 15 rows, and cave goblin wire is 2 with the elite diary", (t) => {
  assert.equal(Chest._test.LOOT.length, 15);
  for (const [key] of Chest._test.LOOT) assert.equal(typeof I[key], "number", key);
  assert.equal(I.MINING_HELMET_2, 5014); // Wiki: the unlit Mining helmet
  assert.equal(I.BULLSEYE_LANTERN, 4548); // Wiki: the unlit Bullseye lantern

  for (const [elite, amount] of [[false, 1], [true, 2]]) {
    Chest._test.reset();
    tasks = [];
    eliteDone = elite;
    Chest._test.setRandom(() => 12 / 15); // row 13: cave goblin wire
    const { player } = playerFixture(t);
    pick(player);
    advance(4);
    assert.equal(player.getInventory().getAmount(I.CAVE_GOBLIN_WIRE), amount);
  }
});

test("level, lockpick and inventory refusals start nothing; a hair clip picks it", (t) => {
  for (const [options, message] of [
    [{ level: 77 }, Chest._test.MESSAGE.LEVEL],
    [{ level: 80, base: 77 }, Chest._test.MESSAGE.LEVEL], // Wiki: Boostable=No
    [{ lockpick: null }, Chest._test.MESSAGE.LOCKPICK],
  ]) {
    const { player, log } = playerFixture(t, options);
    assert.equal(pick(player).event.handled, true);
    assert.deepEqual(log.messages, [message]);
    assert.deepEqual(log.spam, []);
    assert.equal(tasks.length, 0);
  }
  const full = playerFixture(t, { filledSlots: 27 });
  pick(full.player);
  assert.deepEqual(full.log.spam, []);
  assert.equal(tasks.length, 0);

  const clip = playerFixture(t, { lockpick: "HAIR_CLIP" });
  pick(clip.player);
  advance(4);
  assert.equal(xp(clip.player), Chest._test.XP);
});

test("an emptied chest is not looted again by anyone until it refills; other chests and ids are not ours", (t) => {
  const first = playerFixture(t);
  const second = playerFixture(t);
  const shared = chestObject();
  pick(first.player, shared);
  pick(second.player, shared);
  advance(4);
  assert.equal(xp(first.player), Chest._test.XP);
  assert.equal(xp(second.player), 0);
  assert.equal(diaryTasks().length, 1);

  const late = playerFixture(t);
  assert.equal(pick(late.player).result, false);
  assert.equal(pick(late.player, chestObject(ids.empty)).result, false);
  const elsewhere = new core.GameObject(ids.chest, new core.Location(2703, 5348, 1), 10, 0, null);
  assert.equal(pick(late.player, elsewhere).event.handled, true);
  assert.equal(pick(late.player, new core.GameObject(11739, new core.Location(...CHEST_TILE), 10, 0, null)).result, false);
});

test("moving away before the loot tick gives nothing and frees the player", (t) => {
  const { player, log } = playerFixture(t);
  pick(player);
  advance(2);
  player.setLocation(new core.Location(2701, 5349, 1));
  advance(5);
  assert.equal(xp(player), 0);
  assert.deepEqual(objects, []);
  assert.deepEqual(log.varbits.at(-1), [ids.busy, 0]);
  assert.equal(diaryTasks().length, 0);

  player.setLocation(new core.Location(2700, 5349, 1));
  tasks = [];
  pick(player);
  advance(4);
  assert.equal(xp(player), Chest._test.XP);
});

test("an attempt the engine cancels (a walk, another click) frees the player and resets busy", (t) => {
  const { player, log } = playerFixture(t);
  pick(player);
  advance(1);
  assert.deepEqual(log.varbits, [[ids.busy, 1]]);
  cancelTasks(player);
  assert.deepEqual(log.varbits.at(-1), [ids.busy, 0]);
  advance(10);
  assert.equal(xp(player), 0);
  assert.deepEqual(objects, []);

  const spamBefore = log.spam.length;
  pick(player);
  assert.equal(log.spam.length, spamBefore + 2);
  advance(4);
  assert.equal(xp(player), Chest._test.XP);
  cancelTasks(player); // walking off after the loot, before the chest shuts
  assert.deepEqual(log.varbits.at(-1), [ids.busy, 0]);
  advance(3);
  assert.equal(objects.at(-1)[1], ids.empty);
});

test("an inventory filled before the loot tick ends the attempt and leaves the chest full", (t) => {
  const { player, log } = playerFixture(t, { filledSlots: 26 });
  pick(player);
  advance(2);
  player.getInventory().add(new core.Item(I.WHIP, 1), false);
  advance(5);
  assert.equal(xp(player), 0);
  assert.deepEqual(objects, []);
  assert.equal(diaryTasks().length, 0);
  assert.deepEqual(log.varbits.at(-1), [ids.busy, 0]);
  assert.equal(log.spam.includes("You find treasure inside!"), false);
});
