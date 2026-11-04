const assert = require("node:assert/strict");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core;
let arrival;
let spellCast;
let Progress;
let diary;
let quest;
let dispatch;

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
      if (name === "spell:teleport-arrival") arrival = handler;
    },
    emitCustomEvent: dispatch,
    onSpellCast(handler) { spellCast = handler; },
  }, { get: (target, key) => key in target ? target[key] : () => {} });

  Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("ardougne");
  api.onCustomEvent("diary:task", require("../plugins/achievements/AchievementDiaries.plugin")._test.onTask);
  Progress(api);
  require("../plugins/achievements/diaries/ArdougneTeleportDiary.plugin").register(api);
  require("../plugins/combat/SpellTeleports.plugin").register(api);

  require("../plugins/quests/quests/PlagueCity.Quest")(api);
  const QuestRuntime = require("../plugins/quests/QuestRuntime");
  quest = QuestRuntime.getRegisteredQuests().find(({ key }) => key === "plague_city");
  assert.ok(quest, "Plague City registered with QuestRuntime");

  require("../dist/plugins/PluginManager").PluginManager.emitCustomEvent = dispatch;
});

function fixture(t, { stage = 29, privateOrigin = false, runes = true } = {}) {
  const player = new Player(null);
  const varbits = new Map();
  const sender = new Proxy({}, { get: (_target, key) => key === "sendVarbit"
    ? (id, value) => { varbits.set(id, value); return sender; }
    : () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.setRegistered(true);
  player.setIndex(1320 + Math.floor(Math.random() * 500));
  player.setLocation(new core.Location(3200, 3200, 0));
  player.setSpellbook(core.MagicSpellbook.NORMAL);
  player.getSkillManager().setCurrentLevels(core.Skill.MAGIC, 99, false);
  if (runes) {
    player.getInventory().add(new core.Item(563, 2), false);
    player.getInventory().add(new core.Item(555, 2), false);
  }
  player.setAttribute("quest.plague_city.stage", stage);
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  if (privateOrigin) player.getPrivateArea = () => ({ isPrivate: true });
  t.after(() => {
    core.TaskManager.cancelTasks(player.getIndex());
    player.setRegistered(false);
  });
  return { player, varbits };
}

function castAndLand(t, options) {
  const { player, varbits } = fixture(t, options);
  spellCast({ player, spellName: "ardougne teleport", handled: false });
  for (let tick = 0; tick < 6; tick++) core.TaskManager.process();
  return { player, varbits };
}

const TASK = "cast-the-ardougne-teleport-spell";

test("the real Ardougne spell lands at y=3304 and advances diary progress", (t) => {
  t.mock.method(Math, "random", () => 0.99);
  const { player, varbits } = castAndLand(t);

  assert.equal(player.getLocation().getX(), 2663);
  assert.equal(player.getLocation().getY(), 3304);
  assert.equal(quest.getStage(player), 29);
  assert.ok(Progress.doneTasks(player, diary).has(TASK));
  assert.equal(Progress.tierCount(player, diary, "medium"), 1);
  assert.equal(varbits.get(diary.tiers.medium.countVarbit), 1);
});

test("the actual Plague City quest stage gates the real spell arrival", (t) => {
  const { player } = castAndLand(t, { stage: 28 });
  assert.equal(quest.getStage(player), 28);
  assert.equal(Progress.tierCount(player, diary, "medium"), 0);
});

test("a private-area origin does not block progress after the spell lands in Ardougne", (t) => {
  const { player } = castAndLand(t, { privateOrigin: true });
  assert.ok(player.getPrivateArea(), "the fixture keeps the origin area's reference after landing");
  assert.ok(Math.abs(player.getLocation().getY() - 3302) <= 2);
  assert.equal(Progress.tierCount(player, diary, "medium"), 1);
});

test("a failed real cast, a tablet, another spell, and a non-Ardougne arrival do not advance progress", (t) => {
  const { player: failed } = fixture(t, { runes: false });
  spellCast({ player: failed, spellName: "ardougne teleport", handled: false });
  for (let tick = 0; tick < 6; tick++) core.TaskManager.process();
  assert.equal(Progress.tierCount(failed, diary, "medium"), 0);

  const { player } = fixture(t);
  arrival({ player, name: "ardougne teleport tablet" });
  arrival({ player, name: "camelot teleport" });
  player.getLocation = () => new core.Location(2664, 3302, 0);
  arrival({ player, name: "ardougne teleport" });
  assert.equal(Progress.tierCount(player, diary, "medium"), 0);
});
