const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

const TASK = "pick-some-torstol-from-the-patch-north-of-ardoug";
const PATCH = { id: 8152, type: "HERB", x: 2670, y: 3374, z: 0 };
let core, Data, Patches, Progress, diary, harvested;
const listeners = new Map();
const hooks = {};
let notedTorstol, harvestedCount;

function emit(name, event) {
  const payload = name === "farming:harvested" ? { ...event, itemId: notedTorstol } : event;
  if (name === "farming:harvested") harvestedCount++;
  for (const handler of listeners.get(name) ?? []) handler(payload);
}

const api = new Proxy({
  core: null,
  persistAttribute() {},
  onCustomEvent(name, handler) {
    const entries = listeners.get(name) ?? [];
    entries.push(handler);
    listeners.set(name, entries);
    if (name === "farming:harvested") harvested = handler;
  },
  emitCustomEvent: emit,
  onObjectInteraction(handler) { hooks.objectInteraction = handler; },
}, { get: (target, key) => key in target ? target[key] : () => {} });

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  require("../plugins/skills/farming/Core.Farming").init({ core });
  Data = require("../plugins/skills/farming/Data.Farming");
  Patches = require("../plugins/skills/farming/Patches.Farming");
  Data.initializeFarmingData();
  notedTorstol = core.ItemDefinition.forId(Data.itemId("Grimy torstol")).getNoteId();
  Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("ardougne");
  api.core = core;
  require("../plugins/achievements/AchievementDiaries.plugin").register(api);
  require("../plugins/achievements/diaries/ArdougneTorstolDiary.plugin").register(api);
  require("../plugins/skills/Farming.plugin").register(api);
});

function fixture(t) {
  const player = new Player(null);
  const varbits = new Map();
  const sender = new Proxy({}, { get: (_target, key) => key === "sendVarbit"
    ? (id, value) => { varbits.set(id, value); return sender; }
    : () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.isRegistered = () => true;
  player.getPrivateArea = () => null;
  player.getHitpoints = () => 10;
  player.isDyingReturn = () => false;
  player.busy = () => false;
  player.getClickDelay().elapsedTime = () => true;
  player.performAnimation = () => {};
  player.moveTo(new core.Location(PATCH.x, PATCH.y, PATCH.z));
  player.getSkillManager().setCurrentLevel(core.Skill.FARMING, 99, false);
  player.getInventory().add(new core.Item(Data.itemId("Spade")), false);
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  const patch = Data.CACHE.patches.find((entry) => entry.id === PATCH.id && entry.x === PATCH.x
    && entry.y === PATCH.y && entry.z === PATCH.z);
  assert.ok(patch, "the cache contains the north Ardougne herb patch");
  const state = Patches.stateFor(player, patch);
  Object.assign(state, { crop: "TORSTOL", status: "grown", lives: 2, checked: true });
  harvestedCount = 0;
  t.mock.method(core.PluginManager, "emitCustomEvent", emit);
  t.mock.method(core.ObjectDefinition, "forPlayer", () => ({ getInteractions: () => ["Pick"] }));
  t.mock.method(core.MapObjects, "get", () => null);
  const click = () => hooks.objectInteraction({ player, object: { getId: () => patch.id },
    location: new core.Location(patch.x, patch.y, patch.z), clickType: 1 });
  const tick = () => Patches.tick();
  return { player, patch, state, varbits, click, tick };
}

test("a real Torstol harvest at the north Ardougne herb patch advances Elite progress", (t) => {
  const f = fixture(t);
  f.click();
  f.tick();
  assert.ok(f.player.getInventory().contains(Data.itemId("Grimy torstol")), "the farming handler granted Torstol");
  assert.equal(harvestedCount, 1, "Farming emitted one post-grant event with modified, noted produce");
  assert.ok(Progress.doneTasks(f.player, diary).has(TASK));
  assert.equal(Progress.tierCount(f.player, diary, "elite"), 1);
  assert.equal(f.varbits.get(diary.tiers.elite.countVarbit), 1);
  assert.equal(f.varbits.get(diary.startedVarbit), 1);
});

test("a failed produce grant does not complete the diary task", (t) => {
  const f = fixture(t);
  const bucket = Data.itemId("Bucket");
  while (f.player.getInventory().getFreeSlots() > 1) f.player.getInventory().add(new core.Item(bucket), false);
  f.click();
  f.player.getInventory().add(new core.Item(bucket), false);
  assert.equal(f.player.getInventory().isFull(), true);
  f.tick();
  assert.equal(harvestedCount, 0, "no harvest event followed a refused pick");
  assert.equal(Progress.tierCount(f.player, diary, "elite"), 0);
  assert.equal(f.varbits.get(diary.tiers.elite.countVarbit), undefined);
});

test("other crops, patches, planes, private areas, and unavailable players do not count", (t) => {
  const f = fixture(t);
  const blocked = [
    { crop: "RANARR", patch: PATCH, player: f.player },
    { crop: "TORSTOL", patch: { ...PATCH, id: 9999 }, player: f.player },
    { crop: "TORSTOL", patch: { ...PATCH, x: 2671 }, player: f.player },
    { crop: "TORSTOL", patch: { ...PATCH, y: 3375 }, player: f.player },
    { crop: "TORSTOL", patch: { ...PATCH, z: 1 }, player: f.player },
    { crop: "TORSTOL", patch: { ...PATCH, type: "ALLOTMENT" }, player: f.player },
    { crop: "TORSTOL", patch: PATCH, player: Object.assign(Object.create(f.player), { getPrivateArea: () => ({}) }) },
    { crop: "TORSTOL", patch: PATCH, player: Object.assign(Object.create(f.player), { getHitpoints: () => 0 }) },
  ];
  for (const event of blocked) harvested(event);
  assert.equal(Progress.tierCount(f.player, diary, "elite"), 0);
});

test("repeated harvest events do not increase task progress twice", (t) => {
  const f = fixture(t);
  const event = { player: f.player, crop: "TORSTOL", patch: PATCH };
  harvested(event);
  harvested(event);
  assert.equal(Progress.tierCount(f.player, diary, "elite"), 1);
  assert.equal(f.varbits.get(diary.tiers.elite.countVarbit), 1);
});
