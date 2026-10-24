// From server/: node --test tests/lovakengj-minecarts.test.cjs (after yarn build).
//
// The Lovakengj Minecart Network against the OSRS Wiki (Lovakengj_Minecart_Network, the
// conductors' transcripts): the twelve stations, the list, the 20-coin fare and its waiver after
// The Forsaken Tower, the "already there" line and the conductors the spawns lack.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, beforeEach, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Common, Travel, QuestRuntime, tasks, starts, spawned, questDone;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/world/lovakengjminecarts/Common.LovakengjMinecarts');
  Travel = require('../plugins/world/lovakengjminecarts/Travel.LovakengjMinecarts');
  QuestRuntime = require('../plugins/quests/QuestRuntime');
  const api = new Proxy({
    core: { ...core, TaskManager: { submit: (task) => tasks.push(task) } },
    emitCustomEvent(name, event) { if (name === 'npc-dialogue:start') starts.push(event); },
    spawnNpc: (def) => { spawned.push(def); return def; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
  const original = QuestRuntime.getRegisteredQuests;
  QuestRuntime.getRegisteredQuests = () => [{ name: 'The Forsaken Tower', isComplete: () => questDone }, ...original()];
});

beforeEach(() => {
  tasks = [];
  starts = [];
  spawned = [];
  questDone = false;
});

function flush() {
  for (let i = 0; i < 5 && tasks.length; i++) {
    const due = tasks;
    tasks = [];
    for (const task of due) task.execute();
  }
}

const loc = (x, y) => new core.Location(x, y, 0);

function fakePlayer(x = 1519, y = 3732, coins = 100) {
  let tile = loc(x, y);
  let money = coins;
  const player = {
    messages: [], scripts: [], dialogues: [], interface: -1, blocked: false,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    isRegistered: () => true,
    getHitpoints: () => 99,
    sendMessage: (m) => player.messages.push(m),
    getInterfaceId: () => player.interface,
    getMovementQueue: () => ({ setBlockMovement: (b) => { player.blocked = b; }, reset() {} }),
    getDialogueManager: () => ({ startDialogues: (chain) => player.dialogues.push(chain) }),
    getPacketSender: () => ({
      sendInterfaceRemoval: () => { player.interface = -1; },
      sendInterface: (id) => { player.interface = id; },
      sendClientScript: (...args) => player.scripts.push(args),
      sendInterfaceFlagsRange() {}, sendSubInterface() {}, closeSubInterface() {},
    }),
    getInventory: () => ({
      getAmount: (id) => (id === 995 ? money : 0),
      delete: (id, n) => { if (id === 995) money -= n; },
    }),
    coins: () => money,
  };
  return player;
}

const station = (key) => Common.data.stations.find((s) => s.key === key);
const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];

test('the twelve stations in the Wiki\'s order, each conductor from the cache with an "already there" line', () => {
  assert.deepEqual(Common.data.stations.map((s) => s.label), [
    'Arceuus', 'Farming Guild', 'Hosidius South', 'Hosidius West', 'Kingstown', 'Kourend Woodland',
    'Lovakengj', 'Mount Quidamortem', 'Northern Tundras', 'Port Piscarilius', 'Shayzien East', 'Shayzien West',
  ]);
  assert.deepEqual(Common.data.stations.map((s) => s.npcId), [7231, 12702, 12703, 7228, 12704, 12705, 7227, 7619, 12706, 7229, 7230, 12707]);
  assert.ok(Common.data.stations.every((s) => s.alreadyThere), 'every conductor has the transcript line');
  assert.equal(station('lovakengj').alreadyThere, 'standard-dialogue-attempting-to-travel-to-lovakengj-while-already-there');
  assert.equal(Common.ids.menu, 187);
  assert.equal(Common.ids.minecart, 28835);
});

test('Travel on a conductor opens the list; a pick rides there for 20 coins', () => {
  const player = fakePlayer();
  assert.equal(Travel.travelNpc({ player, npc: { getId: () => 7227 } }), true);
  assert.equal(player.interface, Common.ids.menu);
  const [, , title, labels] = player.scripts.at(-1);
  assert.equal(title, 'Select a destination');
  assert.equal(labels.split('|').length, 12);
  const pick = { player, groupId: Common.ids.menu, childId: 3, slot: 0, handled: false };
  Travel.chooseOption(pick);
  assert.equal(pick.handled, true);
  assert.equal(player.blocked, true);
  assert.equal(Travel.ride(player, station('lovakengj'), station('portPiscarilius')), false, 'one ride at a time');
  flush();
  assert.equal(player.coins(), 80, '20 coins a ride, taken once, on arrival');
  assert.deepEqual(at(player), [1669, 3833], 'beside the Arceuus cart');
  assert.equal(player.blocked, false);
});

test('free once The Forsaken Tower is done; without 20 coins the conductor says so and nothing moves', () => {
  questDone = true;
  const free = fakePlayer(1519, 3732, 0);
  assert.equal(Travel.ride(free, station('lovakengj'), station('farmingGuild')), true);
  flush();
  assert.deepEqual(at(free), [1218, 3737]);
  questDone = false;
  const broke = fakePlayer(1519, 3732, 19);
  assert.equal(Travel.ride(broke, station('lovakengj'), station('arceuus')), false);
  assert.equal(broke.dialogues.length, 1, '"Minecart rides are 20 coins."');
  assert.equal(broke.coins(), 19);
  assert.equal(tasks.length, 0);
});

test('the station the player is at: the conductor\'s "already there" line, no charge', () => {
  const player = fakePlayer();
  assert.equal(Travel.ride(player, station('lovakengj'), station('lovakengj')), false);
  assert.equal(starts.at(-1).variant, 'standard-dialogue-attempting-to-travel-to-lovakengj-while-already-there');
  assert.equal(starts.at(-1).npcId, 7227);
  assert.equal(player.coins(), 100);
});

test("the transcript's fare conditions and its \"interface opens\" action", () => {
  const player = fakePlayer(1519, 3732, 20);
  const ask = (text, coins) => Travel.answerCondition({ player: fakePlayer(1519, 3732, coins), npcId: 7227, text });
  assert.equal(ask('If the player has 20 coins in their inventory:', 20), true);
  assert.equal(ask('If the player does not have 20 coins in their inventory:', 19), true);
  assert.equal(ask('If the player has 20 coins in their inventory:', 19), false);
  assert.equal(Travel.answerCondition({ player, npcId: 1, text: 'If the player has 20 coins in their inventory:' }), null);
  const action = { player, npcId: 7227, text: '(Lovakengj Minecart Network interface opens.)', handled: false };
  Travel.onAction(action);
  assert.equal(action.handled, true);
  flush();
  assert.equal(player.interface, Common.ids.menu);
  Travel.chooseOption({ player, groupId: Common.ids.menu, childId: 3, slot: 6, handled: false });
  assert.equal(starts.at(-1).npcId, 7227, 'from Lovakengj, Lovakengj is "already here"');
});

test("a station's minecart has Travel too, from the station it stands at", () => {
  const player = fakePlayer(1655, 3541);
  assert.equal(Travel.travelCart({ player, objectId: 28835, location: { x: 1655, y: 3542, z: 0 } }), true);
  Travel.chooseOption({ player, groupId: Common.ids.menu, childId: 3, slot: 3, handled: false });
  assert.equal(starts.at(-1).npcId, 7228, 'Traxi: already at Hosidius West');
  assert.equal(Travel.travelCart({ player, objectId: 1 }), false);
});

test('the six 2024 stations\' conductors are placed (the generated spawns lack them)', () => {
  Travel.spawnConductors();
  assert.deepEqual(spawned.map((s) => s.id).sort((a, b) => a - b), [12702, 12703, 12704, 12705, 12706, 12707]);
  spawned = [];
  Travel.spawnConductors(new Set([12702, 12703, 12704, 12705, 12706, 12707]));
  assert.equal(spawned.length, 0, 'not twice, once the generated spawns have them');
  assert.ok(spawned.every((s) => s.wanderRadius === 0 && s.z === 0));
});

test('after The Forsaken Tower the talk is the free one, and the fare conditions answer "has the coins"', () => {
  const player = fakePlayer(1519, 3732, 0);
  assert.equal(Travel.chooseVariant({ player, npcId: 7227 }), null, 'before the quest: the default (paid) talk');
  questDone = true;
  assert.equal(Travel.chooseVariant({ player, npcId: 7227 }), 'standard-dialogue-after-completing-the-forsaken-tower');
  assert.equal(Travel.chooseVariant({ player, npcId: 1 }), null);
  assert.equal(Travel.answerCondition({ player, npcId: 7227, text: 'If the player does not have 20 coins in their inventory:' }), false);
});

test('a death on the way: no ride, no fare, the screen back; a closed list forgets its pick', () => {
  const player = fakePlayer();
  let faded = 0;
  player.getPacketSender = ((sender) => () => ({ ...sender(), closeSubInterface: () => { faded += 1; } }))(player.getPacketSender);
  Travel.ride(player, station('lovakengj'), station('arceuus'));
  player.getHitpoints = () => 0;
  flush();
  assert.deepEqual(at(player), [1519, 3732]);
  assert.equal(player.coins(), 100);
  assert.equal(faded, 1);

  const other = fakePlayer();
  Travel.travelNpc({ player: other, npc: { getId: () => 7227 } });
  Travel.menuClosed({ player: other, interfaceId: Common.ids.menu });
  const pick = { player: other, groupId: Common.ids.menu, childId: 3, slot: 0, handled: false };
  Travel.chooseOption(pick);
  assert.equal(pick.handled, false, 'another menu on the same interface keeps its own pick');
});
