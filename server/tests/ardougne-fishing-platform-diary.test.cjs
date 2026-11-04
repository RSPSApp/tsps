const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Fishing = require("../plugins/skills/Fishing.plugin");
const DiaryPlugin = require("../plugins/achievements/diaries/ArdougneFishingPlatformDiary.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

let core;
let emit;
let quest;
const diary = DiaryData.BY_KEY.get("ardougne");
const TASK = "catch-any-fish-on-the-fishing-platform";

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const listeners = new Map();
  emit = (name, event) => (listeners.get(name) ?? []).forEach((handler) => handler(event));
  const api = new Proxy({
    core,
    persistAttribute() {},
    onCustomEvent(name, handler) {
      const entries = listeners.get(name) ?? [];
      entries.push(handler);
      listeners.set(name, entries);
    },
    emitCustomEvent: emit,
    getTaskManager: () => ({ submit() {} }),
    getWorld: () => ({}),
  }, { get: (target, key) => key in target ? target[key] : () => {} });

  require("../plugins/quests/quests/SeaSlug.Quest")(api);
  quest = QuestRuntime.getRegisteredQuests().find(({ key }) => key === "sea_slug");
  assert.ok(quest, "Sea Slug is registered with QuestRuntime");
  Progress(api);
  // Attach the real Achievement Diaries task handler to the test event bus.
  api.onCustomEvent("diary:task", require("../plugins/achievements/AchievementDiaries.plugin")._test.onTask);
  DiaryPlugin.register(api);
  Fishing.register(api);
  require("../dist/plugins/PluginManager").PluginManager.emitCustomEvent = emit;
});

function playerFixture(t, { at = DiaryPlugin._test.SPOTS[0], started = true, registered = true, hitpoints = 10,
  privateArea = false, dying = false } = {}) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null);
  const varbits = new Map();
  const sender = new Proxy({}, { get: (_target, key) => key === "sendVarbit"
    ? (id, value) => { varbits.set(id, value); return sender; }
    : () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.setRegistered(registered);
  player.setIndex(1800 + Math.floor(Math.random() * 500));
  player.setLocation(new core.Location(at[0], at[1], at[2] ?? 0));
  player.getInventory().add(new core.Item(core.ItemIdentifiers.SMALL_FISHING_NET, 1), false);
  player.getInventory().add(new core.Item(core.ItemIdentifiers.FISHING_BAIT, 1), false);
  player.getHitpoints = () => hitpoints;
  player.isDyingReturn = () => dying;
  if (privateArea) player.getPrivateArea = () => ({ isPrivate: true });
  player.setAttribute("quest.sea_slug.stage", started ? 1 : 0);
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  t.after(() => {
    core.TaskManager.cancelTasks(player.getIndex());
    player.setRegistered(false);
  });
  return { player, varbits };
}

function landPlatformFish(player) {
  const tool = Fishing.TOOLS.NET;
  const variant = Fishing.findTool(player, tool);
  const caught = Fishing.rollCatch(player, tool, () => 0, variant.bonus);
  assert.ok(caught.length > 0, "the Fishing handler rolls a catch");
  Fishing.landCatch(player, tool, variant, caught);
  return caught;
}

test("a real landed Fishing catch on each Fishing Platform spot advances Ardougne Medium #7", (t) => {
  for (const spot of DiaryPlugin._test.SPOTS) {
    const { player, varbits } = playerFixture(t, { at: spot });
    landPlatformFish(player);
    assert.ok(Progress.doneTasks(player, diary).has(TASK));
    assert.ok(player.getInventory().contains(core.ItemIdentifiers.RAW_SHRIMPS), "the handler landed the fish");
    assert.equal(Progress.tierCount(player, diary, "medium"), 1);
    assert.equal(varbits.get(diary.tiers.medium.countVarbit), 1);
    assert.equal(varbits.get(diary.startedVarbit), 1);
  }
});

test("a real landed catch needs Sea Slug started", (t) => {
  const { player } = playerFixture(t, { started: false });
  landPlatformFish(player);
  assert.equal(Progress.tierCount(player, diary, "medium"), 0);
});

test("misses, Trawler rewards, unrelated fish, and invalid locations or players do not count", (t) => {
  const invalid = [
    { itemId: null },
    { itemId: core.ItemIdentifiers.RAW_SHARK },
    { itemId: core.ItemIdentifiers.RAW_SHRIMPS, source: "fishing-trawler" },
    { itemId: core.ItemIdentifiers.RAW_SHRIMPS, skill: core.Skill.COOKING },
  ];
  const { player } = playerFixture(t);
  const tool = Fishing.TOOLS.NET;
  const miss = Fishing.rollCatch(player, tool, () => 0.99, 100);
  assert.deepEqual(miss, [], "the real Fishing handler can miss without emitting a catch");
  assert.equal(Progress.tierCount(player, diary, "medium"), 0);
  for (const event of invalid) emit("fishing:success", { player, skill: core.Skill.FISHING, ...event });
  emit("fishing:success", { player, skill: core.Skill.FISHING, itemId: core.ItemIdentifiers.RAW_SHRIMPS,
    source: "fishing-trawler" });
  assert.equal(Progress.tierCount(player, diary, "medium"), 0);

  for (const options of [
    { at: [2786, 3273, 0] }, { at: [2789, 3273, 1] }, { registered: false }, { hitpoints: 0 },
    { dying: true }, { privateArea: true },
  ]) {
    const fixture = playerFixture(t, options);
    emit("fishing:success", { player: fixture.player, skill: core.Skill.FISHING,
      itemId: core.ItemIdentifiers.RAW_SHRIMPS });
    assert.equal(Progress.tierCount(fixture.player, diary, "medium"), 0);
  }
});
