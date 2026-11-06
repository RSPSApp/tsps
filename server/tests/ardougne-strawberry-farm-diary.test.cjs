const assert = require('node:assert/strict');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');

let core, Data, Patches, Progress, diary, harvested;

before(async () => {
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  require('../plugins/skills/farming/Core.Farming').init({ core });
  Data = require('../plugins/skills/farming/Data.Farming');
  Patches = require('../plugins/skills/farming/Patches.Farming');
  Data.initializeFarmingData();
  Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
  diary = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('ardougne');
  const receiver = require('../plugins/achievements/diaries/ArdougneStrawberryFarmDiary.plugin');
  receiver.register({
    core,
    onCustomEvent: (name, handler) => { if (name === 'farming:harvested') harvested = handler; },
    emitCustomEvent: (name, request) => {
      if (name === 'diary:task') Progress.completeTask(request.player, diary, request.task);
    },
  });
  Progress({
    core,
    persistAttribute: () => {},
    onPlayerLogin: () => {},
    emitCustomEvent: () => {},
  });
});

function fixture(t, patchId = 8554) {
  const player = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.isRegistered = () => true;
  player.getPrivateArea = () => null;
  player.getHitpoints = () => 10;
  player.isDyingReturn = () => false;
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  const patch = { id: patchId, type: 'ALLOTMENT', x: 2665, y: 3375, z: 0 };
  const state = Patches.stateFor(player, patch);
  Object.assign(state, { crop: 'STRAWBERRY', status: 'grown', lives: 2, checked: true });
  t.mock.method(core.PluginManager, 'emitCustomEvent', (name, request) => {
    if (name === 'farming:harvested') harvested(request);
    if (name === 'diary:task') Progress.completeTask(request.player, diary, request.task);
  });
  return { player, patch, state };
}

for (const id of [8554, 8555]) test(`a successful strawberry pick at allotment ${id} advances the medium diary`, t => {
  const task = 'harvest-some-strawberries-from-the-ardougne-farm';
  const f = fixture(t, id);
  assert.equal(Patches.harvest(f.player, f.patch), true);
  assert.equal(Progress.tierCount(f.player, diary, 'medium'), 1);
  assert.ok(Progress.doneTasks(f.player, diary).has(task));
});

test('a failed produce grant does not advance the diary', t => {
  const f = fixture(t);
  const inventory = f.player.getInventory();
  for (let i = 0; i < 28; i++) inventory.add(new core.Item(Data.itemId('Strawberry')), false);
  assert.equal(Patches.harvest(f.player, f.patch), false);
  assert.equal(Progress.tierCount(f.player, diary, 'medium'), 0);
});

test('the receiver ignores other crops, patches, planes, private areas, and unavailable players', t => {
  const f = fixture(t);
  const task = 'harvest-some-strawberries-from-the-ardougne-farm';
  const blocked = [
    { crop: 'POTATO', patch: f.patch, player: f.player },
    { crop: 'STRAWBERRY', patch: { ...f.patch, id: 9999 }, player: f.player },
    { crop: 'STRAWBERRY', patch: { ...f.patch, x: 2661 }, player: f.player },
    { crop: 'STRAWBERRY', patch: { ...f.patch, z: 1 }, player: f.player },
    { crop: 'STRAWBERRY', patch: f.patch, player: Object.assign(Object.create(f.player), { getPrivateArea: () => ({}) }) },
    { crop: 'STRAWBERRY', patch: f.patch, player: Object.assign(Object.create(f.player), { getHitpoints: () => 0 }) },
  ];
  for (const event of blocked) harvested(event);
  assert.equal(Progress.doneTasks(f.player, diary).has(task), false);
});
