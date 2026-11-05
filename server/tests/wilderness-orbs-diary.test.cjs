// Run after `yarn build`: node --test tests/wilderness-orbs-diary.test.cjs
//
// Wilderness Diary, medium "Charge an Earth Orb." and hard "Charge an Air Orb." (OSRS Wiki: Wilderness
// Diary; no place is named beyond casting the spell, which needs its obelisk). Credit is on a charge that
// actually happened: the unpowered orb became the charged one.
// Real engine: every plugin loaded, a real Player and Inventory, the real Obelisk of Earth (2150, Edgeville
// Dungeon 3086,9932) and Obelisk of Air (2152, 3088,3568) as GameObjects at their Wiki tiles, the cache's
// own spell widgets and the real diary progress. The cast enters at PluginManager.emitSpellOnObject, the
// call UseItemPacketListener makes for a spell cast on an object; the packet itself is not driven. No
// capture of the diary notification exists.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// Nothing here needs the bots, whose spawns log hook failures and may keep the process alive.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Skill } = require("../dist/game/model/Skill");

const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const DIARY = Diaries.BY_KEY.get("wilderness");
const EARTH_TASK = "charge-an-earth-orb";
const AIR_TASK = "charge-an-air-orb";
const COSMIC = 564;
const EARTH_RUNE = 557;
const AIR_RUNE = 556;
const WATER_RUNE = 555;
const UNPOWERED_ORB = 567;
const EARTH_ORB = 575;
const AIR_ORB = 573;
const WATER_ORB = 571;
const EARTH_OBELISK = { id: 2150, at: [3086, 9932] };
const AIR_OBELISK = { id: 2152, at: [3088, 3568] };
let core;
let next = 9900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
});

// Plugin-loading tests end the way the server does: the shutdown hooks stop what plugins started, and the
// players this file made give up their tasks (the orb charging loop, the diary's delayed tier check).
const created = [];
after(() => {
  for (const player of created) {
    player.getAttribute("crafting-spells:charging")?.stop();
    TaskManager.cancelTasks(player);
    player.setRegistered(false);
  }
  PluginManager.emitServerShutdown({});
});

function caster(t, obelisk, { magic = 99, orbs = 1, runes = [[COSMIC, 3], [EARTH_RUNE, 30], [AIR_RUNE, 30]] } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("orb" + player.getIndex());
  player.setRegistered(true);
  const [x, y] = obelisk.at;
  player.setLocation(new core.Location(x, y - 1, 0));
  player.needsPlacement = false;
  player.getSkillManager().setMaxLevel(Skill.MAGIC, magic).setCurrentLevel(Skill.MAGIC, magic, false);
  t.mock.method(player.getPacketSender(), "sendMessage", () => player.getPacketSender());
  for (const [id, amount] of runes) player.getInventory().add(new core.Item(id, amount), false);
  if (orbs > 0) player.getInventory().add(new core.Item(UNPOWERED_ORB, orbs), false);
  t.after(() => player.getAttribute("crafting-spells:charging")?.stop());
  created.push(player);
  return player;
}

const credited = (player, task) => DiaryProgress.doneTasks(player, DIARY).has(task);
const held = (player, id) => player.getInventory().getAmount(id);

/** Casts `spellName` on a real obelisk object at its tile. */
function cast(player, spellName, obelisk) {
  const spell = core.CacheDefinitions.getSpellByName(spellName);
  assert.ok(spell, `${spellName} is in the cache`);
  const [x, y] = obelisk.at;
  const object = new core.GameObject(obelisk.id, new core.Location(x, y, 0), 10, 0, null);
  assert.equal(object.getDefinition().getName().startsWith("Obelisk of"), true, "a real obelisk definition");
  return PluginManager.emitSpellOnObject({
    player, object, objectId: obelisk.id, spellWidget: spell.widgetId, spellChild: 0, spellItemId: spell.itemId,
    spellId: 0, location: { x, y, z: 0 }, handled: false,
  });
}

test("Charge Earth Orb on the real Obelisk of Earth makes the orb and credits the medium task", (t) => {
  const player = caster(t, EARTH_OBELISK);
  assert.equal(credited(player, EARTH_TASK), false, "not yet");
  assert.equal(cast(player, "Charge Earth Orb", EARTH_OBELISK), true);
  assert.equal(held(player, EARTH_ORB), 1, "the orb was charged");
  assert.equal(credited(player, EARTH_TASK), true);
  assert.equal(credited(player, AIR_TASK), false, "and only that task");
});

test("Charge Air Orb on the real Obelisk of Air makes the orb and credits the hard task", (t) => {
  const player = caster(t, AIR_OBELISK);
  assert.equal(cast(player, "Charge Air Orb", AIR_OBELISK), true);
  assert.equal(held(player, AIR_ORB), 1);
  assert.equal(credited(player, AIR_TASK), true);
  assert.equal(credited(player, EARTH_TASK), false);
});

test("a cast that charges nothing does not credit: no orb, short of runes, short of the level, the wrong obelisk", (t) => {
  const noOrb = caster(t, EARTH_OBELISK, { orbs: 0 });
  cast(noOrb, "Charge Earth Orb", EARTH_OBELISK);
  assert.equal(credited(noOrb, EARTH_TASK), false, "no unpowered orb");
  const poor = caster(t, EARTH_OBELISK, { runes: [[COSMIC, 3], [EARTH_RUNE, 29]] });
  cast(poor, "Charge Earth Orb", EARTH_OBELISK);
  assert.equal(held(poor, EARTH_ORB), 0);
  assert.equal(credited(poor, EARTH_TASK), false, "29 earth runes");
  const low = caster(t, EARTH_OBELISK, { magic: 59 });
  cast(low, "Charge Earth Orb", EARTH_OBELISK);
  assert.equal(held(low, EARTH_ORB), 0);
  assert.equal(credited(low, EARTH_TASK), false, "Magic 59");
  const lowAir = caster(t, AIR_OBELISK, { magic: 65 });
  cast(lowAir, "Charge Air Orb", AIR_OBELISK);
  assert.equal(held(lowAir, AIR_ORB), 0);
  assert.equal(credited(lowAir, AIR_TASK), false, "Magic 65");
  const wrong = caster(t, AIR_OBELISK);
  cast(wrong, "Charge Earth Orb", AIR_OBELISK);
  assert.equal(held(wrong, EARTH_ORB), 0, "the earth spell on the air obelisk made no orb");
  assert.equal(credited(wrong, EARTH_TASK), false);
});

test("another orb spell does not credit these tasks", (t) => {
  const player = caster(t, EARTH_OBELISK, { runes: [[COSMIC, 3], [WATER_RUNE, 30]] });
  cast(player, "Charge Water Orb", { id: 2151, at: EARTH_OBELISK.at });
  assert.equal(held(player, WATER_ORB), 1, "a water orb was made");
  assert.equal(credited(player, EARTH_TASK), false);
  assert.equal(credited(player, AIR_TASK), false);
});

test("repeat charging makes every orb and credits the one task once", (t) => {
  const player = caster(t, EARTH_OBELISK, { orbs: 3, runes: [[COSMIC, 9], [EARTH_RUNE, 90]] });
  cast(player, "Charge Earth Orb", EARTH_OBELISK);
  for (let i = 0; i < 40; i++) TaskManager.process();
  assert.equal(held(player, EARTH_ORB), 3, "all three orbs were charged");
  assert.equal(held(player, UNPOWERED_ORB), 0);
  assert.equal(credited(player, EARTH_TASK), true);
  assert.equal(DiaryProgress.doneTasks(player, DIARY).size, 1, "one task, however many orbs");
});
