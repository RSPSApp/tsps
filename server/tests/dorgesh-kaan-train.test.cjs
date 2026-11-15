// After yarn build: node --test tests/dorgesh-kaan-train.test.cjs
//
// The Dorgesh-Kaan - Keldagrim train against the Wiki (Another Slice of H.A.M. needed, 50 ticks
// a trip) and rsprox_transcripts/232/03199.txt (the lines, the ride's ticks, the arrival tiles).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');

let core;
let Train;
const completed = new Set();
const diaryTasks = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  const api = PluginManager.createApi('DorgeshKaanTrainTest');
  api.onCustomEvent('diary:task', (event) => diaryTasks.push([event.player, event.diary, event.task]));
  api.onCustomEvent('quest:is-complete', (request) => {
    if (request.key === 'another_slice_of_ham') request.complete = completed.has(request.player);
  });
  Train = require('../plugins/world/DorgeshKaanTrain.plugin');
  Train.register(api);
});

let index = 1500;
function rider({ done = true, at = [2483, 5538] } = {}) {
  const player = new Player(null, new core.Location(at[0], at[1], 0));
  player.setIndex(index++);
  player.setUsername('train-test');
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.messages = [];
  player.sendMessage = (text) => player.messages.push(text);
  player.sounds = [];
  const sender = player.getPacketSender();
  const sendSound = sender.sendSound.bind(sender);
  sender.sendSound = (id, ...rest) => { player.sounds.push(id); return sendSound(id, ...rest); };
  if (done) completed.add(player);
  PluginManager.updatePlayerZones(player);
  return player;
}

function step(player, x, y) {
  player.moveTo(new core.Location(x, y, 0));
  PluginManager.updatePlayerZones(player);
}

/** One game tick: the tasks, then each rider's zones (as the player process does). */
function tick(players, n = 1) {
  for (let i = 0; i < n; i++) {
    core.TaskManager.process();
    for (const player of players) PluginManager.updatePlayerZones(player);
  }
}

const xyz = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];

test('stepping into the Dorgesh-Kaan train: the line, then 36 ticks on the ride to Keldagrim on the recorded ticks', () => {
  const player = rider();
  step(player, 2480, 5538);
  assert.deepEqual(player.messages, ['The train will leave for Keldagrim shortly.']);
  tick([player], 35);
  assert.equal(player.messages.length, 1);
  tick([player]);
  assert.deepEqual(player.messages.at(-1), 'The train takes you to Keldagrim.');
  assert.equal(player.getMovementQueue().isMovementBlocked(), true);
  tick([player], 3);
  assert.deepEqual(xyz(player), [2542, 5506, 0], 'the cutscene room 3 ticks on');
  tick([player]);
  assert.deepEqual(player.sounds.slice(-1), [3584]);
  tick([player], 9);
  assert.deepEqual(xyz(player), [2443, 5533, 0], 'the other train, tile turned half round (2480,5538 -> 2443,5533)');
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.deepEqual(diaryTasks.filter(([who]) => who === player).map(([, diary, task]) => [diary, task]), [['lumbridge', 'take-the-train-from-dorgesh-kaan-to-keldagrim']]);
  tick([player]);
  assert.equal(player.messages.at(-1), 'The train will leave for Dorgesh-Kaan shortly.', 'still aboard: the next one');

  // Staying aboard, back 36 ticks later (50 a trip, Wiki).
  tick([player], 36 + 13);
  assert.equal(player.messages.at(-2), 'The train takes you to Dorgesh-Kaan.');
  assert.deepEqual(xyz(player), [2480, 5538, 0]);
  assert.equal(diaryTasks.filter(([who]) => who === player).length, 1, 'Keldagrim to Dorgesh-Kaan is not the task');
  core.TaskManager.cancelTasks(player);
});

test('stepping out before it leaves: no ride; and without Another Slice of H.A.M. nothing happens', () => {
  const player = rider({ at: [2441, 5533] });
  step(player, 2443, 5530);
  assert.deepEqual(player.messages, ['The train will leave for Dorgesh-Kaan shortly.']);
  tick([player], 10);
  step(player, 2441, 5533);
  tick([player], 40);
  assert.equal(player.messages.length, 1, 'no departure');
  assert.deepEqual(xyz(player), [2441, 5533, 0]);

  const stranger = rider({ done: false });
  step(stranger, 2480, 5541);
  tick([stranger], 40);
  assert.deepEqual(stranger.messages, []);
  assert.deepEqual(xyz(stranger), [2480, 5541, 0]);
});

test('the arrival tile mirrors the departure one, as all five recorded trips', () => {
  const { arrivalTile } = Train._test;
  const to = (x, y) => { const at = arrivalTile(new core.Location(x, y, 0)); return [at.getX(), at.getY()]; };
  assert.deepEqual(to(2479, 5538), [2444, 5533]);
  assert.deepEqual(to(2444, 5533), [2479, 5538]);
  assert.deepEqual(to(2480, 5538), [2443, 5533]);
  assert.deepEqual(to(2443, 5533), [2480, 5538]);
  assert.deepEqual(to(2443, 5530), [2480, 5541]);
});

test('a logout mid-ride is saved on the other train', () => {
  const player = rider();
  step(player, 2479, 5538);
  tick([player], 36 + 5);
  assert.deepEqual(xyz(player), [2542, 5506, 0]);
  Train._test.logout({ player });
  assert.deepEqual(xyz(player), [2444, 5533, 0]);
  assert.equal(Train._test.riding.has(player), false);
});
