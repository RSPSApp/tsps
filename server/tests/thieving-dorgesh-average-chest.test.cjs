// Run after yarn build: node --test tests/thieving-dorgesh-average-chest.test.cjs
const assert = require("node:assert/strict");
const { before, beforeEach, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Chest = require("../plugins/skills/thieving/DorgeshKaanChests.Thieving");

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const obj = (name) => core.CacheDefinitions.getObjId(name);
/** A normal ground-floor chest the captures loot (1000195 and the rest), and the player's tile beside it. */
const CHEST_TILE = [2749, 5328, 0];
const PLAYER_TILE = [2748, 5328, 0];
let ids;
let hooks;
let tasks;
let objects;
let events;
let eliteDone;
let canReceiveEasy;
let playerIndex = 28900;
const startXp = new WeakMap();

function advance(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const task of [...tasks]) if (task.isRunning()) task.tick();
  }
}

/** Rolls in order: the row, then the amount when the row has a range. */
function rolls(...values) {
  const queue = [...values];
  Chest._test.setRandom(() => (queue.length ? queue.shift() : 0));
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.ObjectDefinition.init();
  ids = {
    chest: core.CacheDefinitions.getLocId("dorgesh_average_chest_closed"),
    open: core.CacheDefinitions.getLocId("dorgesh_average_chest_open"),
    empty: core.CacheDefinitions.getLocId("dorgesh_average_chest_closed_empty"),
    rich: core.CacheDefinitions.getLocId("dorgesh_rich_chest_closed"),
    seq: core.CacheDefinitions.getSeqId("human_lockedchest"),
    busy: core.CacheDefinitions.getVarbitId("busy"),
  };
  assert.deepEqual([ids.chest, ids.empty, ids.open], [22697, 22698, 22699]);
  assert.deepEqual(core.ObjectDefinition.forId(ids.chest).getInteractions().slice(0, 2), ["Open", "Pick-lock"]);
  hooks = new Map();
  Chest({
    core: {
      ...core,
      TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); } },
      ItemOnGroundManager: { registerLocation: () => {} },
      DialogueChainBuilder: class { constructor() { this.lines = []; } add(dialogue) { this.lines.push(dialogue); return this; } },
      StatementDialogue: class { constructor(index, text) { this.text = text; } },
      ObjectManager: {
        register: (object) => objects.push(["add", object.getId()]),
        deregister: (object) => objects.push(["remove", object.getId()]),
      },
    },
    onObjectInteraction: (name, actions) => hooks.set(name, actions),
    emitCustomEvent: (name, request) => {
      events.push([name, request]);
      if (name === "diary:is-complete" && request.diary === "lumbridge" && request.tier === "elite") request.complete = eliteDone;
      if (name === "treasure-trails:can-receive" && request.tier === "easy") request.allowed = canReceiveEasy;
      if (name === "quest:is-complete") request.complete = false;
    },
  });
});

beforeEach(() => {
  Chest._test.reset();
  tasks = [];
  objects = [];
  events = [];
  eliteDone = false;
  canReceiveEasy = true;
});

function playerFixture(t, { level = 52, base = level, lockpick = "LOCKPICK", tile = PLAYER_TILE } = {}) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null, new core.Location(...tile));
  player.setIndex(playerIndex++);
  player.setUsername(`dorgesh-average-chest-${playerIndex}`);
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  player.getSkillManager().setExperiences(core.Skill.THIEVING, SkillManager.getExperienceForLevel(base), false);
  player.getSkillManager().setCurrentLevel(core.Skill.THIEVING, level, false);
  startXp.set(player, player.getSkillManager().getExperience(core.Skill.THIEVING));
  player.getPrivateArea = () => null;
  const log = { messages: [], spam: [], sounds: [], varbits: [], animations: [], statements: [], faced: [] };
  player.sendMessage = (message) => log.messages.push(message);
  player.performAnimation = (animation) => log.animations.push(animation.getId());
  player.setPositionToFace = (location) => log.faced.push([location.getX(), location.getY()]);
  player.getDialogueManager = () => ({ startDialogues: (chain) => log.statements.push(...chain.lines.map((line) => line.text)) });
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
  t.after(() => player.setRegistered(false));
  return { player, log };
}

function chestObject(id = ids.chest, tile = CHEST_TILE) {
  return new core.GameObject(id, new core.Location(...tile), 10, 3, null);
}

function click(option, player, object = chestObject()) {
  const event = { player, object, objectId: object.getId(), option: option.toLowerCase(), handled: false };
  const result = hooks.get("Chest")[option](event);
  return { event, result, object };
}
const pick = (player, object) => click("Pick-lock", player, object);

const xp = (player) => player.getSkillManager().getExperience(core.Skill.THIEVING) - startXp.get(player);
const diaryTasks = () => events.filter(([name]) => name === "diary:task");

test("a pick-lock plays the captured timeline, loots once for 200 XP and refills 149 ticks after emptying", (t) => {
  rolls(3 / 7); // row 4: oil lantern
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
  advance(2);
  assert.equal(log.spam.at(-1), "You find treasure inside!");
  assert.deepEqual(log.animations, [ids.seq]);
  assert.equal(player.getInventory().getAmount(obj("oil_lantern_unlit")), 1);
  assert.equal(xp(player), 200);
  assert.deepEqual(diaryTasks(), []); // the elite task is the rich chest's
  assert.deepEqual(objects, [["remove", ids.chest], ["add", ids.open]]);
  advance(3);
  assert.deepEqual(objects.slice(2), [["remove", ids.open], ["add", ids.empty]]);
  assert.deepEqual(log.varbits.at(-1), [ids.busy, 0]);
  advance(148);
  assert.equal(objects.length, 4);
  advance(1);
  assert.deepEqual(objects.slice(4), [["remove", ids.empty], ["add", ids.chest]]);
  assert.equal(Chest._test.KINDS.rich.respawnTicks, 499); // the rich chest keeps its own timer
});

test("the normal table: coins 1-250 on three sevenths, then lanterns, helmet and wire; wire is 2 with the elite diary", (t) => {
  const table = Chest._test.AVERAGE_LOOT;
  assert.equal(table.length, 7);
  assert.equal(table.filter(([name]) => name === "coins").length, 3);
  for (const [name] of table) assert.equal(typeof obj(name), "number", name);

  for (const [row, amountRoll, id, amount] of [
    [0, 0, I.COINS, 1],
    [2 / 7, 0.9999, I.COINS, 250],
    [4 / 7, 0, obj("bullseye_lantern_unlit"), 1],
    [5 / 7, 0, obj("cave_goblin_mining_helmet_unlit"), 1],
    [6 / 7, 0, obj("dorgesh_wire"), 1],
  ]) {
    Chest._test.reset();
    tasks = [];
    rolls(row, amountRoll);
    const { player } = playerFixture(t);
    pick(player);
    advance(4);
    assert.equal(player.getInventory().getAmount(id), amount, `row ${row}`);
  }

  Chest._test.reset();
  tasks = [];
  eliteDone = true;
  rolls(6 / 7);
  const { player } = playerFixture(t);
  pick(player);
  advance(4);
  assert.equal(player.getInventory().getAmount(obj("dorgesh_wire")), 2);
});

test("Zanik's chests roll their 23-row table; the easy clue is coins once the player can't take another", (t) => {
  const table = Chest._test.ZANIK_LOOT;
  assert.equal(table.length, 23);
  for (const [name] of table) if (name !== "clue") assert.equal(typeof obj(name), "number", name);
  const zanik = Chest._test.ZANIK_CHESTS.map((key) => key.split(",").map(Number));
  assert.deepEqual(zanik, [[2743, 5350, 2], [2746, 5350, 2]]);

  rolls(0); // row 1: the easy clue
  const free = playerFixture(t, { tile: [2743, 5351, 2] });
  pick(free.player, chestObject(ids.chest, zanik[0]));
  advance(4);
  assert.equal(free.player.getInventory().getAmount(I.CLUE_SCROLL_EASY_), 1);

  Chest._test.reset();
  tasks = [];
  canReceiveEasy = false;
  rolls(0, 0.5);
  const holder = playerFixture(t, { tile: [2746, 5351, 2] });
  pick(holder.player, chestObject(ids.chest, zanik[1]));
  advance(4);
  assert.equal(holder.player.getInventory().getAmount(I.CLUE_SCROLL_EASY_), 0);
  assert.equal(holder.player.getInventory().getAmount(I.COINS), 126);

  Chest._test.reset();
  tasks = [];
  rolls(8 / 23, 0.9999); // row 9: bone bolts 1-89
  const bolts = playerFixture(t, { tile: [2743, 5351, 2] });
  pick(bolts.player, chestObject(ids.chest, zanik[0]));
  advance(4);
  assert.equal(bolts.player.getInventory().getAmount(obj("dttd_bone_crossbow_bolt")), 89);
});

test("Oldak's chest rolls its 20-row table of runes, talismans and orbs", (t) => {
  const table = Chest._test.OLDAK_LOOT;
  assert.equal(table.length, 20);
  for (const [name] of table) assert.equal(typeof obj(name), "number", name);
  const oldak = Chest._test.OLDAK_CHESTS[0].split(",").map(Number);
  assert.deepEqual(oldak, [2706, 5364, 2]);
  for (const [row, amountRoll, id, amount] of [
    [0, 0, I.AIR_RUNE, 10],
    [6 / 20, 0.9999, I.COSMIC_RUNE, 9],
    [10 / 20, 0, I.DEATH_RUNE, 2],
    [11 / 20, 0, obj("dorgesh_teleport_artifact"), 1],
    [19 / 20, 0, I.FIRE_TALISMAN, 1],
  ]) {
    Chest._test.reset();
    tasks = [];
    rolls(row, amountRoll);
    const { player } = playerFixture(t, { tile: [2706, 5365, 2] });
    pick(player, chestObject(ids.chest, oldak));
    advance(4);
    assert.equal(player.getInventory().getAmount(id), amount, `row ${row}`);
  }
});

test("too low a level: the attempt line and a message box, nothing else (1000416)", (t) => {
  for (const options of [{ level: 51 }, { level: 55, base: 51 }]) {
    const { player, log } = playerFixture(t, options);
    assert.equal(pick(player).event.handled, true);
    assert.deepEqual(log.spam, ["You attempt to pick the lock."]);
    assert.deepEqual(log.sounds, []);
    assert.deepEqual(log.messages, []);
    assert.deepEqual(log.statements, ["You are not a high enough level to pick this lock."]);
    assert.equal(tasks.length, 0);
  }
  const lockless = playerFixture(t, { lockpick: null });
  pick(lockless.player);
  assert.deepEqual(lockless.log.messages, ["You need a lockpick to pick this lock."]);
  assert.equal(tasks.length, 0);
});

test("an emptied chest says it's been looted; Open on a full one is locked; others' chests pass through", (t) => {
  const { player, log } = playerFixture(t);
  const empty = pick(player, chestObject(ids.empty));
  assert.equal(empty.event.handled, true);
  assert.deepEqual(log.messages, ["It looks like this chest has already been looted."]);
  assert.deepEqual(log.faced, [[2749, 5328]]);
  assert.equal(tasks.length, 0);

  const opened = click("Open", player);
  assert.equal(opened.event.handled, true);
  assert.deepEqual(log.sounds, [[2402, 1, 0]]);
  assert.equal(log.messages.at(-1), "This chest is locked.");

  assert.equal(click("Open", player, chestObject(ids.empty)).result, false);
  assert.equal(click("Open", player, chestObject(ids.rich)).result, false);
  assert.equal(click("Open", player, chestObject(11739)).result, false);
  assert.equal(pick(player, chestObject(11739)).result, false);
});

test("a chest looted by one player is taken for the next until it refills", (t) => {
  rolls(3 / 7);
  const first = playerFixture(t);
  const second = playerFixture(t);
  const shared = chestObject();
  pick(first.player, shared);
  pick(second.player, shared);
  advance(4);
  assert.equal(xp(first.player), 200);
  assert.equal(xp(second.player), 0);
  assert.equal(pick(second.player, shared).result, false);
});
