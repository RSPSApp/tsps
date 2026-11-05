"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const ROOT = path.resolve(__dirname, "..");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const { PrivateArea } = require("../dist/game/model/areas/impl/PrivateArea");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const Doors = require("../plugins/objects/Doors.plugin");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DoorDiary = require("../plugins/achievements/diaries/ArdougneYanilleDoorDiary.plugin");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");

const DOOR = 11728;
const DOOR_AT = [2601, 9482, 0];
const SOUTH = [2601, 9483, 0];
const DOORWAY = [2601, 9482, 0];
const NORTH = [2601, 9481, 0];
let core;
let diary;
let packet;

before(async () => {
  await CachePipeline.initialize(ROOT);
  core = PluginManager.getCoreApi();
  RegionManager.init();
  RegionManager.loadMapFiles(DOOR_AT[0], DOOR_AT[1]);
  const api = PluginManager.createApi("ArdougneYanilleDoorDiaryTest");
  const startup = [];
  Doors.register({ ...api, onServerStartup: (handler) => startup.push(handler) });
  startup.forEach((handler) => handler());
  Diaries.register(api);
  DoorDiary.register(api);
  packet = new ObjectActionPacketListener();
  diary = DiaryData.BY_KEY.get("ardougne");
  assert.equal(core.CacheDefinitions.getObject(DOOR).actions[1], "Pick-lock");
  assert.ok(MapObjects.get(DOOR, new Location(...DOOR_AT), null), "the cache map contains the lock door");
});

let nextIndex = 2000;
function player(at, { level = 82, baseLevel = level, lockpick = true, privateArea = null, hitpoints = 10 } = {}) {
  const actor = new Player(null);
  actor.setIndex(nextIndex++);
  actor.setRegistered(true);
  actor.setNeedsPlacement(false);
  actor.getSession = () => ({ sendClientPacket() {}, write() {} });
  actor.getPrivateArea = () => privateArea;
  actor.getHitpoints = () => hitpoints;
  actor.isDyingReturn = () => false;
  actor.messages = [];
  const send = actor.getPacketSender.bind(actor);
  actor.getPacketSender = () => {
    const sender = send();
    sender.sendMessage = (message) => actor.messages.push(String(message));
    return sender;
  };
  actor.sendMessage = (message) => actor.messages.push(String(message));
  actor.moveTo(new Location(...at));
  actor.getSkillManager().setMaxLevels(core.Skill.THIEVING, baseLevel, false);
  actor.getSkillManager().setCurrentLevels(core.Skill.THIEVING, level);
  actor.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  if (lockpick) actor.getInventory().add(new core.Item(core.ItemIdentifiers.LOCKPICK), false);
  return actor;
}

function click(actor, option) {
  actor.setNeedsPlacement(false);
  let execute;
  actor.getMovementQueue().walkToObject = (_object, options) => { execute = options.execute; return true; };
  packet.executeAction(actor, DOOR, ...DOOR_AT.slice(0, 2), undefined, option);
  if (typeof execute !== "function") return false;
  execute();
  return true;
}

function isDone(actor) {
  return Progress.doneTasks(actor, diary).has(DoorDiary._test.TASK);
}

function restoreClosedDoor() {
  const opened = [...ObjectManager.objectsAt(new Location(...DOOR_AT))]
    .find((object) => object.getId() === DOOR && object.getFace() !== 3);
  if (!opened) return;
  click(player(SOUTH), "Open");
}

test("a successful lockpick at boosted level 82 opens the mapped door, changes collision, grants 50 XP, and completes Elite", (t) => {
  const actor = player(NORTH, { level: 82, baseLevel: 81 });
  t.mock.method(Math, "random", () => 0);
  const xpBefore = actor.getSkillManager().getExperience(core.Skill.THIEVING);
  const beforeRoute = new core.RsmodRouteFinding().findRoute({ level: 1, srcX: NORTH[0], srcY: NORTH[1], srcSize: 1,
    destX: SOUTH[0], destY: SOUTH[1], privateArea: null, moveNear: false });
  const beforeClipping = RegionManager.getClipping(DOOR_AT[0], DOOR_AT[1], DOOR_AT[2], null);
  assert.equal(beforeRoute.success, true, "the surrounding map remains traversable");

  click(actor, "Pick-lock");

  assert.equal(actor.getSkillManager().getExperience(core.Skill.THIEVING) - xpBefore, 50);
  assert.ok(isDone(actor));
  assert.equal(Progress.tierCount(actor, diary, "elite"), 1);
  assert.equal(actor.getPacketSender().getVarbit(diary.tiers.elite.countVarbit), 1);
  const opened = [...ObjectManager.objectsAt(new Location(...DOOR_AT))]
    .find((object) => object.getId() === DOOR);
  assert.ok(opened, "Doors.plugin replaces the closed loc with its open leaf");
  assert.notEqual(opened.getFace(), 3, "the opened loc has the cache-backed turned face");
  const afterClipping = RegionManager.getClipping(DOOR_AT[0], DOOR_AT[1], DOOR_AT[2], null);
  assert.notEqual(afterClipping, beforeClipping, "the open leaf updates real collision");
  click(actor, "Pick-lock");
  assert.equal(actor.getSkillManager().getExperience(core.Skill.THIEVING) - xpBefore, 50,
    "a click on the already-open leaf cannot pay XP twice");
  assert.equal(Progress.tierCount(actor, diary, "elite"), 1);
  restoreClosedDoor();
});

test("the pick chance matches the Wiki's level-82 and level-99 rolls", () => {
  assert.equal(DoorDiary._test.successChance(82), 35 / 256);
  assert.equal(DoorDiary._test.successChance(99), 41 / 256);
  assert.equal(DoorDiary._test.successChance(120), 41 / 256, "boosts above 99 use the level-99 rate");
});

test("failed attempts can be retried without damage, XP, diary progress, or opening the door", (t) => {
  const actor = player(NORTH);
  t.mock.method(Math, "random", () => 0.999);
  const hp = actor.getHitpoints();
  const xp = actor.getSkillManager().getExperience(core.Skill.THIEVING);
  click(actor, "Pick-lock");
  assert.equal(actor.getHitpoints(), hp);
  assert.equal(actor.getSkillManager().getExperience(core.Skill.THIEVING), xp);
  assert.equal(isDone(actor), false);
  assert.ok(actor.messages.some((message) => message.includes("fail to pick")));
  assert.ok(MapObjects.get(DOOR, new Location(...DOOR_AT), null));

  t.mock.method(Math, "random", () => 0);
  click(actor, "Pick-lock");
  assert.ok(isDone(actor), "a later successful attempt completes the task");
  restoreClosedDoor();
});

test("missing tools, low boosted level, the wrong side, private areas, and dead players cannot pick the lock", (t) => {
  const strangePick = player(NORTH, { lockpick: false });
  strangePick.getInventory().add(new core.Item(core.ItemIdentifiers.STRANGE_OLD_LOCKPICK), false);
  const scenarios = [
    { actor: player(NORTH, { lockpick: false }), option: "Pick-lock", random: 0 },
    { actor: strangePick, option: "Pick-lock", random: 0 },
    { actor: player(NORTH, { level: 81 }), option: "Pick-lock", random: 0 },
    { actor: player(SOUTH), option: "Pick-lock", random: 0 },
    { actor: player(DOORWAY), option: "Pick-lock", random: 0 },
    { actor: player(NORTH, { privateArea: new (class TestArea extends PrivateArea { countsAsMainWorld() { return false; } })() }), option: "Pick-lock", random: 0 },
    { actor: player(NORTH, { hitpoints: 0 }), option: "Pick-lock", random: 0 },
  ];
  for (const { actor, option, random } of scenarios) {
    t.mock.method(Math, "random", () => random);
    const xp = actor.getSkillManager().getExperience(core.Skill.THIEVING);
    const dispatched = click(actor, option);
    if (actor.getHitpoints() === 0) assert.equal(dispatched, false, "the packet listener rejects dead players");
    else assert.equal(dispatched, true);
    assert.equal(actor.getSkillManager().getExperience(core.Skill.THIEVING), xp);
    assert.equal(isDone(actor), false);
    assert.ok(MapObjects.get(DOOR, new Location(...DOOR_AT), null));
  }
});

test("Open is free on the dungeon side and blocked from the basement side", () => {
  const basement = player(NORTH);
  click(basement, "Open");
  assert.equal(isDone(basement), false, "opening from the basement is not a picklock success");
  assert.ok(MapObjects.get(DOOR, new Location(...DOOR_AT), null));

  const dungeon = player(DOORWAY);
  click(dungeon, "Open");
  assert.equal(isDone(dungeon), false, "the free Open action does not count as a pick");
  assert.equal(dungeon.getSkillManager().getExperience(core.Skill.THIEVING), 0);
  assert.ok([...ObjectManager.objectsAt(new Location(...DOOR_AT))].some((object) => object.getId() === DOOR));
  restoreClosedDoor();
});
