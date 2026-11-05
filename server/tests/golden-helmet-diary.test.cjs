process.env.DISABLE_PLAYER_BOTS = "1"; // no player bots in the world while the anvil is used
// Run after `yarn build`: node --test tests/golden-helmet-diary.test.cjs
//
// The Wilderness Diary's Medium task "Smith a Golden helmet in the Resource Area" (OSRS Wiki: Wilderness Diary,
// Gold helmet). Through a real item-on-object click on the Resource Area's real anvil (object 2097 at 3190,3938,
// rsprox-free: the object is on the map), a real Player, and the real plugins: Between a Rock makes the helmet
// (3 gold bars, a hammer, 50 Smithing, 30 XP) and the diary credits it inside the enclosure (Wiki map x 3174-3197,
// y 3925-3944).
//
// Wiki: the helmet's requirement is "Partial completion of Between a Rock..." with no step named, "to make the
// helmet after the quest ... smith it on any anvil" (not available if one is in the bank), and "Pures do not
// need to complete the quest to complete this wilderness task". The code's lower bound is the quest stage where
// Dondakan wants the golden cannonball (60), inferred from the existing quest plugin; a player below it gets nothing.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Runtime = require("../plugins/quests/QuestRuntime");
const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const DIARY = Diaries.BY_KEY.get("wilderness");
const HELMET_TASK = "smith-a-golden-helmet-in-the-resource-area";
const ANVIL = 2097;
const ANVIL_AT = [3190, 3938];
const INSIDE = [3189, 3938];
const HOME = [3222, 3218];
const STAGE_BEFORE_GOLD = 50;
const STAGE_GOLD = 60;
const STAGE_COMPLETE = 100;
let core;
let I;
let quest;
let next = 9800;
let events;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...ANVIL_AT);
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  quest = Runtime.getRegisteredQuests().findLast((entry) => entry.key === "between_a_rock");
  assert.ok(quest, "the real quest is registered");
  events = [];
  const listener = PM.createApi("GoldenHelmetListener");
  listener.onCustomEvent("smithing:success", (event) => events.push(event.itemId));
});
after(() => PM.emitServerShutdown({}));

function actor(t, { stage = STAGE_GOLD, smithing = 50, current = smithing, at = INSIDE, bars = 3, presetBars = 0, hammer = true } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("helmet" + player.getIndex());
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(at[0], at[1], 0));
  player.needsPlacement = false;
  player.getSkillManager().setMaxLevels(core.Skill.SMITHING, smithing, false).setCurrentLevels(core.Skill.SMITHING, current, false);
  quest.setStage(player, stage);
  if (bars) player.getInventory().add(new core.Item(I.GOLD_BAR, bars), false);
  for (let i = 0; i < presetBars; i++) {
    const bar = new core.Item(I.GOLD_BAR, 1);
    bar.setMetaValue(core.Item.PRESET_META, true);
    player.getInventory().add(bar, false);
  }
  if (hammer) player.getInventory().add(new core.Item(I.HAMMER, 1), false);
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, connection };
}

/** Gold bars on the anvil, as a real item_on_object packet. */
async function useBarsOn(f, objectId = ANVIL, x = ANVIL_AT[0], y = ANVIL_AT[1]) {
  const slot = f.player.getInventory().getSlotForItemId(I.GOLD_BAR);
  await f.connection.dispatch([{ type: "item_on_object", widgetId: 149 << 16, objectId, itemId: I.GOLD_BAR, slot, x, y }]);
  f.connection.processTurnPackets();
  for (let i = 0; i < 12; i++) {
    core.TaskManager.processWalkTo(f.player.getIndex());
    f.player.getMovementQueue().process();
    core.TaskManager.process();
  }
}

const helmets = (f) => f.player.getInventory().getAmount(I.GOLD_HELMET);
const bars = (f) => f.player.getInventory().getAmount(I.GOLD_BAR);
const giveHelmet = (f, where) => (where === "bank" ? f.player.getBank(0) : f.player.getInventory()).add(new core.Item(I.GOLD_HELMET, 1), false);
const credited = (f) => DiaryProgress.doneTasks(f.player, DIARY).has(HELMET_TASK);

/** An anvil outside the enclosure, placed on the Lumbridge map. */
function elsewhere(t) {
  const object = new core.GameObject(ANVIL, new core.Location(HOME[0] + 1, HOME[1], 0), 10, 0, null);
  core.ObjectManager.register(object, true);
  t.after(() => { try { core.ObjectManager.deregister(object, true); } catch { /* gone */ } });
  return object;
}

test("a player in the quest who has reached the golden cannonball smiths the helmet in the Resource Area and the task is credited", async (t) => {
  const f = actor(t);
  events.length = 0;
  await useBarsOn(f);
  assert.equal(helmets(f), 1, "a gold helmet");
  assert.equal(bars(f), 0, "for three gold bars");
  assert.ok(events.includes(I.GOLD_HELMET), "the smithing success event carries the helmet");
  assert.equal(credited(f), true, "the Medium task is credited");
});

test("after the quest the helmet is smithed on any anvil (Wiki) and credited in the area", async (t) => {
  const f = actor(t, { stage: STAGE_COMPLETE });
  await useBarsOn(f);
  assert.equal(helmets(f), 1, "a gold helmet after the quest");
  assert.equal(credited(f), true);
});

test("a completed quest smiths the helmet on any anvil, but outside the enclosure it credits nothing", async (t) => {
  const f = actor(t, { stage: STAGE_COMPLETE, at: [HOME[0], HOME[1]] });
  elsewhere(t);
  await useBarsOn(f, ANVIL, HOME[0] + 1, HOME[1]);
  assert.equal(helmets(f), 1, "the helmet is made on any anvil");
  assert.equal(credited(f), false, "but the task needs the Resource Area");
});

test("below the quest step where the helmet is first made nothing is smithed and nothing credited", async (t) => {
  const f = actor(t, { stage: STAGE_BEFORE_GOLD });
  await useBarsOn(f);
  assert.equal(helmets(f), 0);
  assert.equal(bars(f), 3, "the bars are kept");
  assert.equal(credited(f), false);
});

test("without the Smithing level, the hammer or three bars nothing is made and nothing credited", async (t) => {
  for (const options of [{ smithing: 49 }, { hammer: false }, { bars: 2 }]) {
    const f = actor(t, options);
    await useBarsOn(f);
    assert.equal(helmets(f), 0, JSON.stringify(options));
    assert.equal(credited(f), false, JSON.stringify(options));
  }
});

test("a gold helmet already in the inventory or the bank stops it, after the quest and during it (the Wiki's diary row)", async (t) => {
  // Wilderness Diary row: "You cannot do this while you already have a gold helmet in your inventory or bank,
  // this must be dropped first." It is not limited to after the quest, so the rule holds at every stage.
  for (const stage of [STAGE_GOLD, STAGE_COMPLETE]) {
    for (const where of ["inventory", "bank"]) {
      const f = actor(t, { stage });
      giveHelmet(f, where);
      const had = helmets(f);
      await useBarsOn(f);
      assert.equal(helmets(f), had, `no second helmet at stage ${stage} with one in the ${where}`);
      assert.equal(bars(f), 3, "the bars are kept");
      assert.equal(credited(f), false, "and nothing is credited");
    }
  }
});

test("a boosted Smithing level counts (the Wiki marks the 50 as boostable)", async (t) => {
  const f = actor(t, { smithing: 49, current: 50 });
  await useBarsOn(f);
  assert.equal(helmets(f), 1);
  assert.equal(credited(f), true);
});

test("preset gold bars make no helmet and do not count toward the task", async (t) => {
  for (const options of [{ bars: 0, presetBars: 3 }, { bars: 2, presetBars: 1 }]) {
    const f = actor(t, options);
    await useBarsOn(f);
    assert.equal(helmets(f), 0, `no helmet from ${JSON.stringify(options)}`);
    assert.equal(bars(f), 3, "the bars are kept");
    assert.equal(credited(f), false);
  }
});
