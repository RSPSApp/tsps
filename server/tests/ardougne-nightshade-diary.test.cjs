const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { State, ItemOnGround } = require("../dist/game/entity/impl/grounditem/ItemOnGround");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DiaryPlugin = require("../plugins/achievements/diaries/ArdougneNightshadeDiary.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

let core;
let emit;
const diary = DiaryData.BY_KEY.get("ardougne");
const { TASK, CAVE_NIGHTSHADE_ID, SPAWNS } = DiaryPlugin._test;

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
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  Progress(api);
  api.onCustomEvent("diary:task", Diaries._test.onTask);
  DiaryPlugin.register(api);
  PluginManager.emitCustomEvent = emit;
});

function fixture(t, { at = SPAWNS[0], privateArea = null } = {}) {
  const { Item, Location, ItemOnGroundManager } = core;
  const worldItems = core.World.getItems();
  const previousItems = worldItems.splice(0);
  const player = new Player(null, new Location(at[0], at[1], at[2] ?? 0));
  player.setIndex(2400 + Math.floor(Math.random() * 1000));
  player.setUsername("ardougne-nightshade-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.getPrivateArea = () => privateArea;
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  t.after(() => {
    worldItems.splice(0, worldItems.length, ...previousItems);
    player.setRegistered(false);
  });
  function spawn(id = CAVE_NIGHTSHADE_ID, tile = SPAWNS[0], staticSpawn = true, area = null) {
    const groundItem = new ItemOnGround(State.SEEN_BY_EVERYONE, undefined,
      new Location(tile[0], tile[1], tile[2] ?? 0), new Item(id), false, -1, area, staticSpawn);
    ItemOnGroundManager.register(groundItem);
    return groundItem;
  }
  return { player, spawn, manager: ItemOnGroundManager };
}

function done(player) {
  return Progress.doneTasks(player, diary).has(TASK);
}

test("taking a static Skavid cave nightshade advances Ardougne Medium #9", (t) => {
  t.mock.method(PluginManager, "emitGroundItemPickup", () => false);
  const { player, spawn, manager } = fixture(t);
  const pile = spawn();
  manager.pickup(player, pile);
  assert.ok(player.getInventory().contains(CAVE_NIGHTSHADE_ID));
  assert.ok(done(player));
  assert.equal(Progress.tierCount(player, diary, "medium"), 1);
  assert.equal(player.getPacketSender().getVarbit(diary.tiers.medium.countVarbit), 1);
  assert.equal(player.getPacketSender().getVarbit(diary.startedVarbit), 1);
});

test("either static cave spawn counts, including a completed telegrab transfer", (t) => {
  const { player, spawn, manager } = fixture(t, { at: SPAWNS[1] });
  const pile = spawn(CAVE_NIGHTSHADE_ID, SPAWNS[1]);
  assert.equal(manager.transferToInventory(player, pile, "telegrab"), 1);
  assert.ok(done(player));
  assert.equal(Progress.tierCount(player, diary, "medium"), 1);
});

test("failed, dropped, misplaced, private, and unrelated ground transfers do not count", (t) => {
  t.mock.method(PluginManager, "emitGroundItemPickup", () => false);
  const cases = [
    { staticSpawn: false },
    { tile: [2529, 9415] },
    { tile: [2528, 9415, 1] },
    { id: 2399 },
    { area: {} },
  ];
  for (const options of cases) {
    const { player, spawn, manager } = fixture(t);
    const pile = spawn(options.id ?? CAVE_NIGHTSHADE_ID, options.tile ?? SPAWNS[0], options.staticSpawn ?? true, options.area ?? null);
    manager.pickup(player, pile);
    assert.equal(done(player), false);
  }

  const full = fixture(t);
  for (let slot = 0; slot < 28; slot++) full.player.getInventory().setItem(slot, new core.Item(385));
  const pile = full.spawn();
  full.manager.pickup(full.player, pile);
  assert.equal(done(full.player), false);
  assert.equal(pile.isPendingRemoval(), false);

  const instance = fixture(t, { privateArea: {} });
  const instancePile = instance.spawn(CAVE_NIGHTSHADE_ID, SPAWNS[0], true, instance.player.getPrivateArea());
  instance.manager.pickup(instance.player, instancePile);
  assert.equal(done(instance.player), false);
});
