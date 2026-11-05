const assert = require('node:assert/strict');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');

let core, Progress, ardougne;
const handlers = new Map();
const completedEvents = [];
const progressedEvents = [];
const MANTA_TASK = 'catch-a-manta-ray-in-the-fishing-trawler-and-coo';
const CROSSBOW_TASK = 'make-a-rune-crossbow-yourself-from-scratch-withi';

function dispatch(name, payload) {
  for (const handler of handlers.get(name) ?? []) handler(payload);
}

before(async () => {
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
  ardougne = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('ardougne');
  const api = {
    core,
    persistAttribute: () => {},
    onPlayerLogin: () => {},
    emitCustomEvent: dispatch,
  };
  Progress(api);
  const taskProgress = require('../plugins/achievements/diaries/ArdougneEliteTaskProgress.plugin');
  taskProgress.register({
    onCustomEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    onPlayerLogout: (handler) => handlers.set('player:logout', [...(handlers.get('player:logout') ?? []), handler]),
    onPlayerDisconnect: (handler) => handlers.set('player:disconnect', [...(handlers.get('player:disconnect') ?? []), handler]),
  });
  handlers.set('diary:task-completed', [...(handlers.get('diary:task-completed') ?? []), (event) => completedEvents.push(event)]);
  handlers.set('diary:task-progressed', [...(handlers.get('diary:task-progressed') ?? []), (event) => progressedEvents.push(event)]);
});

function player() {
  const result = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  result.getPacketSender = () => sender;
  result.sendMessage = () => {};
  result.isRegistered = () => true;
  result.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  return result;
}

function advance(player, task, stage) {
  dispatch('ardougne-elite:task-stage', { player, task, stage });
}

function query(player, task) {
  const request = { player, task };
  dispatch('ardougne-elite:task-stage-query', request);
  return request.result;
}

test('accepted diary completion emits after Progress records it and clears staged progress', () => {
  const staged = player();
  advance(staged, MANTA_TASK, 'caught');
  const previousEvents = completedEvents.length;
  const task = ardougne.tiers.easy.tasks[0].key;

  assert.equal(Progress.completeTask(staged, ardougne, task), true);
  assert.equal(completedEvents.length, previousEvents + 1);
  assert.equal(completedEvents.at(-1).task, task);
  assert.ok(Progress.doneTasks(staged, ardougne).has(task));
  assert.equal(query(staged, MANTA_TASK), null);
});

test('duplicate task requests do not clear staged progress or emit completion', () => {
  const staged = player();
  const task = ardougne.tiers.easy.tasks[1].key;
  assert.equal(Progress.completeTask(staged, ardougne, task), true);
  advance(staged, MANTA_TASK, 'caught');
  const previousEvents = completedEvents.length;

  assert.equal(Progress.completeTask(staged, ardougne, task), false);
  assert.equal(completedEvents.length, previousEvents);
  assert.deepEqual(query(staged, MANTA_TASK), { stage: 'caught' });
});

test('stage transitions retain their task and another accepted stage replaces it', () => {
  const staged = player();
  advance(staged, MANTA_TASK, 'caught');
  advance(staged, MANTA_TASK, 'cooked');
  assert.deepEqual(query(staged, MANTA_TASK), { stage: 'cooked' });

  advance(staged, CROSSBOW_TASK, 'limbs-made');
  assert.equal(query(staged, MANTA_TASK), null);
  assert.deepEqual(query(staged, CROSSBOW_TASK), { stage: 'limbs-made' });

  advance(staged, CROSSBOW_TASK, 'limbs-made');
  assert.deepEqual(query(staged, CROSSBOW_TASK), { stage: 'limbs-made' });
});

test('invalid players cannot change staged task state', () => {
  const staged = player();
  advance(staged, MANTA_TASK, 'caught');
  const unavailable = Object.assign(Object.create(staged), { isRegistered: () => false });
  advance(unavailable, MANTA_TASK, 'cooked');

  assert.deepEqual(query(staged, MANTA_TASK), { stage: 'caught' });
  assert.equal(query(unavailable, MANTA_TASK), null);
});

test('accepted completion in another diary clears progress without affecting another player', () => {
  const staged = player();
  const other = player();
  advance(staged, MANTA_TASK, 'caught');
  advance(other, MANTA_TASK, 'caught');
  const varrock = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('varrock');

  assert.equal(Progress.completeTask(staged, varrock, varrock.tiers.easy.tasks[0].key), true);
  assert.equal(query(staged, MANTA_TASK), null);
  assert.deepEqual(query(other, MANTA_TASK), { stage: 'caught' });
});

test('accepted progress in another diary resets only the matching player stage', () => {
  const staged = player();
  const other = player();
  const varrock = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('varrock');
  advance(staged, MANTA_TASK, 'caught');
  advance(other, MANTA_TASK, 'caught');
  const previousEvents = progressedEvents.length;
  const task = varrock.tiers.easy.tasks[0].key;

  assert.equal(Progress.notifyTaskProgress(staged, varrock, task), true);
  assert.equal(progressedEvents.length, previousEvents + 1);
  assert.deepEqual(progressedEvents.at(-1), { player: staged, diary: 'varrock', task });
  assert.equal(query(staged, MANTA_TASK), null);
  assert.deepEqual(query(other, MANTA_TASK), { stage: 'caught' });
});

test('same accepted partial task retains its stage while another task clears it', () => {
  const staged = player();
  const task = ardougne.tiers.elite.tasks.find(({ key }) => key === MANTA_TASK);
  advance(staged, MANTA_TASK, 'caught');

  assert.equal(Progress.notifyTaskProgress(staged, ardougne, MANTA_TASK), true);
  assert.deepEqual(query(staged, MANTA_TASK), { stage: 'caught' });
  assert.equal(Progress.notifyTaskProgress(staged, ardougne, CROSSBOW_TASK), true);
  assert.equal(query(staged, MANTA_TASK), null);
  assert.ok(task);
});

test('unknown, completed, and duplicate progress notifications are rejected', () => {
  const staged = player();
  const varrock = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('varrock');
  const task = varrock.tiers.easy.tasks[0].key;
  assert.equal(Progress.notifyTaskProgress(staged, varrock, 'unknown-task'), false);
  assert.equal(Progress.notifyTaskProgress(staged, ardougne, MANTA_TASK), true);
  assert.equal(Progress.completeTask(staged, varrock, task), true);
  const before = progressedEvents.length;
  assert.equal(Progress.notifyTaskProgress(staged, varrock, task), false);
  assert.equal(progressedEvents.length, before);
  assert.equal(Progress.notifyTaskProgress(null, varrock, task), false);
});

test('logout and disconnect clear only that player session', () => {
  const loggedOut = player();
  const connected = player();
  advance(loggedOut, MANTA_TASK, 'caught');
  advance(connected, MANTA_TASK, 'caught');

  for (const handler of handlers.get('player:logout')) handler({ player: loggedOut });
  assert.equal(query(loggedOut, MANTA_TASK), null);
  assert.deepEqual(query(connected, MANTA_TASK), { stage: 'caught' });
  for (const handler of handlers.get('player:disconnect')) handler({ player: connected });
  assert.equal(query(connected, MANTA_TASK), null);
});

test('stage queries return only an active player and matching task stage', () => {
  const owner = player();
  const other = player();
  advance(owner, MANTA_TASK, 'caught');

  assert.deepEqual(query(owner, MANTA_TASK), { stage: 'caught' });
  assert.equal(query(owner, CROSSBOW_TASK), null);
  assert.equal(query(other, MANTA_TASK), null);
  assert.equal(query(null, MANTA_TASK), null);
  assert.equal(query(Object.assign(Object.create(owner), { isRegistered: () => false }), MANTA_TASK), null);
});

test('stage values must be nonempty strings and query results cannot mutate stored state', () => {
  const owner = player();
  const supplied = { label: 'caught' };
  advance(owner, MANTA_TASK, supplied);
  advance(owner, MANTA_TASK, 2);
  advance(owner, MANTA_TASK, '');
  advance(owner, MANTA_TASK, '   ');
  assert.equal(query(owner, MANTA_TASK), null);

  advance(owner, MANTA_TASK, 'caught');
  const first = query(owner, MANTA_TASK);
  first.stage = 'changed by caller';
  assert.deepEqual(query(owner, MANTA_TASK), { stage: 'caught' });
  supplied.label = 'changed by caller';
  assert.deepEqual(query(owner, MANTA_TASK), { stage: 'caught' });
});

test('completing the active task clears its stage and repeated completion stays cleared', () => {
  const owner = player();
  advance(owner, MANTA_TASK, 'caught');
  const task = ardougne.tiers.elite.tasks.find(({ key }) => key === MANTA_TASK);
  assert.ok(task);

  assert.equal(Progress.completeTask(owner, ardougne, task.key), true);
  assert.equal(query(owner, MANTA_TASK), null);
  assert.equal(Progress.completeTask(owner, ardougne, task.key), false);
  assert.equal(query(owner, MANTA_TASK), null);
});

test('a stage clear only clears the matching task owned by that player', () => {
  const owner = player();
  const other = player();
  advance(owner, MANTA_TASK, 'caught');
  advance(other, MANTA_TASK, 'caught');

  dispatch('ardougne-elite:task-stage-clear', { player: owner, task: CROSSBOW_TASK });
  assert.deepEqual(query(owner, MANTA_TASK), { stage: 'caught' });
  dispatch('ardougne-elite:task-stage-clear', { player: owner, task: MANTA_TASK });
  assert.equal(query(owner, MANTA_TASK), null);
  assert.deepEqual(query(other, MANTA_TASK), { stage: 'caught' });
});
