// Run after yarn build: node --test tests/hunter-isle-of-souls-snare.test.cjs
// The free Isle of Souls bird snare loc (rsprox.net recording 70, rev 227, ticks 2603-2627).
const assert = require('node:assert/strict');
const { before, afterEach, test } = require('node:test');
const path = require('node:path');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const C = require('../plugins/skills/hunter/Context.Hunter');
const { H } = C;
const Supplies = require('../plugins/skills/hunter/Supplies.Hunter');
const Hunter = require('../plugins/skills/Hunter.plugin');
let core, index = 9300;
const LOC = 26457;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  H.core = core;
  H.api = { emitCustomEvent() {} };
});
afterEach(() => { H.actions.clear(); H.players.clear(); });

function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername('soulsnare' + p.getIndex()); p.setRegistered(true);
  p.setLocation(new core.Location(2167, 2980, 0)); p.needsPlacement = false;
  const messages = [], anims = [], sounds = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', text => { messages.push(text); return p.getPacketSender(); });
  t.mock.method(p.getPacketSender(), 'sendSound', id => { sounds.push(id); return p.getPacketSender(); });
  const perform = p.performAnimation.bind(p);
  t.mock.method(p, 'performAnimation', anim => { anims.push(anim.getId()); return perform(anim); });
  return { p, messages, anims, sounds };
}
const tick = () => { H.tick++; C.processActions(); };
const snares = p => p.getInventory().getAmount(core.ItemIdentifiers.BIRD_SNARE);

test('the hook is registered on the loc\'s exact cache name and Take option', () => {
  core.ObjectDefinition.init?.();
  const def = core.ObjectDefinition.forId(LOC);
  assert.equal(def.getName(), Supplies.NAME);
  assert.equal(def.getInteractions()[0], 'Take');
  const hooks = [];
  Hunter.register(new Proxy({}, { get: (_, key) => key === 'core' ? core
    : key === 'onObjectInteraction' ? (name, actions) => hooks.push([name, actions]) : () => {} }));
  const hook = hooks.find(([name]) => name === Supplies.NAME);
  assert.ok(hook, 'registered');
  assert.equal(hook[1].Take, Supplies.take);
});

test('Take plays the pickup at once and gives one snare with sound 2582 a tick later', t => {
  const { p, messages, anims, sounds } = actor(t);
  assert.equal(Supplies.take({ player: p }), true);
  assert.deepEqual(anims, [827]);
  assert.equal(snares(p), 0, 'nothing yet on the click tick');
  tick();
  assert.equal(snares(p), 1);
  assert.deepEqual(sounds, [2582]);
  assert.deepEqual(anims, [827], 'no animation reset');
  assert.deepEqual(messages, []);
});

test('holding three refuses with no animation; two still takes one', t => {
  const { p, messages, anims } = actor(t);
  for (let i = 0; i < 3; i++) { Supplies.take({ player: p }); tick(); }
  assert.equal(snares(p), 3);
  anims.length = 0;
  assert.equal(Supplies.take({ player: p }), true);
  tick();
  assert.equal(snares(p), 3);
  assert.deepEqual(messages, ['You already have plenty of those.']);
  assert.deepEqual(anims, []);
  p.getInventory().delete(core.ItemIdentifiers.BIRD_SNARE, 1);
  Supplies.take({ player: p }); tick();
  assert.equal(snares(p), 3);
});

test('a full inventory gets the inventory-full reply and nothing is lost', t => {
  const { p, anims } = actor(t);
  const full = t.mock.method(p.getInventory(), 'full', () => p.getInventory());
  p.getInventory().adds(core.ItemIdentifiers.COINS, 1);
  for (let i = 1; i < 28; i++) p.getInventory().adds(core.ItemIdentifiers.LOGS, 1);
  assert.equal(p.getInventory().getFreeSlots(), 0);
  Supplies.take({ player: p }); tick();
  assert.equal(full.mock.callCount(), 1);
  assert.equal(snares(p), 0);
  assert.deepEqual(anims, []);
});

test('live has no bird snare ground spawn on the loc\'s tile, only the loc', () => {
  const spawns = require('../data/definitions/ground-items.json');
  const onTile = spawns.filter(s => s.location.x === 2167 && s.location.y === 2981 && s.location.z === 0);
  assert.deepEqual(onTile, []);
});
