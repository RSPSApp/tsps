const assert = require("node:assert/strict");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core;
let spellCast;
let interfaceAction;
let Progress;
let diary;
let quest;
let dispatch;
let canTeleport;

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const handlers = new Map();
  dispatch = (name, event) => {
    for (const handler of handlers.get(name) ?? []) handler(event);
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onCustomEvent(name, handler) {
      const entries = handlers.get(name) ?? [];
      entries.push(handler);
      handlers.set(name, entries);
    },
    emitCustomEvent: dispatch,
    onSpellCast(handler) { spellCast = handler; },
    onInterfaceActionClick(handler) { interfaceAction = handler; },
    onCanTeleport(handler) { canTeleport = handler; },
  }, { get: (target, key) => key in target ? target[key] : () => {} });

  Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("ardougne");
  api.onCustomEvent("diary:task", require("../plugins/achievements/AchievementDiaries.plugin")._test.onTask);
  Progress(api);
  require("../plugins/achievements/diaries/ArdougneWatchtowerDiary.plugin").register(api);
  require("../plugins/combat/SpellTeleports.plugin").register(api);
  require("../plugins/quests/quests/Watchtower.Quest")(api);
  quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find(({ key }) => key === "watchtower");
  assert.ok(quest, "Watchtower registered with QuestRuntime");
  PluginManager.emitCustomEvent = dispatch;
  PluginManager.emitCanTeleport = (player, wildernessLevelLimit, destination, spellName) => {
    const event = { player, wildernessLevelLimit, destination, spellName, allow: null };
    canTeleport(event);
    return event.allow;
  };
});

function fixture(t, { stage = 14, runes = true, hitpoints = 10 } = {}) {
  const player = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.setRegistered(true);
  player.setIndex(1820 + Math.floor(Math.random() * 500));
  player.setLocation(new core.Location(3200, 3200, 0));
  player.setSpellbook(core.MagicSpellbook.NORMAL);
  player.getSkillManager().setCurrentLevels(core.Skill.MAGIC, 99, false);
  player.getHitpoints = () => hitpoints;
  if (runes) {
    player.getInventory().add(new core.Item(563, 2), false);
    player.getInventory().add(new core.Item(557, 2), false);
  }
  player.setAttribute("quest.watchtower.stage", stage);
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  t.after(() => {
    core.TaskManager.cancelTasks(player.getIndex());
    player.setRegistered(false);
  });
  return player;
}

function tickTeleport() {
  for (let tick = 0; tick < 6; tick++) core.TaskManager.process();
}

const TASK = "teleport-to-the-watchtower";

test("a Watchtower quest completion lets the real spell land and advances the hard diary", (t) => {
  t.mock.method(Math, "random", () => 0.99);
  const player = fixture(t);
  spellCast({ player, spellName: "watchtower teleport", handled: false });
  tickTeleport();

  assert.equal(quest.getStage(player), 14);
  assert.equal(player.getLocation().getZ(), 2);
  assert.ok(Math.abs(player.getLocation().getX() - 2549) <= 2);
  assert.ok(Math.abs(player.getLocation().getY() - 3112) <= 2);
  assert.equal(player.getInventory().getAmount(563), 0);
  assert.equal(player.getInventory().getAmount(557), 0);
  assert.ok(Progress.doneTasks(player, diary).has(TASK));
  assert.equal(Progress.tierCount(player, diary, "hard"), 1);
});

test("the quest gate does not depend on the diary plugin", (t) => {
  const diaryPlugin = require("../plugins/achievements/diaries/ArdougneWatchtowerDiary.plugin");
  assert.equal(diaryPlugin._test.beforeCast, undefined);
  const player = fixture(t, { stage: 12 });
  assert.equal(PluginManager.emitCanTeleport(player, 20, null, "watchtower teleport"), false);
  assert.equal(player.getInventory().getAmount(563), 2);
  assert.equal(player.getInventory().getAmount(557), 2);

  player.setAttribute("quest.watchtower.stage", 14);
  assert.equal(PluginManager.emitCanTeleport(player, 20, null, "watchtower teleport"), null);
});

test("only reading the spell scroll unlocks both cast paths, before rune consumption", (t) => {
  for (const stage of [11, 12]) {
    for (const cast of [
      (player) => spellCast({ player, spellName: "watchtower teleport", handled: false }),
      (player) => interfaceAction({ player, buttonId: core.CacheDefinitions.getSpellByName("Watchtower teleport").widgetId, itemId: -1, handled: false }),
    ]) {
      const player = fixture(t, { stage });
      cast(player);
      assert.equal(quest.isComplete(player), stage === 12);
      assert.equal(player.getInventory().getAmount(563), 2);
      assert.equal(player.getInventory().getAmount(557), 2);
      tickTeleport();
      assert.equal(Progress.tierCount(player, diary, "hard"), 0);
    }
  }
});

test("wrong runes do not consume items or advance the diary", (t) => {
  const player = fixture(t, { runes: false });
  spellCast({ player, spellName: "watchtower teleport", handled: false });
  tickTeleport();
  assert.equal(Progress.tierCount(player, diary, "hard"), 0);
});

test("a cancelled real teleport does not advance the diary", (t) => {
  const player = fixture(t);
  spellCast({ player, spellName: "watchtower teleport", handled: false });
  core.TaskManager.cancelTasks(player.getIndex());
  assert.equal(Progress.tierCount(player, diary, "hard"), 0);
});

test("dead and non-Watchtower arrivals do not advance the diary", (t) => {
  const player = fixture(t, { hitpoints: 0 });
  const arrival = { player, name: "other teleport" };
  player.setLocation(new core.Location(2549, 3112, 2));
  dispatch("spell:teleport-arrival", arrival);
  arrival.name = "watchtower teleport";
  dispatch("spell:teleport-arrival", arrival);
  assert.equal(Progress.tierCount(player, diary, "hard"), 0);
});
