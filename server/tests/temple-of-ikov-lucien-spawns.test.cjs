// Run after `yarn build`: node --test tests/temple-of-ikov-lucien-spawns.test.cjs
// Wiki (Temple of Ikov, Flying Horse Inn): the quest starts with Lucien at the Flying Horse Inn in
// East Ardougne; his house, where he takes the staff or is fought, is between Edgeville and the GE.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const register = require('../plugins/quests/quests/TempleOfIkov.Quest');

const INN_LUCIEN = 13608;
const HOUSE_LUCIEN = 13607;
const FLYING_HORSE_INN = { x: 2573, y: 3321, z: 0 };
const NEAR_EDGEVILLE = { x: 3122, y: 3483, z: 0 };

let login;
let quest;
const spawns = [];

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    onPlayerLogin: (fn) => { login = fn; },
    spawnNpc: (spec) => { spawns.push(spec); return { id: spec.id }; },
    removeNpc() {},
  }, { get: (t, p) => (p in t ? t[p] : () => {}) });
  register(api);
  quest = getRegisteredQuests().findLast((entry) => entry.key === 'temple_of_ikov');
});

function player() {
  const attributes = new Map(), varps = new Map(), varbits = new Map();
  const sender = new Proxy({
    sendConfig(id, value) { varps.set(id, value); return sender; },
    getVarp: (id) => varps.get(id) ?? 0,
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarbit: (id) => varbits.get(id) ?? 0,
  }, { get: (t, p) => (p in t ? t[p] : () => sender) });
  return {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    getUsername: () => 'ikovtester',
    isRegistered: () => true,
    sendMessage() {},
  };
}

const at = (spec) => ({ x: spec.x, y: spec.y, z: spec.z });

test('before the quest, the Lucien who starts it is at the Flying Horse Inn', () => {
  spawns.length = 0;
  login({ player: player() });
  const inn = spawns.filter((spec) => spec.id === INN_LUCIEN);
  assert.equal(inn.length, 1);
  assert.deepEqual(at(inn[0]), FLYING_HORSE_INN);
  assert.equal(spawns.some((spec) => spec.id === HOUSE_LUCIEN), false, 'no house Lucien before the start');
});

test('once started, the attackable Lucien waits at his house near Edgeville', () => {
  spawns.length = 0;
  const p = player();
  quest.setStage(p, 10);
  login({ player: p });
  const house = spawns.filter((spec) => spec.id === HOUSE_LUCIEN);
  assert.equal(house.length, 1);
  assert.deepEqual(at(house[0]), NEAR_EDGEVILLE);
  assert.deepEqual(at(spawns.find((spec) => spec.id === INN_LUCIEN)), FLYING_HORSE_INN);
});
