// Run after `yarn build`: node --test tests/swamp-bubbles.test.cjs
//
// Swamp bubbles' Suck against rsprox 227/02173 and the Wiki (all carried bellows are filled), on a
// real Player with its real Inventory.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');

let Bubbles, core;
const hooks = {};
const emitted = [];

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  Bubbles = require('../plugins/objects/SwampBubbles.plugin');
  Bubbles.register({
    core,
    getTaskManager: () => TaskManager,
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
    emitCustomEvent: (name, payload) => { emitted.push([name, payload]); },
  });
});

const id = (name) => core.CacheDefinitions.getObjId(name);
const EMPTY = () => core.ItemIdentifiers.OGRE_BELLOWS;

function realPlayer(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setIndex(77);
  p.messages = [];
  p.spam = [];
  p.anims = [];
  p.gfx = [];
  p.sounds = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p, 'isRegistered', () => true);
  t.mock.method(p, 'sendMessage', (text) => { p.messages.push(text); });
  t.mock.method(p, 'performAnimation', (animation) => { p.anims.push([animation.getId(), animation.getDelay?.()]); });
  t.mock.method(p, 'performGraphic', (graphic) => { p.gfx.push([graphic.getId(), graphic.getDelay(), graphic.getHeight()]); });
  t.mock.method(p.getPacketSender(), 'sendTypedMessage', (type, text) => { p.spam.push([type, text]); return p.getPacketSender(); });
  t.mock.method(p.getPacketSender(), 'sendSound', (sound, volume, delay) => { p.sounds.push([sound, delay]); return p.getPacketSender(); });
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  return p;
}

const suck = (p) => hooks['Swamp bubbles'].Suck({ player: p, objectId: 684, option: 'suck', clickType: 1, handled: false });
const tick = (n = 1) => { for (let i = 0; i < n; i++) TaskManager.process(); };
const count = (p, itemId) => p.getInventory().getAmount(itemId);

test('bellows with two loads are full the tick after, with the recorded line, animation, graphic and sound', (t) => {
  const p = realPlayer(t);
  p.getInventory().add(new core.Item(id('filled_ogre_bellow2'), 1));
  assert.equal(suck(p), true);
  assert.equal(count(p, id('filled_ogre_bellow3')), 0, 'not yet');
  tick();
  assert.equal(count(p, id('filled_ogre_bellow3')), 1);
  assert.equal(count(p, id('filled_ogre_bellow2')), 0);
  assert.deepEqual(p.spam, [[core.ChatType.SPAM, Bubbles.COLLECTED]], 'on the spam channel, as recorded');
  assert.deepEqual(p.anims, [[1026, 30]]);
  assert.deepEqual(p.gfx, [[241, 30, 64]]);
  assert.deepEqual(p.sounds, [[1454, 30]]);
});

test('every unfilled pair is filled; full ones stay as they are (Wiki)', (t) => {
  const p = realPlayer(t);
  p.getInventory().add(new core.Item(EMPTY(), 1));
  p.getInventory().add(new core.Item(id('filled_ogre_bellow1'), 1));
  p.getInventory().add(new core.Item(id('filled_ogre_bellow3'), 1));
  suck(p);
  tick();
  assert.equal(count(p, id('filled_ogre_bellow3')), 3);
  assert.equal(count(p, EMPTY()), 0);
  assert.equal(p.getInventory().getFreeSlots(), 25, 'each in its own slot');
});

test('no bellows, or only full ones: the recorded refusal at once', (t) => {
  const p = realPlayer(t);
  suck(p);
  p.getInventory().add(new core.Item(id('filled_ogre_bellow3'), 1));
  suck(p);
  tick();
  assert.deepEqual(p.messages, [Bubbles.NO_BELLOWS, Bubbles.NO_BELLOWS]);
  assert.deepEqual(p.anims, []);
});

test('a double click fills once, then refuses (rsprox 227/02173 clicked again a tick later)', (t) => {
  const p = realPlayer(t);
  p.getInventory().add(new core.Item(EMPTY(), 1));
  suck(p);
  suck(p);
  tick();
  assert.equal(count(p, id('filled_ogre_bellow3')), 1);
  assert.deepEqual(p.spam.map(([, text]) => text), [Bubbles.COLLECTED]);
  assert.deepEqual(p.messages, [Bubbles.NO_BELLOWS]);
  assert.equal(p.anims.length, 1);
});

test("another action the same tick (a new walk-to) cancels the fill: the task is the player's", (t) => {
  const p = realPlayer(t);
  p.getInventory().add(new core.Item(EMPTY(), 1));
  suck(p);
  TaskManager.cancelTasks(p.getIndex());
  tick();
  assert.equal(count(p, EMPTY()), 1);
  assert.deepEqual(p.spam, []);
});

test('a Suck that fills bellows tells listening quests; a refused one does not', (t) => {
  emitted.length = 0;
  const p = realPlayer(t);
  suck(p);
  tick();
  assert.deepEqual(emitted, [], 'no bellows: nothing collected');
  p.getInventory().add(new core.Item(EMPTY(), 1));
  suck(p);
  tick();
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][0], Bubbles.GAS_COLLECTED_EVENT);
  assert.equal(emitted[0][1].player, p);
  assert.equal(emitted[0][1].filled, 1);
});
