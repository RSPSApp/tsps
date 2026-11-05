const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Item } = require('../dist/game/model/Item');
const { PluginManager } = require('../dist/plugins/PluginManager');
const diary = require('../plugins/achievements/diaries/ArdougneEliteRuneCrossbowDiary.plugin');
const Tracker = require('../plugins/achievements/diaries/ArdougneEliteTaskProgress.plugin');
const Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
const AchievementDiaries = require('../plugins/achievements/AchievementDiaries.plugin');
const FletchingShared = require('../plugins/skills/fletching/Shared.Fletching');
const core = PluginManager.getCoreApi();
const handlers = new Map();
const scheduledTasks = [];

const api = {
  core,
  persistAttribute() {},
  onPlayerLogin() {},
  onPlayerLogout() {},
  onPlayerDisconnect() {},
  getTaskManager: () => ({ submit: (task) => scheduledTasks.push(task) }),
  onCustomEvent(name, handler) {
    const list = handlers.get(name) ?? [];
    list.push(handler);
    handlers.set(name, list);
  },
  emitCustomEvent(name, event) {
    for (const handler of handlers.get(name) ?? []) handler(event);
  },
};

Tracker.register(api);
diary.register(api);
Progress(api);
api.onCustomEvent('diary:task', AchievementDiaries._test.onTask);

before(async () => {
  await CachePipeline.initialize(process.cwd());
  FletchingShared.init(api);
});

function player(t, { registered = true, hitpoints = 99, privateArea = null } = {}) {
  const value = new Player({ sendClientPacket: () => true });
  value.setRegistered(registered);
  t.mock.method(value, 'getHitpoints', () => hitpoints);
  t.mock.method(value, 'getPrivateArea', () => privateArea);
  return value;
}

function taskDone(player) {
  const data = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('ardougne');
  return Progress.doneTasks(player, data).has(diary._test.TASK);
}

function made(player, itemId, inputs, location, extra = {}) {
  api.emitCustomEvent('fletching:made', { player, itemId, amount: 1, inputs, location, ...extra });
}

function addStockAndLimbs(t, p) {
  const ids = core.ItemIdentifiers;
  made(p, ids.YEW_STOCK, [{ itemId: ids.YEW_LOGS, amount: 1 }], { x: 2550, y: 3090, z: 0 });
  api.emitCustomEvent('smithing:success', {
    player: p, skill: core.Skill.SMITHING, itemId: ids.RUNITE_LIMBS, amount: 1,
    inputs: [{ itemId: ids.RUNITE_BAR, amount: 1 }], stationObjectId: 2097,
    location: { x: 2613, y: 3078, z: 0 },
  });
}

function produceRuneCrossbow(p, location, stringMaterial = core.ItemIdentifiers.SINEW) {
  const ids = core.ItemIdentifiers;
  addStockAndLimbsFor(p);
  api.emitCustomEvent('crafting:spun', {
    player: p, itemId: ids.CROSSBOW_STRING, amount: 1,
    inputs: [{ itemId: stringMaterial, amount: 1 }], stationObjectId: 8748,
    location: { x: 2731, y: 3278, z: 0 },
  });
  made(p, ids.RUNITE_CROSSBOW_U_, [
    { itemId: ids.YEW_STOCK, amount: 1 }, { itemId: ids.RUNITE_LIMBS, amount: 1 },
  ], { x: 2550, y: 3090, z: 0 });
  made(p, ids.RUNE_CROSSBOW, [
    { itemId: ids.RUNITE_CROSSBOW_U_, amount: 1 }, { itemId: ids.CROSSBOW_STRING, amount: 1 },
  ], location);
}

function addStockAndLimbsFor(p) {
  const ids = core.ItemIdentifiers;
  made(p, ids.YEW_STOCK, [{ itemId: ids.YEW_LOGS, amount: 1 }], { x: 2550, y: 3090, z: 0 });
  api.emitCustomEvent('smithing:success', {
    player: p, skill: core.Skill.SMITHING, itemId: ids.RUNITE_LIMBS, amount: 1,
    inputs: [{ itemId: ids.RUNITE_BAR, amount: 1 }], stationObjectId: 2097,
    location: { x: 2613, y: 3078, z: 0 },
  });
}

function finishWithFletchingProducer(t, p, location) {
  const ids = core.ItemIdentifiers;
  t.mock.method(p, 'getLocation', () => new core.Location(location.x, location.y, location.z));
  t.mock.method(p, 'getSkillManager', () => ({ getCurrentLevel: () => 99, addExperiences() {} }));
  p.getInventory().setItem(0, new Item(ids.RUNITE_CROSSBOW_U_, 1));
  p.getInventory().setItem(1, new Item(ids.CROSSBOW_STRING, 1));
  p.getInventory().setItem(2, new Item(ids.HAMMER, 1));

  const startIndex = scheduledTasks.length;
  assert.equal(FletchingShared.handlePair(p, ids.RUNITE_CROSSBOW_U_, ids.CROSSBOW_STRING), true);
  const task = scheduledTasks[startIndex];
  assert.ok(task, 'the fletching producer starts its normal delayed action');
  task.execute();
  task.execute();
  assert.equal(p.getInventory().getAmount(ids.RUNE_CROSSBOW), 1);
  return p;
}

test('requires genuine stock, limbs, and a string before unstrung assembly, then consumes both final parts', (t) => {
  const p = player(t);
  const ids = core.ItemIdentifiers;
  const sinew = { player: p, itemId: ids.CROSSBOW_STRING, amount: 1,
    inputs: [{ itemId: ids.SINEW, amount: 1 }], stationObjectId: 8748, location: { x: 2731, y: 3278, z: 0 } };

  api.emitCustomEvent('crafting:spun', sinew);
  made(p, ids.RUNITE_CROSSBOW_U_, [
    { itemId: ids.YEW_STOCK, amount: 1 }, { itemId: ids.RUNITE_LIMBS, amount: 1 },
  ], { x: 2500, y: 3000, z: 0 });
  assert.equal(taskDone(p), false);

  addStockAndLimbs(t, p);
  made(p, ids.RUNITE_CROSSBOW_U_, [
    { itemId: ids.YEW_STOCK, amount: 1 }, { itemId: ids.RUNITE_LIMBS, amount: 1 },
  ], { x: 2550, y: 3090, z: 0 });
  assert.equal(taskDone(p), false);

  api.emitCustomEvent('crafting:spun', sinew);
  made(p, ids.RUNE_CROSSBOW, [
    { itemId: ids.RUNITE_CROSSBOW_U_, amount: 1 }, { itemId: ids.CROSSBOW_STRING, amount: 1 },
  ], { x: 2550, y: 3090, z: 0 });
  assert.equal(taskDone(p), true);
});

test('preparatory work can happen in any order, but wrong stations and towns do not count', (t) => {
  const p = player(t);
  const ids = core.ItemIdentifiers;
  api.emitCustomEvent('crafting:spun', {
    player: p, itemId: ids.CROSSBOW_STRING, amount: 1,
    inputs: [{ itemId: ids.YEW_ROOTS, amount: 1 }], stationObjectId: 8748,
    location: { x: 2731, y: 3278, z: 0 },
  });
  made(p, ids.YEW_STOCK, [{ itemId: ids.YEW_LOGS, amount: 1 }], { x: 2800, y: 3200, z: 0 });
  api.emitCustomEvent('smithing:success', {
    player: p, skill: core.Skill.SMITHING, itemId: ids.RUNITE_LIMBS, amount: 1,
    inputs: [{ itemId: ids.RUNITE_BAR, amount: 1 }], stationObjectId: 2097,
    location: { x: 2613, y: 3078, z: 0 },
  });
  made(p, ids.RUNITE_CROSSBOW_U_, [
    { itemId: ids.YEW_STOCK, amount: 1 }, { itemId: ids.RUNITE_LIMBS, amount: 1 },
  ], { x: 2731, y: 3278, z: 0 });
  made(p, ids.RUNE_CROSSBOW, [
    { itemId: ids.RUNITE_CROSSBOW_U_, amount: 1 }, { itemId: ids.CROSSBOW_STRING, amount: 1 },
  ], { x: 2731, y: 3278, z: 0 });
  assert.equal(taskDone(p), false);
});

test('each root in the crossbow-string recipe counts when made at the correct wheel', (t) => {
  const ids = core.ItemIdentifiers;
  for (const rootId of [ids.OAK_ROOTS, ids.WILLOW_ROOTS, ids.MAPLE_ROOTS, ids.YEW_ROOTS]) {
    const p = player(t);
    produceRuneCrossbow(p, { x: 2550, y: 3090, z: 0 }, rootId);
    assert.equal(taskDone(p), true, `root ${rootId} counts`);
  }
});

test('noted roots and roots outside the current crossbow-string recipe do not count', (t) => {
  const ids = core.ItemIdentifiers;
  for (const rootId of [
    ids.OAK_ROOTS_2, ids.WILLOW_ROOTS_2, ids.MAPLE_ROOTS_2, ids.YEW_ROOTS_2,
    ids.MAGIC_ROOTS,
  ]) {
    const p = player(t);
    addStockAndLimbsFor(p);
    api.emitCustomEvent('crafting:spun', {
      player: p, itemId: ids.CROSSBOW_STRING, amount: 1,
      inputs: [{ itemId: rootId, amount: 1 }], stationObjectId: 8748,
      location: { x: 2731, y: 3278, z: 0 },
    });
    made(p, ids.RUNITE_CROSSBOW_U_, [
      { itemId: ids.YEW_STOCK, amount: 1 }, { itemId: ids.RUNITE_LIMBS, amount: 1 },
    ], { x: 2550, y: 3090, z: 0 });
    made(p, ids.RUNE_CROSSBOW, [
      { itemId: ids.RUNITE_CROSSBOW_U_, amount: 1 }, { itemId: ids.CROSSBOW_STRING, amount: 1 },
    ], { x: 2550, y: 3090, z: 0 });
    assert.equal(taskDone(p), false, `root ${rootId} does not count`);
  }
});

test('invalid players and incomplete item-consumption provenance do not receive credit', (t) => {
  const ids = core.ItemIdentifiers;
  for (const options of [{ registered: false }, { hitpoints: 0 }, { privateArea: {} }]) {
    const p = player(t, options);
    addStockAndLimbs(t, p);
    api.emitCustomEvent('crafting:spun', {
      player: p, itemId: ids.CROSSBOW_STRING, amount: 1,
      inputs: [{ itemId: ids.SINEW, amount: 1 }], stationObjectId: 8748,
      location: { x: 2731, y: 3278, z: 0 },
    });
    made(p, ids.RUNITE_CROSSBOW_U_, [
      { itemId: ids.YEW_STOCK, amount: 1 }, { itemId: ids.RUNITE_LIMBS, amount: 1 },
    ], { x: 2550, y: 3090, z: 0 });
    made(p, ids.RUNE_CROSSBOW, [{ itemId: ids.RUNITE_CROSSBOW_U_, amount: 1 }], { x: 2550, y: 3090, z: 0 });
    assert.equal(taskDone(p), false);
  }
});

test('the finishing producer snapshot must place the completed crossbow in Yanille or Witchaven', (t) => {
  const outside = player(t);
  addStockAndLimbsFor(outside);
  const ids = core.ItemIdentifiers;
  api.emitCustomEvent('crafting:spun', {
    player: outside, itemId: ids.CROSSBOW_STRING, amount: 1,
    inputs: [{ itemId: ids.SINEW, amount: 1 }], stationObjectId: 8748,
    location: { x: 2731, y: 3278, z: 0 },
  });
  made(outside, ids.RUNITE_CROSSBOW_U_, [
    { itemId: ids.YEW_STOCK, amount: 1 }, { itemId: ids.RUNITE_LIMBS, amount: 1 },
  ], { x: 2550, y: 3090, z: 0 });
  finishWithFletchingProducer(t, outside, { x: 2500, y: 3000, z: 0 });
  assert.equal(taskDone(outside), false);

  const yanille = player(t);
  addStockAndLimbsFor(yanille);
  api.emitCustomEvent('crafting:spun', {
    player: yanille, itemId: ids.CROSSBOW_STRING, amount: 1,
    inputs: [{ itemId: ids.SINEW, amount: 1 }], stationObjectId: 8748,
    location: { x: 2731, y: 3278, z: 0 },
  });
  made(yanille, ids.RUNITE_CROSSBOW_U_, [
    { itemId: ids.YEW_STOCK, amount: 1 }, { itemId: ids.RUNITE_LIMBS, amount: 1 },
  ], { x: 2550, y: 3090, z: 0 });
  finishWithFletchingProducer(t, yanille, { x: 2550, y: 3090, z: 0 });
  assert.equal(taskDone(yanille), true);

  const witchaven = player(t);
  addStockAndLimbsFor(witchaven);
  api.emitCustomEvent('crafting:spun', {
    player: witchaven, itemId: ids.CROSSBOW_STRING, amount: 1,
    inputs: [{ itemId: ids.SINEW, amount: 1 }], stationObjectId: 8748,
    location: { x: 2731, y: 3278, z: 0 },
  });
  made(witchaven, ids.RUNITE_CROSSBOW_U_, [
    { itemId: ids.YEW_STOCK, amount: 1 }, { itemId: ids.RUNITE_LIMBS, amount: 1 },
  ], { x: 2550, y: 3090, z: 0 });
  finishWithFletchingProducer(t, witchaven, { x: 2731, y: 3278, z: 0 });
  assert.equal(taskDone(witchaven), true);
});

test('another staged objective or a newly completed diary task clears the session sequence', (t) => {
  const p = player(t);
  const { STAGE_EVENT, QUERY_EVENT, CROSSBOW_TASK } = Tracker._test;
  const query = () => {
    const request = { player: p, task: CROSSBOW_TASK, result: null };
    api.emitCustomEvent(QUERY_EVENT, request);
    return request.result;
  };

  api.emitCustomEvent(STAGE_EVENT, { player: p, task: CROSSBOW_TASK, stage: '["stock"]' });
  api.emitCustomEvent(STAGE_EVENT, { player: p, task: CROSSBOW_TASK, stage: '["stock"]' });
  assert.deepEqual(query(), { stage: '["stock"]' });
  api.emitCustomEvent(STAGE_EVENT, { player: p, task: Tracker._test.MANTA_TASK, stage: 'caught' });
  assert.equal(query(), null);

  api.emitCustomEvent(STAGE_EVENT, { player: p, task: CROSSBOW_TASK, stage: '["stock"]' });
  const data = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('ardougne');
  const otherTask = data.tiers.easy.tasks[0].key;
  Progress.completeTask(p, data, otherTask);
  assert.equal(query(), null);
  Progress.completeTask(p, data, otherTask);
  assert.equal(query(), null);
});
