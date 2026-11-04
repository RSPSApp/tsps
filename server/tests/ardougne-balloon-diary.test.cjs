const assert = require('node:assert/strict');
const path = require('node:path');
const { before, beforeEach, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

let core;
let Common;
let Travel;
let Controls;
let Progress;
let diary;
let tasks;
let flightTasks;

beforeEach(() => { flightTasks = []; });

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  flightTasks = [];
  const handlers = new Map();
  const api = new Proxy({
    core: { ...core, TaskManager: { submit: (task) => { task.setRunning(true); flightTasks.push(task); } } },
    persistAttribute() {},
    onCustomEvent(name, handler) {
      const entries = handlers.get(name) ?? [];
      entries.push(handler);
      handlers.set(name, entries);
    },
    emitCustomEvent(name, event) {
      for (const handler of handlers.get(name) ?? []) handler(event);
      if (name === 'quest:is-complete') event.complete = true;
    },
  }, { get: (target, key) => key in target ? target[key] : () => {} });

  Common = require('../plugins/world/balloontransport/Common.BalloonTransport');
  Travel = require('../plugins/world/balloontransport/Travel.BalloonTransport');
  Controls = require('../plugins/world/balloontransport/Controls.BalloonTransport');
  Common.init(api);
  Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
  diary = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('ardougne');
  tasks = require('../plugins/achievements/AchievementDiaries.plugin')._test.onTask;
  api.onCustomEvent('diary:task', tasks);
  Progress(api);
  require('../plugins/achievements/diaries/ArdougneBalloonDiary.plugin').register(api);
});

const station = (key) => Common.data.stations.find((entry) => entry.key === key);
const TASK = 'travel-to-castlewars-by-hot-air-balloon';

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    const due = flightTasks;
    flightTasks = [];
    for (const task of due) if (task.tick()) flightTasks.push(task);
  }
}

function flyCastleControls(player) {
  const moves = { S: 'zep_btn_sandbags', L: 'zep_btn_logs', R: 'zep_btn_relax', N: 'zep_btn_tug', E: 'zep_btn_tug_emerg' };
  const solution = 'S2 L1 R5 E1 L1 R2 E1 R2 L2 R3 | L1 R2 E1 N1 R7 S1 R2 E1 L1 N1 R1 | L1 R2 N1 R3 L1 E1 R4 S1 E1 R2 N1';
  for (const step of solution.replace(/\|/g, ' ').split(/\s+/).filter(Boolean)) {
    for (let i = 0; i < Number(step.slice(1)); i++) {
      const uid = core.CacheDefinitions.getComponentId(`zep_interface_side:${moves[step[0]]}`);
      Controls.controlClick({ player, buttonId: uid, groupId: uid >>> 16, childId: uid & 0xffff });
      tick(2);
    }
  }
}

function playerFixture(t, { at = [2939, 3421], registered = true, privateArea = null, landingPrivateArea, logs = 1, openedCastle = true } = {}) {
  let tile = new core.Location(...at, 0);
  let currentPrivateArea = privateArea;
  let carriedLogs = logs;
  const varbits = new Map();
  const sender = new Proxy({}, { get: (_target, key) => key === 'sendVarbit'
    ? (id, value) => varbits.set(id, value)
    : () => sender });
  const player = {
    attributes: { [Progress.TASKS_ATTRIBUTE]: {} },
    varbits,
    isRegistered: () => registered,
    isDyingReturn: () => false,
    getHitpoints: () => 99,
    getPrivateArea: () => currentPrivateArea,
    getLocation: () => tile,
    moveTo: (location) => {
      tile = location;
      if (landingPrivateArea !== undefined) currentPrivateArea = landingPrivateArea;
    },
    getAttribute: (key) => player.attributes[key],
    setAttribute: (key, value) => { player.attributes[key] = value; },
    sendMessage() {},
    getSkillManager: () => ({ getMaxLevel: () => 99, addExperience() {} }),
    getInventory: () => ({
      getItems: () => carriedLogs > 0 ? [new core.Item(1515, carriedLogs)] : [],
      getAmount: (id) => id === 1515 ? carriedLogs : 0,
      delete: (_id, amount) => { carriedLogs -= amount; },
      adds: (_id, amount) => { carriedLogs += amount; },
      refreshItems() {},
    }),
    getEquipment: () => ({ getItems: () => [], get: () => new core.Item(-1, 0) }),
    getSpellbook: () => ({ getInterfaceId: () => 218 }),
    getMovementQueue: () => ({ setBlockMovement() { return this; }, reset() { return this; } }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues: (chain) => { player.lastChain = chain; } }),
  };
  player.setRegistered = (value) => { registered = value; };
  player.setPrivateArea = (area) => { currentPrivateArea = area; };
  player.logs = () => carriedLogs;
  player.setAttribute(Common.ROUTES_ATTRIBUTE, openedCastle ? station('castle').bit : 0);
  t.after(() => core.TaskManager.cancelTasks?.(player.getIndex?.()));
  return { player, varbits };
}

test('a Taverley passenger trip to Castle Wars credits Ardougne medium after landing', (t) => {
  const { player, varbits } = playerFixture(t, { landingPrivateArea: { staleOrigin: true } });
  let arrival;
  Common.api.onCustomEvent('balloon-transport:passenger-arrival', (event) => { arrival = event; });
  const originalLater = Common.later;
  Common.later = (ticks, action) => flightTasks.push({ ticks, action });
  t.after(() => { Common.later = originalLater; });

  Travel.travel(player, station('taverley'), station('castle'));
  assert.equal(player.logs(), 0, 'the fare is paid when the flight starts');
  assert.equal(Progress.tierCount(player, diary, 'medium'), 0);
  flightTasks.find(({ ticks }) => ticks === Common.data.flight.teleportAt).action();

  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], station('castle').land);
  assert.ok(Progress.doneTasks(player, diary).has(TASK));
  assert.equal(Progress.tierCount(player, diary, 'medium'), 1);
  assert.equal(varbits.get(diary.tiers.medium.countVarbit), 1);
  assert.equal(player.logs(), 0);
  Common.api.emitCustomEvent('balloon-transport:passenger-arrival', arrival);
  assert.equal(Progress.tierCount(player, diary, 'medium'), 1, 'replaying the event does not duplicate progress');
});

test('opening Castle Wars does not credit, and wrong stations or invalid players do not credit', (t) => {
  const { player } = playerFixture(t, { at: [2808, 3354], logs: 10, openedCastle: false });
  const plugin = require('../plugins/achievements/diaries/ArdougneBalloonDiary.plugin');
  const handler = plugin._test;
  assert.equal(Progress.tierCount(player, diary, 'medium'), 0);

  assert.equal(Controls.takeOff(player, station('castle'), 10, 'inventory'), true);
  flyCastleControls(player);
  tick(4);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], station('castle').land);
  assert.equal(Common.opened(player, station('castle')), true);
  assert.equal(Progress.tierCount(player, diary, 'medium'), 0);

  const emitArrival = (station, opensRoute = false, origin = { station: 'taverley', isPublic: true }) => Common.api.emitCustomEvent('balloon-transport:passenger-arrival', { player, station, opensRoute, origin });
  emitArrival('varrock');
  emitArrival('castle', true);
  emitArrival('castle', false, { station: 'unverified', isPublic: true });
  emitArrival('castle', false, { station: 'taverley', isPublic: false });
  const { player: spoofedPlayer } = playerFixture(t);
  spoofedPlayer.moveTo(Common.tile(station('castle').land));
  spoofedPlayer.setPrivateArea({ staleOrigin: true });
  Common.api.emitCustomEvent('balloon-transport:passenger-arrival', { player: spoofedPlayer, station: 'castle', opensRoute: false, origin: { station: 'taverley', isPublic: true } });
  assert.equal(Progress.tierCount(spoofedPlayer, diary, 'medium'), 0, 'a forged arrival does not credit progress');
  player.setRegistered(false);
  emitArrival('castle');
  assert.equal(Progress.tierCount(player, diary, 'medium'), 0);

  player.setRegistered(true);
  emitArrival('castle');
  emitArrival('castle');
  assert.equal(Progress.tierCount(player, diary, 'medium'), 0);
  assert.equal(handler.atCastleWarsLanding(player), true);
});

test('an interrupted or dead passenger flight does not credit the diary', (t) => {
  for (const interrupted of ['moved', 'dead']) {
    const { player } = playerFixture(t);
    const originalLater = Common.later;
    const scheduled = [];
    Common.later = (ticks, action) => scheduled.push({ ticks, action });
    Travel.travel(player, station('taverley'), station('castle'));
    if (interrupted === 'moved') player.moveTo(new core.Location(3000, 3000, 0));
    else player.isDyingReturn = () => true;
    scheduled.find(({ ticks }) => ticks === Common.data.flight.teleportAt).action();
    Common.later = originalLater;
    assert.equal(Progress.tierCount(player, diary, 'medium'), 0, `${interrupted} flight`);
    assert.equal(player.logs(), 1, `${interrupted} flight refunds its fare`);
  }
});

test('a private departure or unverified source does not credit the diary', (t) => {
  const { player } = playerFixture(t, { privateArea: {} });
  const originalLater = Common.later;
  const scheduled = [];
  Common.later = (ticks, action) => scheduled.push({ ticks, action });
  Travel.travel(player, station('taverley'), station('castle'));
  scheduled.find(({ ticks }) => ticks === Common.data.flight.teleportAt).action();
  Common.later = originalLater;
  assert.equal(Progress.tierCount(player, diary, 'medium'), 0);

  const events = [];
  Common.api.onCustomEvent('balloon-transport:passenger-arrival', (event) => events.push(event));
  const { player: publicPlayer } = playerFixture(t);
  const publicSchedule = [];
  Common.later = (ticks, action) => publicSchedule.push({ ticks, action });
  Travel.travel(publicPlayer, station('varrock'), station('castle'));
  publicSchedule.find(({ ticks }) => ticks === Common.data.flight.teleportAt).action();
  Common.later = originalLater;
  assert.equal(events.at(-1)?.origin?.station, 'taverley');
  assert.equal(events.at(-1)?.origin?.isPublic, true);
});

test('moving before logout aborts the passenger flight and refunds its fare', (t) => {
  const { player } = playerFixture(t);
  Travel.travel(player, station('taverley'), station('castle'));
  player.moveTo(new core.Location(3000, 3000, 0));
  player.setRegistered(false);
  Travel.logout({ player });

  assert.equal(Progress.tierCount(player, diary, 'medium'), 0);
  assert.equal(player.logs(), 1);
});

test('a dead player who logs out during flight gets the fare back and no diary credit', (t) => {
  const { player } = playerFixture(t);
  Travel.travel(player, station('taverley'), station('castle'));
  player.isDyingReturn = () => true;
  player.setRegistered(false);
  Travel.logout({ player });

  assert.equal(Progress.tierCount(player, diary, 'medium'), 0);
  assert.equal(player.logs(), 1);
});

test('logging out during a valid passenger flight lands at Castle Wars and saves the diary task', (t) => {
  const { player, varbits } = playerFixture(t);
  Travel.travel(player, station('taverley'), station('castle'));
  assert.equal(player.logs(), 0);
  player.setRegistered(false);
  Travel.logout({ player });

  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], station('castle').land);
  assert.ok(Progress.doneTasks(player, diary).has(TASK));
  assert.equal(varbits.get(diary.tiers.medium.countVarbit), 1);
  assert.equal(player.logs(), 0);
});
