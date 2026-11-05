const assert = require('node:assert/strict');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');

let core, Data, Model, Patches, Progress, diary, harvested, observedHarvests;
const TASK = 'pick-some-poison-ivy-berries-from-the-patch-sout';

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
  const receiver = require('../plugins/achievements/diaries/ArdougnePoisonIvyDiary.plugin');
  receiver.register({
    onCustomEvent: (name, handler) => { if (name === 'farming:harvested') harvested = handler; },
    emitCustomEvent: (name, request) => {
      if (name === 'diary:task') Progress.completeTask(request.player, diary, request.task);
    },
  });
  Progress({ core, persistAttribute: () => {}, onPlayerLogin: () => {}, emitCustomEvent: () => {} });
});

function fixture(t, patch = Data.CACHE.patches.find(p => p.id === 7580)) {
  assert.deepEqual(patch, { id: 7580, type: 'BUSH', varbit: 4771, x: 2617, y: 3225, z: 0, maxX: 2617, maxY: 3225 });
  assert.ok(core.CacheDefinitions.getObject(patch.id), 'cache has the canonical bush patch object');
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
  player.getSkillManager().setMaxLevels(core.Skill.FARMING, 99, false).setCurrentLevels(core.Skill.FARMING, 99, false);
  player.moveTo(new core.Location(patch.x, patch.y, patch.z));
  const farm = { offset: 0, patches: {}, tools: {} };
  const state = { ...Model.emptyPatch(Date.now(), farm), crop: 'POISON_IVY', stage: Data.CROPS.get('POISON_IVY').stages,
    status: 'grown', checked: true, lives: 4, nextAt: Number.MAX_SAFE_INTEGER };
  farm.patches[Data.patchKey(patch)] = state;
  player.setAttribute(Patches.FARM_ATTRIBUTE, farm);
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  observedHarvests = [];
  t.mock.method(core.PluginManager, 'emitCustomEvent', (name, payload) => {
    if (name === 'farming:harvested') {
      observedHarvests.push(payload);
      harvested(payload);
    }
    if (name === 'diary:task') Progress.completeTask(payload.player, diary, payload.task);
  });
  return { player, patch, state, bits };
}

test('picking Poison Ivy berries from the Ardougne south patch completes Ardougne Hard #8', t => {
  const f = fixture(t);
  assert.equal(Patches.harvest(f.player, f.patch), true);
  assert.equal(observedHarvests.length, 1);
  assert.equal(observedHarvests[0].crop, 'POISON_IVY');
  assert.equal(observedHarvests[0].patch, f.patch);
  assert.equal(observedHarvests[0].itemId, Data.itemId('Poison ivy berries'));
  assert.ok(observedHarvests[0].amount > 0);
  assert.equal(f.player.getInventory().getAmount(Data.itemId('Poison ivy berries')), observedHarvests[0].amount);
  assert.equal(Progress.tierCount(f.player, diary, 'hard'), 1);
  assert.ok(Progress.doneTasks(f.player, diary).has(TASK));
  assert.equal(f.bits.get(diary.tiers.hard.countVarbit), 1);
  assert.equal(Patches.harvest(f.player, f.patch), true);
  assert.equal(observedHarvests.length, 2);
  assert.equal(Progress.tierCount(f.player, diary, 'hard'), 1);
});

test('a failed produce grant does not complete the Poison Ivy task', t => {
  const f = fixture(t);
  const berries = Data.itemId('Poison ivy berries');
  for (let i = 0; i < 28; i++) f.player.getInventory().add(new core.Item(berries), false);
  assert.equal(Patches.harvest(f.player, f.patch), false);
  assert.equal(Progress.tierCount(f.player, diary, 'hard'), 0);
});

test('the Poison Ivy task rejects other crops, patches, planes, private areas, and unavailable players', t => {
  const f = fixture(t);
  const blocked = [
    { player: f.player, crop: 'WHITEBERRIES', patch: f.patch },
    { player: f.player, crop: 'POISON_IVY', patch: { ...f.patch, id: 7581 } },
    { player: f.player, crop: 'POISON_IVY', patch: { ...f.patch, x: 2616 } },
    { player: f.player, crop: 'POISON_IVY', patch: { ...f.patch, z: 1 } },
    { player: Object.assign(Object.create(f.player), { getPrivateArea: () => ({}) }), crop: 'POISON_IVY', patch: f.patch },
    { player: Object.assign(Object.create(f.player), { getHitpoints: () => 0 }), crop: 'POISON_IVY', patch: f.patch },
  ];
  for (const event of blocked) harvested(event);
  assert.equal(Progress.tierCount(f.player, diary, 'hard'), 0);
});
