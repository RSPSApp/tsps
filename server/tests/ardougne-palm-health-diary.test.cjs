const assert = require('node:assert/strict');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');

let core, Data, Model, Patches, Progress, diary, checkedHealth, objectInteraction;
const TASK = 'check-the-health-of-a-palm-tree-near-tree-gnome';

before(async () => {
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  require('../plugins/skills/farming/Core.Farming').init({ core });
  Data = require('../plugins/skills/farming/Data.Farming');
  Model = require('../plugins/skills/farming/Model.Farming');
  Patches = require('../plugins/skills/farming/Patches.Farming');
  Data.initializeFarmingData();
  Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
  diary = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('ardougne');
  const receiver = require('../plugins/achievements/diaries/ArdougnePalmHealthDiary.plugin');
  receiver.register({
    onCustomEvent: (name, handler) => { if (name === 'farming:check-health') checkedHealth = handler; },
    emitCustomEvent: (name, request) => {
      if (name === 'diary:task') Progress.completeTask(request.player, diary, request.task);
    },
  });
  Progress({ core, persistAttribute: () => {}, onPlayerLogin: () => {}, emitCustomEvent: () => {} });
  Patches.attach(new Proxy({}, { get: (_, name) => (...args) => {
    if (name === 'onObjectInteraction') objectInteraction = args[0];
  } }));
});

function fixture(t, patch = Data.CACHE.patches.find(p => p.id === 7963)) {
  assert.deepEqual(patch, { id: 7963, type: 'FRUIT_TREE', varbit: 4771, x: 2489, y: 3179, z: 0, maxX: 2489, maxY: 3179 });
  assert.ok(core.CacheDefinitions.getObject(patch.id), 'cache has the canonical fruit-tree patch object');
  const player = new Player(null), bits = new Map();
  const sender = new Proxy({}, { get: (_, name) => name === 'getVarbit' ? id => bits.get(id) ?? 0
    : name === 'sendVarbit' ? (id, value) => { bits.set(id, value); return sender; } : () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.performAnimation = () => {};
  player.isRegistered = () => true;
  player.getPrivateArea = () => null;
  player.getHitpoints = () => 10;
  player.isDyingReturn = () => false;
  player.getClickDelay = () => ({ elapsedTime: () => true, reset() {} });
  player.getSkillManager().setMaxLevels(core.Skill.FARMING, 99, false).setCurrentLevels(core.Skill.FARMING, 99, false);
  player.moveTo(new core.Location(patch.x, patch.y, patch.z));
  const farm = { offset: 0, patches: {}, tools: {} };
  const state = { ...Model.emptyPatch(Date.now(), farm), crop: 'PALM', stage: Data.CROPS.get('PALM').stages,
    status: 'grown', checked: false, lives: 1, nextAt: Number.MAX_SAFE_INTEGER };
  farm.patches[Data.patchKey(patch)] = state;
  player.setAttribute(Patches.FARM_ATTRIBUTE, farm);
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  t.mock.method(core.ObjectDefinition, 'forPlayer', () => ({ getInteractions: () => ['Check-health'] }));
  t.mock.method(core.MapObjects, 'get', () => null);
  t.mock.method(core.PluginManager, 'emitCustomEvent', (name, payload) => {
    if (name === 'farming:check-health') checkedHealth(payload);
    if (name === 'diary:task') Progress.completeTask(payload.player, diary, payload.task);
  });
  const event = { player, object: { getId: () => patch.id }, clickType: 1,
    location: { x: patch.x, y: patch.y, z: patch.z } };
  return { player, patch, state, bits, check: () => objectInteraction(event) };
}

test('checking a grown Palm at the Tree Gnome Village patch completes Ardougne Hard #7', t => {
  const f = fixture(t);
  f.check();
  assert.equal(f.state.checked, true);
  assert.equal(Progress.tierCount(f.player, diary, 'hard'), 1);
  assert.ok(Progress.doneTasks(f.player, diary).has(TASK));
  assert.equal(f.bits.get(diary.tiers.hard.countVarbit), 1);
  f.check();
  assert.equal(Progress.tierCount(f.player, diary, 'hard'), 1);
});

test('the Palm health task rejects other crops, patches, planes, private areas, and unavailable players', t => {
  const f = fixture(t);
  const blocked = [
    { player: f.player, crop: 'PAPAYA', type: 'FRUIT_TREE', patch: f.patch },
    { player: f.player, crop: 'PALM', type: 'FRUIT_TREE', patch: { ...f.patch, id: 7962 } },
    { player: f.player, crop: 'PALM', type: 'TREE', patch: f.patch },
    { player: f.player, crop: 'PALM', type: 'FRUIT_TREE', patch: { ...f.patch, z: 1 } },
    { player: Object.assign(Object.create(f.player), { getPrivateArea: () => ({}) }), crop: 'PALM', type: 'FRUIT_TREE', patch: f.patch },
    { player: Object.assign(Object.create(f.player), { getHitpoints: () => 0 }), crop: 'PALM', type: 'FRUIT_TREE', patch: f.patch },
  ];
  for (const event of blocked) checkedHealth(event);
  assert.equal(Progress.tierCount(f.player, diary, 'hard'), 0);
});
