const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Elite = require("../plugins/achievements/diaries/ArdougneEliteTaskProgress.plugin");
const Varrock = require("../plugins/achievements/diaries/VarrockDiary.plugin");
const Fremennik = require("../plugins/achievements/diaries/FremennikDiary.plugin");
const KaramjaFinish = require("../plugins/achievements/diaries/KaramjaDiaryFinish.plugin");
const Western = require("../plugins/achievements/diaries/WesternProvincesDiary.plugin");

const handlers = new Map();
const progressedEvents = [];
let core;

function dispatch(name, event) {
  if (name === "quest:is-complete") event.complete = true;
  for (const handler of handlers.get(name) ?? []) handler(event);
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    persistAttribute() {},
    getTaskManager: () => ({ submit() {} }),
    onCustomEvent(name, handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    emitCustomEvent: dispatch,
  }, { get: (target, key) => key in target ? target[key] : () => {} });

  Progress(api);
  handlers.set("diary:task", [...(handlers.get("diary:task") ?? []), Diaries._test.onTask]);
  Elite.register(api);
  Varrock.register(api);
  Fremennik.register(api);
  KaramjaFinish.register(api);
  Western.register(api);
  api.onCustomEvent("diary:task-progressed", (event) => progressedEvents.push(event));
});

function player({ x = 3200, y = 3400, z = 0 } = {}) {
  const attributes = new Map([[Progress.TASKS_ATTRIBUTE, {}]]);
  return {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getLocation: () => new core.Location(x, y, z),
    getPrivateArea: () => null,
    getHitpoints: () => 10,
    isDyingReturn: () => false,
    isRegistered: () => true,
    isPlayer: () => true,
    sendMessage() {},
    getPacketSender: () => ({ sendVarbit() {} }),
    getPrivateArea: () => null,
  };
}

function stage(owner, task = Elite._test.MANTA_TASK) {
  dispatch(Elite._test.STAGE_EVENT, { player: owner, task, stage: "caught" });
}

function query(owner, task = Elite._test.MANTA_TASK) {
  const request = { player: owner, task };
  dispatch(Elite._test.QUERY_EVENT, request);
  return request.result;
}

test("a Varrock yew chop resets only that player's unfinished Ardougne task once", () => {
  const owner = player({ x: 3200, y: 3400 });
  const other = player({ x: 3200, y: 3400 });
  stage(owner);
  stage(other);
  const eventCount = progressedEvents.length;
  const tree = { getDefinition: () => ({ getName: () => "Yew tree" }) };

  Varrock._test.chopped({ player: owner, object: tree, success: true });
  assert.equal(query(owner), null);
  assert.deepEqual(query(other), { stage: "caught" });
  Varrock._test.chopped({ player: owner, object: tree, success: true });
  assert.deepEqual(query(other), { stage: "caught" });
  assert.equal(Progress.doneTasks(owner, require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("varrock")).size, 0);
  assert.equal(progressedEvents.length, eventCount + 1);
});

test("Fremennik's first distinct Dagannoth King resets Crossbow progress, not another player", () => {
  const owner = player();
  const other = player();
  const crossbow = Elite._test.CROSSBOW_TASK;
  stage(owner, crossbow);
  stage(other, crossbow);

  const king = { getId: () => 2265 };
  Fremennik._test.onNpcDeath({ killer: owner, npc: king });
  assert.equal(query(owner, crossbow), null);
  assert.deepEqual(query(other, crossbow), { stage: "caught" });
  const beforeDuplicate = progressedEvents.length;
  Fremennik._test.onNpcDeath({ killer: owner, npc: king });
  assert.deepEqual(query(other, crossbow), { stage: "caught" });
  assert.equal(progressedEvents.length, beforeDuplicate);
});

test("the accepted silver-bar tiara stage resets only that player's Manta progress", () => {
  const owner = player({ x: 2630, y: 3670 });
  const other = player({ x: 2630, y: 3670 });
  stage(owner);
  stage(other);
  const before = progressedEvents.length;

  Fremennik._test.onMiningSuccess({ player: owner, itemId: core.ItemIdentifiers.SILVER_ORE });
  assert.equal(query(owner), null);
  assert.deepEqual(query(other), { stage: "caught" });
  assert.deepEqual(Object.keys(progressedEvents.at(-1)).sort(), ["diary", "player", "task"]);
  assert.equal(progressedEvents.length, before + 1);
});

test("an unfinished Karamja palm-leaf count is accepted once per pickup and stops at completion", () => {
  const owner = player({ x: 2760, y: 3200 });
  stage(owner);
  const task = KaramjaFinish._test.TASK.palmLeaves;
  const leaf = core.ItemIdentifiers.PALM_LEAF;

  KaramjaFinish._test.palmTaken({ player: owner, itemId: leaf });
  assert.equal(query(owner), null);
  assert.equal(owner.getAttribute(KaramjaFinish._test.PALM_LEAVES_ATTRIBUTE), 1);
  for (let index = 0; index < 4; index++) KaramjaFinish._test.palmTaken({ player: owner, itemId: leaf });
  assert.equal(Progress.doneTasks(owner, require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("karamja")).has(task), true);
  assert.equal(owner.getAttribute(KaramjaFinish._test.PALM_LEAVES_ATTRIBUTE), 5);
  const before = progressedEvents.length;
  KaramjaFinish._test.palmTaken({ player: owner, itemId: leaf });
  assert.equal(progressedEvents.length, before);
});

test("the Western Ape Atoll chop is accepted unfinished progress for its own task", () => {
  const owner = player({ x: 2700, y: 2700 });
  const other = player({ x: 2700, y: 2700 });
  const crossbow = Elite._test.CROSSBOW_TASK;
  stage(owner, crossbow);
  stage(other, crossbow);
  const before = progressedEvents.length;

  dispatch("woodcutting:success", { player: owner, logId: core.ItemIdentifiers.TEAK_LOGS });
  assert.equal(query(owner, crossbow), null);
  assert.deepEqual(query(other, crossbow), { stage: "caught" });
  assert.deepEqual(progressedEvents.at(-1), {
    player: owner,
    diary: "western",
    task: Western._test.TASK.teakApeAtoll,
  });
  assert.equal(progressedEvents.length, before + 1);
});
