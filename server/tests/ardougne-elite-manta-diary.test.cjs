const assert = require("node:assert/strict");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Shared = require("../plugins/minigames/fishingtrawler/Shared.FishingTrawler");
const Rewards = require("../plugins/minigames/fishingtrawler/Rewards.FishingTrawler");
const CookingCommon = require("../plugins/skills/cooking/Common.Cooking");
const Cooking = require("../plugins/skills/cooking/Cookers.Cooking");

const handlers = new Map();
let core;
let Progress;
let ardougne;
let mantaId;
let cookedMantaId;
const TASK = "catch-a-manta-ray-in-the-fishing-trawler-and-coo";

function dispatch(name, event) {
  for (const handler of handlers.get(name) ?? []) handler(event);
}

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  mantaId = core.CacheDefinitions.getObjId("raw_mantaray");
  cookedMantaId = core.CacheDefinitions.getObjId("mantaray");
  Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  ardougne = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("ardougne");
  const api = { core, persistAttribute() {}, onPlayerLogin() {}, emitCustomEvent: dispatch };
  Progress(api);
  handlers.set("diary:task", [require("../plugins/achievements/AchievementDiaries.plugin")._test.onTask]);
  for (const name of ["ArdougneEliteTaskProgress.plugin", "ArdougneEliteMantaDiary.plugin"]) {
    require(`../plugins/achievements/diaries/${name}`).register({
      ...api,
      onCustomEvent: (eventName, handler) => handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]),
      onPlayerLogout() {},
      onPlayerDisconnect() {},
    });
  }
});

function player() {
  const result = new Player(null);
  const varbits = new Map();
  const sender = new Proxy({}, { get: (_target, name) => name === "sendVarbit"
    ? (id, value) => { varbits.set(id, value); return sender; }
    : () => sender });
  result.getPacketSender = () => sender;
  result.sendMessage = () => {};
  result.setRegistered(true);
  result.setHitpoints(10);
  result.setLocation(new core.Location(2670, 3170, 0));
  result.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  result.varbits = varbits;
  const skills = result.getSkillManager();
  skills.setCurrentLevel(core.Skill.FISHING, 99, false).setMaxLevels(core.Skill.FISHING, 99, false);
  skills.setCurrentLevel(core.Skill.COOKING, 99, false).setMaxLevels(core.Skill.COOKING, 99, false);
  return result;
}

function query(player) {
  const request = { player, task: TASK };
  dispatch("ardougne-elite:task-stage-query", request);
  return request.result;
}

function awardTrawler(player, randomValues = [0, 0.3, 0.99], fishCount = 1) {
  const events = [];
  Shared.bind({ core, emitCustomEvent: (name, event) => {
    events.push([name, event]);
    dispatch(name, event);
  } });
  // The deterministic roll chooses manta and no junk or angler piece.
  let roll = 0;
  Rewards.award(player, { contribution: new Map([[player, 50]]), shareFor: () => fishCount }, () => randomValues[roll++] ?? 0.99);
  const award = events.find(([name]) => name === "fishing-trawler:catch-awarded")?.[1];
  assert.ok(award?.fish);
  return award.fish;
}

function trawlerCatch(player, randomValues, fishCount) {
  return awardTrawler(player, randomValues, fishCount).some(({ itemId }) => itemId === mantaId);
}

function collectTrawlerManta(player, amount) {
  Rewards.inspectNet({ player });
  const tab = core.Bank.getTabForItem(player, mantaId);
  const bank = player.getBank(tab);
  const slot = bank.getSlotForItemId(mantaId);
  assert.ok(slot >= 0);
  bank.open();
  core.Bank.withdraw(player, mantaId, slot, amount, tab);
  assert.equal(player.getInventory().getAmount(mantaId), amount);
}

function cookManta(player, { rawId = mantaId, itemId = cookedMantaId, location = new core.Location(2670, 3170, 0), burn = false, addRaw = true } = {}) {
  const events = [];
  if (addRaw) player.getInventory().adds(rawId, 1);
  CookingCommon.init({ core, emitCustomEvent(name, event) {
    events.push([name, event]);
    dispatch(name, event);
  } });
  const cookable = CookingCommon.cookables().get(rawId);
  assert.ok(cookable);
  player.getSkillManager().setCurrentLevel(core.Skill.COOKING, burn ? 91 : 99, false);
  const random = Math.random;
  Math.random = () => burn ? 0 : 0.99;
  try {
    Cooking._test.cookOne(player, { cookable, objectId: -1, location });
  } finally {
    Math.random = random;
  }
  return events;
}

test("one real Player can burn and retry a trawler manta, then complete the task and varbits", () => {
  const owner = player();
  const reward = awardTrawler(owner, [0, 0, 0.3, 0.99], 2);
  assert.equal(reward.find(({ itemId }) => itemId === mantaId)?.amount, 2);
  assert.deepEqual(query(owner), { stage: "caught" });

  collectTrawlerManta(owner, 2);
  cookManta(owner, { burn: true, addRaw: false });
  assert.deepEqual(query(owner), { stage: "caught" });
  const events = cookManta(owner, { addRaw: false });
  assert.ok(events.some(([name]) => name === "cooking:success"));
  assert.ok(Progress.doneTasks(owner, ardougne).has(TASK));
  assert.equal(query(owner), null);
  assert.equal(owner.varbits.get(ardougne.startedVarbit), 1);
  assert.equal(owner.varbits.get(ardougne.tiers.elite.countVarbit), 1);
});

test("a burn, unrelated cook, or wrong-area cook leaves the manta catch available", () => {
  const owner = player();
  assert.equal(trawlerCatch(owner), true);
  cookManta(owner, { burn: true });
  assert.deepEqual(query(owner), { stage: "caught" });
  cookManta(owner);
  assert.equal(Progress.doneTasks(owner, ardougne).has(TASK), true);

  const unrelated = player();
  assert.equal(trawlerCatch(unrelated), true);
  cookManta(unrelated, { rawId: core.CacheDefinitions.getObjId("raw_shark"), itemId: core.CacheDefinitions.getObjId("shark") });
  assert.deepEqual(query(unrelated), { stage: "caught" });
  cookManta(unrelated);
  assert.equal(Progress.doneTasks(unrelated, ardougne).has(TASK), true);

  const outside = player();
  assert.equal(trawlerCatch(outside), true);
  cookManta(outside, { location: new core.Location(3200, 3201, 0) });
  assert.deepEqual(query(outside), { stage: "caught" });
  cookManta(outside, { location: new core.Location(2661, 3156, 0) });
  assert.equal(Progress.doneTasks(outside, ardougne).has(TASK), true);
});

test("cache-mapped Port Khazard ranges and the nearby fire qualify for cooking", () => {
  for (const location of [
    new core.Location(2632, 3163, 0),
    new core.Location(2636, 3170, 0),
    new core.Location(2661, 3156, 0),
  ]) {
    const owner = player();
    assert.equal(trawlerCatch(owner), true);
    cookManta(owner, { location });
    assert.equal(Progress.doneTasks(owner, ardougne).has(TASK), true);
  }
});

test("a later non-manta trawler reward clears the earlier caught stage", () => {
  const owner = player();
  assert.equal(trawlerCatch(owner), true);
  cookManta(owner, { rawId: core.CacheDefinitions.getObjId("raw_shark"), itemId: core.CacheDefinitions.getObjId("shark") });
  dispatch("fishing-trawler:catch-awarded", { player: owner, fish: [{ itemId: core.CacheDefinitions.getObjId("raw_shark"), amount: 1 }] });
  assert.equal(query(owner), null);
  cookManta(owner);
  assert.equal(Progress.doneTasks(owner, ardougne).has(TASK), false);
});

test("an accepted task in another diary clears the staged manta catch", () => {
  const owner = player();
  const otherDiary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("varrock");
  assert.equal(trawlerCatch(owner), true);
  assert.equal(Progress.completeTask(owner, otherDiary, otherDiary.tiers.easy.tasks[0].key), true);
  assert.equal(query(owner), null);
});

test("a later trawler reward replaces the earlier manta reward snapshot", () => {
  const owner = player();
  trawlerCatch(owner);
  assert.deepEqual(query(owner), { stage: "caught" });

  assert.equal(trawlerCatch(owner, [0.99, 0.3, 0.99]), false);
  assert.equal(query(owner), null);
  cookManta(owner);
  assert.equal(Progress.doneTasks(owner, ardougne).has(TASK), false);
});
